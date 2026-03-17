package com.localnet.backend.model;

public record SendMessageRequest( // DTO for incoming send-message API requests
        String senderPeerId, // Required: peer ID of the message author
        String targetPeerId, // Optional: peer ID of recipient (null = public msg or resolve via IP)
        String targetIp, // Optional: fallback IP to resolve target peer if peerId is absent
        String text, // Optional: text content (must have text or file)
        Long ttlSeconds, // Optional: message TTL in seconds (defaults to 60, min 10)
        String fileId, // Optional: ID of a previously uploaded file to attach
        String fileName // Optional: original name of the attached file
) {
}