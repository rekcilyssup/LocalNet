package com.localnet.backend.controller;

import com.localnet.backend.model.Peer; // Peer data model returned in responses
import com.localnet.backend.model.RegisterPeerRequest; // Validated DTO for new peer registration
import com.localnet.backend.service.LocalNetService; // Core business logic service
import com.localnet.backend.websocket.LocalNetWebSocketHandler; // WebSocket broadcaster for real-time events
import jakarta.servlet.http.HttpServletRequest; // Access raw HTTP request data (e.g. client IP)
import jakarta.validation.Valid; // Triggers bean validation on the request body
import org.springframework.web.bind.annotation.GetMapping; // Maps GET requests
import org.springframework.web.bind.annotation.PostMapping; // Maps POST requests
import org.springframework.web.bind.annotation.RequestBody; // Binds JSON request body to method parameter
import org.springframework.web.bind.annotation.RequestMapping; // Sets base path for this controller
import org.springframework.web.bind.annotation.RestController; // Marks class as a REST controller returning JSON

import java.util.List; // Used for returning list of peers
import java.util.Map; // Used for WebSocket broadcast payloads

@RestController // Marks this as a REST controller; all methods return JSON
@RequestMapping("/api/peers") // Base URL: /api/peers
public class PeerController {

    private final LocalNetService localNetService; // Service handling peer storage and logic
    private final LocalNetWebSocketHandler localNetWebSocketHandler; // Broadcasts real-time events via WebSocket

    public PeerController(LocalNetService localNetService, LocalNetWebSocketHandler localNetWebSocketHandler) { // Constructor injection
        this.localNetService = localNetService; // Store service reference
        this.localNetWebSocketHandler = localNetWebSocketHandler; // Store WebSocket handler reference
    }

    @GetMapping // GET /api/peers — returns all registered peers
    public List<Peer> getPeers() {
        return localNetService.getPeers(); // Delegates to service; returns sorted peer list
    }

    @PostMapping("/broadcast") // POST /api/peers/broadcast — registers a new peer on the network
    public Peer registerPeer(@Valid @RequestBody RegisterPeerRequest request, HttpServletRequest servletRequest) { // @Valid enforces @NotBlank on fields
        Peer peer = localNetService.registerPeer(request.deviceName(), request.avatar(), resolveClientIp(servletRequest)); // Create peer with resolved IP
        localNetWebSocketHandler.broadcast("peer.updated", Map.of("peerId", peer.peerId())); // Notify all WS clients of the new peer
        return peer; // Return newly created peer as JSON
    }

    private String resolveClientIp(HttpServletRequest servletRequest) { // Extracts client IP, handling reverse proxies
        String forwardedFor = servletRequest.getHeader("X-Forwarded-For"); // Check for proxy-forwarded IP header
        if (forwardedFor != null && !forwardedFor.isBlank()) { // If header exists and is not empty
            return forwardedFor.split(",")[0].trim(); // Take the first IP (original client) from the comma-separated list
        }

        return servletRequest.getRemoteAddr(); // Fallback: use the direct connection IP
    }
}
