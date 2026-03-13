package com.localnet.backend.model;

public record MessageRecord(
        String messageId,
        String senderPeerId,
        String targetPeerId,
        String text,
        long expiresAt,
        String fileId,
        String fileName
) {
}