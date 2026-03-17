package com.localnet.backend.model;

public record MessageRecord( // Immutable internal representation of a stored message
        String messageId, // Unique ID combining timestamp + random suffix
        String senderPeerId, // Peer ID of the message author
        String targetPeerId, // Peer ID of the recipient (null for public messages)
        String text, // Text content of the message (may be empty if file-only)
        long expiresAt, // Epoch millis when this message auto-expires
        String fileId, // ID of attached file (null if text-only)
        String fileName // Original name of attached file (null if text-only)
) {
}