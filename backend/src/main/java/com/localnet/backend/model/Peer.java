package com.localnet.backend.model;

public record Peer( // Immutable data carrier for a connected network peer
        String peerId, // Unique identifier generated on registration
        String deviceName, // Human-readable name of the device
        String ipAddress, // IP address of the peer on the LAN
        String avatar, // Emoji or icon representing the peer
        long lastSeenAt // Epoch millis of last heartbeat or registration time
) {
}