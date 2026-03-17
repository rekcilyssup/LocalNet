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
import java.util.Map; // Generic Map for unstructured JSON output

import org.springframework.scheduling.annotation.Scheduled; // Enables scheduled task execution

@RestController // Marks this class as a Spring REST controller, returning JSON
@RequestMapping("/api/peers") // Base URL for all endpoints in this class
public class PeerController { // Handles peer registration and discovery

    private final LocalNetService localNetService; // Core business logic
    private final LocalNetWebSocketHandler localNetWebSocketHandler; // WebSocket handler for broadcasting events

    public PeerController(LocalNetService localNetService, LocalNetWebSocketHandler localNetWebSocketHandler) { // Dependency injection via constructor
        this.localNetService = localNetService;
        this.localNetWebSocketHandler = localNetWebSocketHandler;
    }

    @GetMapping // GET /api/peers — returns all registered peers
    public List<Peer> getPeers() {
        return localNetService.getPeers(); // Delegates to service; returns sorted peer list
    }

    @PostMapping("/broadcast") // POST /api/peers/broadcast — registers a new peer
    public Peer broadcastPresence(@Valid @RequestBody RegisterPeerRequest request, HttpServletRequest httpRequest) { // Validates input DTO
        String ipAddress = getClientIp(httpRequest); // Resolve client's LAN IP address
        Peer peer = localNetService.registerPeer(request.deviceName(), request.avatar(), ipAddress); // Register in the service
        
        try {
            localNetWebSocketHandler.broadcast("peer.updated", Map.of("peerId", peer.peerId())); // Notify all clients a new peer joined
        } catch (Exception e) { // Catch broadcast errors so registration still succeeds
            // Ignore broadcast errors
        }
        
        return peer; // Return the assigned peer identity to the client
    }

    @PostMapping("/heartbeat") // POST /api/peers/heartbeat — updates peer last-seen timestamp
    public Peer heartbeat(@RequestBody Map<String, String> body) {
        String peerId = body.get("peerId");
        return localNetService.heartbeat(peerId);
    }

    @Scheduled(fixedRate = 10000) // Runs every 10 seconds
    public void cleanupStalePeers() {
        // Remove peers that haven't sent a heartbeat in 30 seconds
        var removedPeerIds = localNetService.removeExpiredPeers(30000);
        if (!removedPeerIds.isEmpty()) {
            try {
                // If any peers were removed, tell clients to re-fetch the peer list
                localNetWebSocketHandler.broadcast("peer.updated", Map.of("event", "cleanup"));
            } catch (Exception e) {
                // Ignore broadcast errors
            }
        }
    }

    private String getClientIp(HttpServletRequest servletRequest) { // Extracts client IP, handling reverse proxies
        String forwardedFor = servletRequest.getHeader("X-Forwarded-For"); // Check for proxy-forwarded IP header
        if (forwardedFor != null && !forwardedFor.isBlank()) { // If header exists and is not empty
            return forwardedFor.split(",")[0].trim(); // Take the first IP (original client) from the comma-separated list
        }

        return servletRequest.getRemoteAddr(); // Fallback: use the direct connection IP
    }
}
