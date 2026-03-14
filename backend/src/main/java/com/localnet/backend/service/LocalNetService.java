package com.localnet.backend.service;

import com.localnet.backend.model.MessageRecord;
import com.localnet.backend.model.MessageView;
import com.localnet.backend.model.Peer;
import com.localnet.backend.model.SendMessageRequest;
import com.localnet.backend.model.StoredFile;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.InvalidPathException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class LocalNetService {

    private static final String PUBLIC_CHAT_KEY = "__public__";

    private final Map<String, Peer> peers = new ConcurrentHashMap<>();
    private final Map<String, List<MessageRecord>> conversations = new ConcurrentHashMap<>();
    private final Map<String, StoredFile> files = new ConcurrentHashMap<>();
    private final Path storagePath;

    public LocalNetService(@Value("${localnet.storage-dir:storage/uploads}") String storageDir) throws IOException {
        this.storagePath = Paths.get(storageDir).toAbsolutePath().normalize();
        Files.createDirectories(storagePath);
    }

    public Peer registerPeer(String deviceName, String avatar, String ipAddress) {
        String peerId = "peer_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        Peer peer = new Peer(peerId, deviceName.trim(), ipAddress, avatar);
        peers.put(peerId, peer);
        return peer;
    }

    public List<Peer> getPeers() {
        return peers.values().stream()
                .sorted(Comparator.comparing(Peer::deviceName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    public List<MessageView> getMessages(String viewerPeerId, String otherPeerId) {
        String conversationKey = conversationKey(viewerPeerId, otherPeerId);
        cleanupExpiredMessages(conversationKey);

        return conversations.getOrDefault(conversationKey, List.of()).stream()
                .map(message -> new MessageView(
                        message.messageId(),
                        message.text(),
                        message.expiresAt(),
                        Objects.equals(message.senderPeerId(), viewerPeerId),
                        message.fileId(),
                        message.fileName()
                ))
                .toList();
    }

    public List<MessageView> getPublicMessages(String viewerPeerId) {
        cleanupExpiredMessages(PUBLIC_CHAT_KEY);

        return conversations.getOrDefault(PUBLIC_CHAT_KEY, List.of()).stream()
                .map(message -> new MessageView(
                        message.messageId(),
                        message.text(),
                        message.expiresAt(),
                        Objects.equals(message.senderPeerId(), viewerPeerId),
                        message.fileId(),
                        message.fileName()
                ))
                .toList();
    }

    public String sendMessage(SendMessageRequest request) {
        String senderPeerId = request.senderPeerId();
        boolean isPublicMessage = !StringUtils.hasText(request.targetPeerId()) && !StringUtils.hasText(request.targetIp());
        String targetPeerId = isPublicMessage ? null : resolveTargetPeerId(request.targetPeerId(), request.targetIp());

        if (!StringUtils.hasText(senderPeerId)) {
            throw new IllegalArgumentException("senderPeerId is required");
        }
        if (!peers.containsKey(senderPeerId)) {
            throw new IllegalArgumentException("Unknown senderPeerId: " + senderPeerId);
        }

        if (!isPublicMessage && !StringUtils.hasText(targetPeerId)) {
            throw new IllegalArgumentException("targetPeerId is required for direct messages");
        }

        boolean hasText = StringUtils.hasText(request.text());
        boolean hasFile = StringUtils.hasText(request.fileId());
        if (!hasText && !hasFile) {
            throw new IllegalArgumentException("Message must contain text or a file");
        }

        long ttlMillis = Math.max(10L, request.ttlSeconds() == null ? 60L : request.ttlSeconds()) * 1000L;
        long expiresAt = Instant.now().toEpochMilli() + ttlMillis;

        MessageRecord message = new MessageRecord(
                "msg_" + Instant.now().toEpochMilli() + "_" + UUID.randomUUID().toString().substring(0, 6),
                senderPeerId,
                targetPeerId,
                hasText ? request.text().trim() : "",
                expiresAt,
                request.fileId(),
                request.fileName()
        );

        String conversationKey = isPublicMessage ? PUBLIC_CHAT_KEY : conversationKey(senderPeerId, targetPeerId);
        conversations.computeIfAbsent(conversationKey, ignored -> new CopyOnWriteArrayList<>()).add(message);
        cleanupExpiredMessages(conversationKey);
        return message.messageId();
    }

    public void deleteMessage(String messageId, String requesterPeerId) {
        if (!StringUtils.hasText(messageId)) {
            throw new IllegalArgumentException("messageId is required");
        }
        if (!StringUtils.hasText(requesterPeerId)) {
            throw new IllegalArgumentException("requesterPeerId is required");
        }
        if (!peers.containsKey(requesterPeerId)) {
            throw new IllegalArgumentException("Unknown requesterPeerId: " + requesterPeerId);
        }

        String messageConversationKey = null;
        MessageRecord targetMessage = null;

        for (Map.Entry<String, List<MessageRecord>> entry : conversations.entrySet()) {
            for (MessageRecord message : entry.getValue()) {
                if (Objects.equals(message.messageId(), messageId)) {
                    messageConversationKey = entry.getKey();
                    targetMessage = message;
                    break;
                }
            }
            if (targetMessage != null) {
                break;
            }
        }

        if (targetMessage == null || messageConversationKey == null) {
            throw new NoSuchElementException("Message not found: " + messageId);
        }

        if (!Objects.equals(targetMessage.senderPeerId(), requesterPeerId)) {
            throw new SecurityException("Only the original sender can delete this message");
        }

        List<MessageRecord> conversation = conversations.get(messageConversationKey);
        if (conversation == null) {
            throw new NoSuchElementException("Message not found: " + messageId);
        }

        conversation.removeIf(message -> Objects.equals(message.messageId(), messageId));
        if (conversation.isEmpty()) {
            conversations.remove(messageConversationKey);
        }
    }

    public StoredFile storeFile(MultipartFile multipartFile) {
        if (multipartFile.isEmpty()) {
            throw new IllegalArgumentException("File upload cannot be empty");
        }

        String cleanedName = StringUtils.cleanPath(Objects.requireNonNullElse(multipartFile.getOriginalFilename(), "upload.bin"));
        String originalName;
        try {
            originalName = Paths.get(cleanedName).getFileName().toString();
        } catch (InvalidPathException exception) {
            throw new IllegalArgumentException("Invalid file name", exception);
        }
        if (!StringUtils.hasText(originalName)) {
            throw new IllegalArgumentException("File name is required");
        }

        String fileId = "file_" + UUID.randomUUID().toString().replace("-", "");
        String storedName = fileId + "_" + originalName;
        Path destination = storagePath.resolve(storedName).normalize();
        if (!destination.startsWith(storagePath)) {
            throw new IllegalArgumentException("Invalid file path");
        }

        try (InputStream inputStream = multipartFile.getInputStream()) {
            Files.copy(inputStream, destination, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to store uploaded file", exception);
        }

        StoredFile storedFile = new StoredFile(
                fileId,
                originalName,
                Objects.requireNonNullElse(multipartFile.getContentType(), MediaType.APPLICATION_OCTET_STREAM_VALUE),
                destination
        );
        files.put(fileId, storedFile);
        return storedFile;
    }

    public StoredFile getFile(String fileId) {
        StoredFile storedFile = files.get(fileId);
        if (storedFile == null || !Files.exists(storedFile.path())) {
            throw new IllegalArgumentException("File not found: " + fileId);
        }
        return storedFile;
    }

    private void cleanupExpiredMessages(String conversationKey) {
        long now = Instant.now().toEpochMilli();
        List<MessageRecord> currentMessages = conversations.get(conversationKey);
        if (currentMessages == null) {
            return;
        }

        List<MessageRecord> activeMessages = new ArrayList<>(currentMessages.stream()
                .filter(message -> message.expiresAt() > now)
                .toList());

        if (activeMessages.isEmpty()) {
            conversations.remove(conversationKey);
            return;
        }

        conversations.put(conversationKey, new CopyOnWriteArrayList<>(activeMessages));
    }

    private String resolveTargetPeerId(String targetPeerId, String targetIp) {
        if (StringUtils.hasText(targetPeerId)) {
            return peers.containsKey(targetPeerId) ? targetPeerId : null;
        }

        if (!StringUtils.hasText(targetIp)) {
            return null;
        }

        return peers.values().stream()
                .filter(peer -> Objects.equals(peer.ipAddress(), targetIp))
                .map(Peer::peerId)
                .findFirst()
                .orElse(null);
    }

    private String conversationKey(String firstPeerId, String secondPeerId) {
        if (!StringUtils.hasText(firstPeerId) || !StringUtils.hasText(secondPeerId)) {
            throw new IllegalArgumentException("Both peer ids are required to resolve a conversation");
        }

        return firstPeerId.compareTo(secondPeerId) < 0
                ? firstPeerId + "::" + secondPeerId
                : secondPeerId + "::" + firstPeerId;
    }
}
