package com.localnet.backend.controller;

import com.localnet.backend.model.Peer;
import com.localnet.backend.model.RegisterPeerRequest;
import com.localnet.backend.service.LocalNetService;
import com.localnet.backend.websocket.LocalNetWebSocketHandler;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/peers")
public class PeerController {

    private final LocalNetService localNetService;
    private final LocalNetWebSocketHandler localNetWebSocketHandler;

    public PeerController(LocalNetService localNetService, LocalNetWebSocketHandler localNetWebSocketHandler) {
        this.localNetService = localNetService;
        this.localNetWebSocketHandler = localNetWebSocketHandler;
    }

    @GetMapping
    public List<Peer> getPeers() {
        return localNetService.getPeers();
    }

    @PostMapping("/broadcast")
    public Peer registerPeer(@Valid @RequestBody RegisterPeerRequest request, HttpServletRequest servletRequest) {
        Peer peer = localNetService.registerPeer(request.deviceName(), request.avatar(), resolveClientIp(servletRequest));
        localNetWebSocketHandler.broadcast("peer.updated", Map.of("peerId", peer.peerId()));
        return peer;
    }

    private String resolveClientIp(HttpServletRequest servletRequest) {
        String forwardedFor = servletRequest.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return forwardedFor.split(",")[0].trim();
        }

        return servletRequest.getRemoteAddr();
    }
}
