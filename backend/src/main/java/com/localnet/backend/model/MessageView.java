package com.localnet.backend.model;

public record MessageView(
        String messageId,
        String text,
        long expiresAt,
        boolean isMine,
        String senderPeerId,
        String senderDeviceName,
        String senderAvatar,
        String fileId,
        String fileName
) {
}
