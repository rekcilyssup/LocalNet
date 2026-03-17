package com.localnet.backend.service;

import com.localnet.backend.model.MessageRecord; // Internal message storage record
import com.localnet.backend.model.MessageView; // Client-facing message DTO
import com.localnet.backend.model.Peer; // Peer data model
import com.localnet.backend.model.SendMessageRequest; // Incoming send-message DTO
import com.localnet.backend.model.StoredFile; // File metadata record
import org.springframework.beans.factory.annotation.Value; // Injects values from application.properties
import org.springframework.http.MediaType; // MIME type constants
import org.springframework.stereotype.Service; // Marks class as a Spring service bean
import org.springframework.util.StringUtils; // Utility for string checks (hasText, cleanPath)
import org.springframework.web.multipart.MultipartFile; // Represents an uploaded file

import java.io.IOException; // Thrown on file I/O errors
import java.io.InputStream; // Stream for reading uploaded file content
import java.nio.file.InvalidPathException; // Thrown on invalid filesystem paths
import java.nio.file.Files; // Utility for file operations (copy, createDir)
import java.nio.file.Path; // Represents a filesystem path
import java.nio.file.Paths; // Factory for creating Path instances
import java.nio.file.StandardCopyOption; // Options for file copy behavior
import java.time.Instant; // Used for timestamps and TTL calculation
import java.util.ArrayList; // Mutable list for filtering operations
import java.util.Comparator; // Used for sorting peers alphabetically
import java.util.HashMap; // Mutable map for building unread counts
import java.util.List; // Generic list type
import java.util.Map; // Generic map type
import java.util.NoSuchElementException; // Thrown when a message is not found
import java.util.Objects; // Null-safe equality checks
import java.util.Set; // Generic set type
import java.util.UUID; // Generates unique identifiers
import java.util.concurrent.ConcurrentHashMap; // Thread-safe map for concurrent access
import java.util.concurrent.CopyOnWriteArrayList; // Thread-safe list allowing concurrent reads during writes

@Service // Registers this class as a Spring-managed service bean
public class LocalNetService {

    private static final String PUBLIC_CHAT_KEY = "__public__"; // Internal key for the public chat conversation
    private static final String PUBLIC_ROOM_ID = "public_room"; // ID exposed to the client for the public room

    private final Map<String, Peer> peers = new ConcurrentHashMap<>(); // Thread-safe store of all registered peers (peerId -> Peer)
    private final Map<String, List<MessageRecord>> conversations = new ConcurrentHashMap<>(); // Thread-safe store of conversations (conversationKey -> messages)
    private final Map<String, Map<String, Set<String>>> readMessageIdsByViewer = new ConcurrentHashMap<>(); // Tracks which messages each viewer has read (viewerPeerId -> conversationKey -> set of messageIds)
    private final Map<String, StoredFile> files = new ConcurrentHashMap<>(); // Thread-safe store of uploaded files (fileId -> StoredFile)
    private final Path storagePath; // Resolved absolute path to the file upload directory

    public LocalNetService(@Value("${localnet.storage-dir:storage/uploads}") String storageDir) throws IOException { // Injects storage dir from config, defaults to storage/uploads
        this.storagePath = Paths.get(storageDir).toAbsolutePath().normalize(); // Resolve to absolute, normalized path
        Files.createDirectories(storagePath); // Ensure the upload directory exists on startup
    }

    public Peer registerPeer(String deviceName, String avatar, String ipAddress) { // Registers a new peer on the network
        String peerId = "peer_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10); // Generate a short unique peer ID
        Peer peer = new Peer(peerId, deviceName.trim(), ipAddress, avatar, Instant.now().toEpochMilli()); // Create immutable Peer record
        peers.put(peerId, peer); // Store in the peers map
        return peer; // Return the newly created peer
    }

    public List<Peer> getPeers() { // Returns all registered peers sorted alphabetically
        return peers.values().stream()
                .sorted(Comparator.comparing(Peer::deviceName, String.CASE_INSENSITIVE_ORDER)) // Sort by device name, case-insensitive
                .toList(); // Collect to immutable list
    }

    public Peer heartbeat(String peerId) { // Updates the lastSeenAt timestamp for a peer
        if (!StringUtils.hasText(peerId)) {
            throw new IllegalArgumentException("peerId is required");
        }
        Peer existing = peers.get(peerId);
        if (existing == null) {
            throw new IllegalArgumentException("Unknown peerId: " + peerId);
        }
        Peer updated = new Peer(existing.peerId(), existing.deviceName(), existing.ipAddress(), existing.avatar(), Instant.now().toEpochMilli());
        peers.put(peerId, updated);
        return updated;
    }

    public Peer validateTyping(String peerId) { // Validates a peer exists before broadcasting typing
        if (!StringUtils.hasText(peerId)) {
            throw new IllegalArgumentException("peerId is required");
        }
        Peer existing = peers.get(peerId);
        if (existing == null) {
            throw new IllegalArgumentException("Unknown peerId: " + peerId);
        }
        return existing;
    }

    public List<String> removeExpiredPeers(long staleThresholdMs) { // Removes peers that haven't sent a heartbeat
        long cutoffTime = Instant.now().toEpochMilli() - staleThresholdMs;
        List<String> removedPeerIds = new ArrayList<>();
        
        peers.entrySet().removeIf(entry -> {
            if (entry.getValue().lastSeenAt() < cutoffTime) {
                removedPeerIds.add(entry.getKey());
                return true;
            }
            return false;
        });
        
        return removedPeerIds;
    }

    public List<MessageView> getMessages(String viewerPeerId, String otherPeerId) { // Fetches DM conversation between two peers
        String conversationKey = conversationKey(viewerPeerId, otherPeerId); // Build a canonical key for this pair
        cleanupExpiredMessages(conversationKey); // Remove any expired messages first

        List<MessageRecord> currentMessages = conversations.getOrDefault(conversationKey, List.of()); // Get messages or empty list
        markConversationAsRead(viewerPeerId, conversationKey, currentMessages); // Mark all messages as read by this viewer

        return currentMessages.stream()
                .map(message -> toMessageView(message, viewerPeerId)) // Convert each record to a client-facing view
                .toList(); // Collect to immutable list
    }

    public List<MessageView> getPublicMessages(String viewerPeerId) { // Fetches all messages in the public chat room
        cleanupExpiredMessages(PUBLIC_CHAT_KEY); // Remove expired public messages

        List<MessageRecord> currentMessages = conversations.getOrDefault(PUBLIC_CHAT_KEY, List.of()); // Get public messages or empty list
        markConversationAsRead(viewerPeerId, PUBLIC_CHAT_KEY, currentMessages); // Mark all public messages as read

        return currentMessages.stream()
                .map(message -> toMessageView(message, viewerPeerId)) // Convert to client-facing views
                .toList(); // Collect to immutable list
    }

    public Map<String, Integer> getUnreadCounts(String viewerPeerId) { // Returns unread counts for all conversations
        if (!StringUtils.hasText(viewerPeerId)) { // Validate that viewerPeerId is provided
            throw new IllegalArgumentException("viewerPeerId is required");
        }
        if (!peers.containsKey(viewerPeerId)) { // Ensure the peer is registered
            throw new IllegalArgumentException("Unknown viewerPeerId: " + viewerPeerId);
        }

        for (String conversationKey : List.copyOf(conversations.keySet())) { // Iterate over a snapshot of keys to avoid concurrent modification
            cleanupExpiredMessages(conversationKey); // Remove expired messages from each conversation
        }

        Map<String, Integer> unreadCounts = new HashMap<>(); // Mutable map to build the result
        for (Map.Entry<String, List<MessageRecord>> entry : conversations.entrySet()) { // Iterate all conversations
            String conversationKey = entry.getKey(); // Current conversation key
            List<MessageRecord> messages = entry.getValue(); // Messages in this conversation
            int unread = countUnreadMessages(viewerPeerId, conversationKey, messages); // Count unread messages
            if (unread <= 0) { // Skip conversations with no unread messages
                continue;
            }

            if (Objects.equals(conversationKey, PUBLIC_CHAT_KEY)) { // Handle public chat separately
                unreadCounts.put(PUBLIC_ROOM_ID, unread); // Use the public room ID as the key
                continue;
            }

            String otherPeerId = resolveOtherPeerIdForViewer(viewerPeerId, conversationKey); // Extract the other participant's ID
            if (!StringUtils.hasText(otherPeerId)) { // Skip if we can't determine the other peer
                continue;
            }
            unreadCounts.put(otherPeerId, unread); // Map the other peer's ID to their unread count
        }

        return unreadCounts; // Return the complete unread counts map
    }

    public String sendMessage(SendMessageRequest request) { // Sends a message (public or direct) and returns its ID
        String senderPeerId = request.senderPeerId(); // Extract sender ID from request
        boolean isPublicMessage = !StringUtils.hasText(request.targetPeerId()) && !StringUtils.hasText(request.targetIp()); // Public if no target specified
        String targetPeerId = isPublicMessage ? null : resolveTargetPeerId(request.targetPeerId(), request.targetIp()); // Resolve target peer; null for public

        if (!StringUtils.hasText(senderPeerId)) { // Validate sender is provided
            throw new IllegalArgumentException("senderPeerId is required");
        }
        if (!peers.containsKey(senderPeerId)) { // Ensure sender is a registered peer
            throw new IllegalArgumentException("Unknown senderPeerId: " + senderPeerId);
        }

        if (!isPublicMessage && !StringUtils.hasText(targetPeerId)) { // For DMs, target must be resolvable
            throw new IllegalArgumentException("targetPeerId is required for direct messages");
        }

        boolean hasText = StringUtils.hasText(request.text()); // Check if message has text content
        boolean hasFile = StringUtils.hasText(request.fileId()); // Check if message has a file attachment
        if (!hasText && !hasFile) { // Message must have at least text or a file
            throw new IllegalArgumentException("Message must contain text or a file");
        }

        long ttlMillis = Math.max(10L, request.ttlSeconds() == null ? 60L : request.ttlSeconds()) * 1000L; // Calculate TTL in millis (min 10s, default 60s)
        long expiresAt = Instant.now().toEpochMilli() + ttlMillis; // Set absolute expiration time

        MessageRecord message = new MessageRecord( // Create the message record
                "msg_" + Instant.now().toEpochMilli() + "_" + UUID.randomUUID().toString().substring(0, 6), // Unique ID: timestamp + random suffix
                senderPeerId, // Who sent it
                targetPeerId, // Who receives it (null for public)
                hasText ? request.text().trim() : "", // Trimmed text or empty string
                expiresAt, // When it auto-expires
                request.fileId(), // Attached file ID (may be null)
                request.fileName() // Attached file name (may be null)
        );

        String conversationKey = isPublicMessage ? PUBLIC_CHAT_KEY : conversationKey(senderPeerId, targetPeerId); // Determine which conversation to store in
        conversations.computeIfAbsent(conversationKey, ignored -> new CopyOnWriteArrayList<>()).add(message); // Create conversation if needed, then add message
        cleanupExpiredMessages(conversationKey); // Remove any expired messages in this conversation
        return message.messageId(); // Return the generated message ID
    }

    public void deleteMessage(String messageId, String requesterPeerId) { // Deletes a message if the requester is the sender
        if (!StringUtils.hasText(messageId)) { // Validate messageId is provided
            throw new IllegalArgumentException("messageId is required");
        }
        if (!StringUtils.hasText(requesterPeerId)) { // Validate requesterPeerId is provided
            throw new IllegalArgumentException("requesterPeerId is required");
        }
        if (!peers.containsKey(requesterPeerId)) { // Ensure requester is a registered peer
            throw new IllegalArgumentException("Unknown requesterPeerId: " + requesterPeerId);
        }

        String messageConversationKey = null; // Will hold the conversation key containing the message
        MessageRecord targetMessage = null; // Will hold the message to delete

        for (Map.Entry<String, List<MessageRecord>> entry : conversations.entrySet()) { // Search all conversations for the message
            for (MessageRecord message : entry.getValue()) { // Check each message in the conversation
                if (Objects.equals(message.messageId(), messageId)) { // Found the target message
                    messageConversationKey = entry.getKey(); // Record which conversation it belongs to
                    targetMessage = message; // Store the message reference
                    break; // Stop inner loop
                }
            }
            if (targetMessage != null) { // If found, stop outer loop too
                break;
            }
        }

        if (targetMessage == null || messageConversationKey == null) { // Message was not found in any conversation
            throw new NoSuchElementException("Message not found: " + messageId);
        }

        if (!Objects.equals(targetMessage.senderPeerId(), requesterPeerId)) { // Only the sender can delete their own message
            throw new SecurityException("Only the original sender can delete this message");
        }

        List<MessageRecord> conversation = conversations.get(messageConversationKey); // Get the conversation list
        if (conversation == null) { // Defensive check
            throw new NoSuchElementException("Message not found: " + messageId);
        }

        conversation.removeIf(message -> Objects.equals(message.messageId(), messageId)); // Remove the message from the list
        if (conversation.isEmpty()) { // If conversation is now empty
            conversations.remove(messageConversationKey); // Remove the conversation entirely
            removeConversationReadState(messageConversationKey); // Clean up associated read-tracking state
            return;
        }

        cleanupReadStateForConversation(messageConversationKey, conversation); // Remove read state for the deleted message
    }

    public StoredFile storeFile(MultipartFile multipartFile) { // Saves an uploaded file to disk and returns metadata
        if (multipartFile.isEmpty()) { // Reject empty uploads
            throw new IllegalArgumentException("File upload cannot be empty");
        }

        String cleanedName = StringUtils.cleanPath(Objects.requireNonNullElse(multipartFile.getOriginalFilename(), "upload.bin")); // Sanitize filename, default to "upload.bin"
        String originalName;
        try {
            originalName = Paths.get(cleanedName).getFileName().toString(); // Extract just the filename (strip directory traversal)
        } catch (InvalidPathException exception) { // Filename contains invalid characters
            throw new IllegalArgumentException("Invalid file name", exception);
        }
        if (!StringUtils.hasText(originalName)) { // Ensure filename is not blank after cleanup
            throw new IllegalArgumentException("File name is required");
        }

        String fileId = "file_" + UUID.randomUUID().toString().replace("-", ""); // Generate unique file ID
        String storedName = fileId + "_" + originalName; // Prefix original name with ID for uniqueness on disk
        Path destination = storagePath.resolve(storedName).normalize(); // Resolve full path within storage directory
        if (!destination.startsWith(storagePath)) { // Prevent path traversal attacks (e.g. ../../etc/passwd)
            throw new IllegalArgumentException("Invalid file path");
        }

        try (InputStream inputStream = multipartFile.getInputStream()) { // Open input stream from the upload
            Files.copy(inputStream, destination, StandardCopyOption.REPLACE_EXISTING); // Write file to disk, overwrite if exists
        } catch (IOException exception) { // File I/O failed
            throw new IllegalStateException("Unable to store uploaded file", exception);
        }

        StoredFile storedFile = new StoredFile( // Create metadata record
                fileId, // Unique file identifier
                originalName, // Original client filename
                Objects.requireNonNullElse(multipartFile.getContentType(), MediaType.APPLICATION_OCTET_STREAM_VALUE), // MIME type; defaults to binary stream
                destination // Absolute path on disk
        );
        files.put(fileId, storedFile); // Store metadata in the files map
        return storedFile; // Return metadata to the caller
    }

    public StoredFile getFile(String fileId) { // Retrieves file metadata by ID, ensuring the file still exists
        StoredFile storedFile = files.get(fileId); // Look up metadata by ID
        if (storedFile == null || !Files.exists(storedFile.path())) { // Not found in map or file deleted from disk
            throw new IllegalArgumentException("File not found: " + fileId);
        }
        return storedFile; // Return the metadata
    }

    private void cleanupExpiredMessages(String conversationKey) { // Removes messages past their TTL from a conversation
        long now = Instant.now().toEpochMilli(); // Current time in epoch millis
        List<MessageRecord> currentMessages = conversations.get(conversationKey); // Get messages for this conversation
        if (currentMessages == null) { // No messages to clean
            return;
        }

        List<MessageRecord> activeMessages = new ArrayList<>(currentMessages.stream()
                .filter(message -> message.expiresAt() > now) // Keep only non-expired messages
                .toList()); // Collect into a new mutable list

        if (activeMessages.isEmpty()) { // All messages have expired
            conversations.remove(conversationKey); // Remove the empty conversation
            removeConversationReadState(conversationKey); // Clean up read-tracking for this conversation
            return;
        }

        conversations.put(conversationKey, new CopyOnWriteArrayList<>(activeMessages)); // Replace with filtered list
        cleanupReadStateForConversation(conversationKey, activeMessages); // Remove read state for expired messages
    }

    private String resolveTargetPeerId(String targetPeerId, String targetIp) { // Resolves target peer by ID or IP address
        if (StringUtils.hasText(targetPeerId)) { // If a peer ID was provided directly
            return peers.containsKey(targetPeerId) ? targetPeerId : null; // Return it only if it's a known peer
        }

        if (!StringUtils.hasText(targetIp)) { // No peer ID and no IP provided
            return null;
        }

        return peers.values().stream()
                .filter(peer -> Objects.equals(peer.ipAddress(), targetIp)) // Find a peer with the matching IP
                .map(Peer::peerId) // Extract their peer ID
                .findFirst() // Take the first match
                .orElse(null); // Return null if no match found
    }

    private String conversationKey(String firstPeerId, String secondPeerId) { // Creates a canonical key for a DM conversation between two peers
        if (!StringUtils.hasText(firstPeerId) || !StringUtils.hasText(secondPeerId)) { // Both IDs must be non-blank
            throw new IllegalArgumentException("Both peer ids are required to resolve a conversation");
        }

        return firstPeerId.compareTo(secondPeerId) < 0 // Sort alphabetically so A::B == B::A
                ? firstPeerId + "::" + secondPeerId // First peer comes first
                : secondPeerId + "::" + firstPeerId; // Second peer comes first
    }

    private void markConversationAsRead(String viewerPeerId, String conversationKey, List<MessageRecord> messages) { // Marks all messages from others as read by the viewer
        if (!StringUtils.hasText(viewerPeerId) || messages.isEmpty()) { // Skip if no viewer or no messages
            return;
        }

        Map<String, Set<String>> readByConversation = readMessageIdsByViewer.computeIfAbsent( // Get or create the viewer's read-tracking map
                viewerPeerId,
                ignored -> new ConcurrentHashMap<>() // Initialize new map for first-time viewers
        );
        Set<String> readMessageIds = readByConversation.computeIfAbsent( // Get or create the set of read message IDs for this conversation
                conversationKey,
                ignored -> ConcurrentHashMap.newKeySet() // Initialize new thread-safe set
        );

        for (MessageRecord message : messages) { // Iterate all messages in the conversation
            if (!Objects.equals(message.senderPeerId(), viewerPeerId)) { // Only mark messages NOT sent by the viewer
                readMessageIds.add(message.messageId()); // Add to the read set
            }
        }
    }

    private int countUnreadMessages(String viewerPeerId, String conversationKey, List<MessageRecord> messages) { // Counts messages from others that the viewer hasn't read
        Set<String> readMessageIds = readMessageIdsByViewer
                .getOrDefault(viewerPeerId, Map.of()) // Get viewer's read map or empty
                .getOrDefault(conversationKey, Set.of()); // Get read set for this conversation or empty

        return (int) messages.stream()
                .filter(message -> !Objects.equals(message.senderPeerId(), viewerPeerId)) // Exclude viewer's own messages
                .filter(message -> !readMessageIds.contains(message.messageId())) // Exclude already-read messages
                .count(); // Count remaining unread messages
    }

    private String resolveOtherPeerIdForViewer(String viewerPeerId, String conversationKey) { // Extracts the other peer's ID from a conversation key
        String[] participants = conversationKey.split("::", 2); // Split "peerA::peerB" into two parts
        if (participants.length != 2) { // Invalid key format
            return null;
        }
        if (Objects.equals(participants[0], viewerPeerId)) { // Viewer is the first participant
            return participants[1]; // Return the second participant
        }
        if (Objects.equals(participants[1], viewerPeerId)) { // Viewer is the second participant
            return participants[0]; // Return the first participant
        }
        return null; // Viewer is not part of this conversation
    }

    private void cleanupReadStateForConversation(String conversationKey, List<MessageRecord> activeMessages) { // Removes read-tracking entries for messages that no longer exist
        Set<String> activeMessageIds = activeMessages.stream()
                .map(MessageRecord::messageId) // Extract all active message IDs
                .collect(java.util.stream.Collectors.toSet()); // Collect into a set for fast lookup

        for (Map<String, Set<String>> readByConversation : readMessageIdsByViewer.values()) { // Iterate all viewers
            Set<String> readMessageIds = readByConversation.get(conversationKey); // Get read set for this conversation
            if (readMessageIds == null) { // No read state for this conversation
                continue;
            }
            readMessageIds.retainAll(activeMessageIds); // Keep only IDs that still have active messages
            if (readMessageIds.isEmpty()) { // If all tracked reads are gone
                readByConversation.remove(conversationKey); // Remove the empty read set
            }
        }
        readMessageIdsByViewer.entrySet().removeIf(entry -> entry.getValue().isEmpty()); // Remove viewers with no read state left
    }

    private void removeConversationReadState(String conversationKey) { // Completely removes all read-tracking for a conversation
        for (Map<String, Set<String>> readByConversation : readMessageIdsByViewer.values()) { // Iterate all viewers
            readByConversation.remove(conversationKey); // Remove read state for this conversation
        }
        readMessageIdsByViewer.entrySet().removeIf(entry -> entry.getValue().isEmpty()); // Remove viewers with no read state left
    }

    private MessageView toMessageView(MessageRecord message, String viewerPeerId) { // Converts an internal MessageRecord to a client-facing MessageView
        Peer sender = peers.get(message.senderPeerId()); // Look up the sender's peer info
        String senderName = sender != null ? sender.deviceName() : "Unknown"; // Resolve sender name, fallback to "Unknown"
        String senderAvatar = sender != null ? sender.avatar() : "👤"; // Resolve sender avatar, fallback to default

        return new MessageView( // Build the client-facing DTO
                message.messageId(), // Message ID
                message.text(), // Text content
                message.expiresAt(), // Expiration timestamp
                Objects.equals(message.senderPeerId(), viewerPeerId), // True if viewer is the sender
                message.senderPeerId(), // Sender's peer ID
                senderName, // Resolved sender name
                senderAvatar, // Resolved sender avatar
                message.fileId(), // Attached file ID
                message.fileName() // Attached file name
        );
    }
}
