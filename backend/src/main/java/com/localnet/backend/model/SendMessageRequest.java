package com.localnet.backend.model;

public record SendMessageRequest(
        String senderPeerId,
        String targetPeerId,
        String targetIp,
        String text,
        Long ttlSeconds,
        String fileId,
        String fileName
) {
}