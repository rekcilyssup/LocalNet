package com.localnet.backend.model;

public record MessageView(
        String messageId,
        String text,
        long expiresAt,
        boolean isMine,
        String fileId,
        String fileName
) {
}