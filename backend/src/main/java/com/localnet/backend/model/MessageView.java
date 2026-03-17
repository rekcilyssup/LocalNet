package com.localnet.backend.model;

public record MessageView( // Client-facing DTO with sender info resolved for display
        String messageId, // Unique message identifier
        String text, // Message text content
        long expiresAt, // Epoch millis when this message expires
        boolean isMine, // True if the current viewer is the sender
        String senderPeerId, // Peer ID of the sender
        String senderDeviceName, // Resolved device name of the sender
        String senderAvatar, // Resolved avatar emoji of the sender
        String fileId, // Attached file ID (null if none)
        String fileName // Attached file name (null if none)
) {
}
