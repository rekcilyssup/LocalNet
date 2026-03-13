package com.localnet.backend.model;

public record Peer(
        String peerId,
        String deviceName,
        String ipAddress,
        String avatar
) {
}