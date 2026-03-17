package com.localnet.backend.controller;

import com.localnet.backend.model.MessageView; // Client-facing message DTO with resolved sender info
import com.localnet.backend.model.SendMessageRequest; // DTO for incoming send-message requests
import com.localnet.backend.service.LocalNetService; // Core business logic service
import com.localnet.backend.websocket.LocalNetWebSocketHandler; // WebSocket broadcaster for real-time events
import org.springframework.http.HttpStatus; // HTTP status code constants
import org.springframework.web.bind.annotation.DeleteMapping; // Maps HTTP DELETE requests
import org.springframework.web.bind.annotation.GetMapping; // Maps HTTP GET requests
import org.springframework.web.bind.annotation.PathVariable; // Binds URL path segments to method params
import org.springframework.web.bind.annotation.PostMapping; // Maps HTTP POST requests
import org.springframework.web.bind.annotation.RequestBody; // Binds JSON request body to method params
import org.springframework.web.bind.annotation.RequestMapping; // Sets base URL path for this controller
import org.springframework.web.bind.annotation.RequestParam; // Binds query parameters to method params
import org.springframework.web.bind.annotation.RestController; // Marks class as a REST controller
import org.springframework.web.server.ResponseStatusException; // Throws HTTP error responses with status codes

import java.util.List; // Used for returning lists of messages
import java.util.Map; // Used for returning JSON key-value responses
import java.util.NoSuchElementException; // Thrown when a requested message doesn't exist

@RestController // Marks this as a REST controller returning JSON
@RequestMapping("/api/messages") // Base URL: /api/messages
public class MessageController {

    private final LocalNetService localNetService; // Service handling message storage and logic
    private final LocalNetWebSocketHandler localNetWebSocketHandler; // Broadcasts real-time events via WebSocket

    public MessageController(LocalNetService localNetService, LocalNetWebSocketHandler localNetWebSocketHandler) { // Constructor injection
        this.localNetService = localNetService; // Store service reference
        this.localNetWebSocketHandler = localNetWebSocketHandler; // Store WebSocket handler reference
    }

    @GetMapping("/{peerId}") // GET /api/messages/{peerId} — fetches DM conversation with a specific peer
    public List<MessageView> getMessages(@PathVariable("peerId") String peerId, @RequestParam("viewerPeerId") String viewerPeerId) { // peerId = other peer, viewerPeerId = current user
        return localNetService.getMessages(viewerPeerId, peerId); // Returns messages with read-tracking side effect
    }

    @GetMapping("/public") // GET /api/messages/public — fetches all public chat messages
    public List<MessageView> getPublicMessages(@RequestParam("viewerPeerId") String viewerPeerId) { // viewerPeerId needed for isMine flag
        return localNetService.getPublicMessages(viewerPeerId); // Returns public messages and marks them as read
    }

    @GetMapping("/unread-counts") // GET /api/messages/unread-counts — returns unread message counts per conversation
    public Map<String, Integer> getUnreadCounts(@RequestParam("viewerPeerId") String viewerPeerId) { // viewerPeerId identifies who is asking
        try {
            return localNetService.getUnreadCounts(viewerPeerId); // Returns map of peerId/roomId -> unread count
        } catch (IllegalArgumentException exception) { // Invalid or missing viewerPeerId
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception); // Return 400
        }
    }

    @PostMapping("/send") // POST /api/messages/send — sends a new message (public or direct)
    public Map<String, Object> sendMessage(@RequestBody SendMessageRequest request) { // Binds JSON body to DTO
        try {
            String messageId = localNetService.sendMessage(request); // Store the message and get its ID
            localNetWebSocketHandler.broadcast("message.updated", Map.of("messageId", messageId)); // Notify all WS clients of new message
            return Map.of("success", true, "messageId", messageId); // Return success response with message ID
        } catch (IllegalArgumentException exception) { // Validation errors (missing sender, no content, etc.)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception); // Return 400
        }
    }

    @DeleteMapping("/{id}") // DELETE /api/messages/{id} — deletes a specific message by ID
    public Map<String, Boolean> deleteMessage(@PathVariable("id") String id, @RequestParam("requesterPeerId") String requesterPeerId) { // Only sender can delete
        try {
            localNetService.deleteMessage(id, requesterPeerId); // Validate ownership and remove the message
            localNetWebSocketHandler.broadcast("message.updated", Map.of("messageId", id)); // Notify all WS clients of deletion
            return Map.of("success", true); // Return success response
        } catch (IllegalArgumentException exception) { // Invalid input parameters
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception); // Return 400
        } catch (SecurityException exception) { // Requester is not the original sender
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, exception.getMessage(), exception); // Return 403
        } catch (NoSuchElementException exception) { // Message ID not found
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, exception.getMessage(), exception); // Return 404
        }
    }
}
