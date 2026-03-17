package com.localnet.backend.websocket;

import com.fasterxml.jackson.core.JsonProcessingException; // Thrown when JSON serialization fails
import com.fasterxml.jackson.databind.ObjectMapper; // Jackson utility for converting objects to JSON strings
import org.springframework.stereotype.Component; // Marks this class as a Spring-managed bean
import org.springframework.web.socket.CloseStatus; // Represents the reason a WebSocket connection was closed
import org.springframework.web.socket.TextMessage; // Wraps a text payload for sending over WebSocket
import org.springframework.web.socket.WebSocketSession; // Represents an active WebSocket connection
import org.springframework.web.socket.handler.TextWebSocketHandler; // Base class for handling text-based WS messages

import java.io.IOException; // Thrown on I/O errors during message sending
import java.time.Instant; // Used to attach timestamps to broadcast events
import java.util.Map; // Used for constructing event payloads
import java.util.Set; // Thread-safe set for tracking active sessions
import java.util.concurrent.ConcurrentHashMap; // Provides thread-safe set via newKeySet()

@Component // Registers this handler as a Spring bean for dependency injection
public class LocalNetWebSocketHandler extends TextWebSocketHandler { // Extends Spring's text-based WS handler

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet(); // Thread-safe set of active WS sessions
    private final ObjectMapper objectMapper; // Jackson mapper for serializing events to JSON

    public LocalNetWebSocketHandler(ObjectMapper objectMapper) { // Constructor injection of Jackson mapper
        this.objectMapper = objectMapper; // Store mapper reference
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) { // Called when a new client connects via WS
        sessions.add(session); // Track the new session for future broadcasts
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) { // Called when a client disconnects
        sessions.remove(session); // Remove closed session from the tracking set
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) { // Called on transport-level errors
        sessions.remove(session); // Remove the errored session
        closeQuietly(session); // Attempt to close the session gracefully
    }

    public void broadcast(String eventType, Map<String, Object> payload) { // Sends an event to ALL connected WS clients
        if (sessions.isEmpty()) { // Skip if no clients are connected
            return;
        }

        String eventJson = toEventJson(eventType, payload); // Serialize the event into a JSON string
        if (eventJson == null) { // Skip if serialization failed
            return;
        }

        TextMessage message = new TextMessage(eventJson); // Wrap the JSON string as a WS text message
        for (WebSocketSession session : sessions) { // Iterate over all connected sessions
            if (!session.isOpen()) { // Check if the session is still alive
                sessions.remove(session); // Remove stale session
                continue; // Skip to next session
            }

            try {
                session.sendMessage(message); // Send the event to this client
            } catch (IOException exception) { // Send failed (e.g. client disconnected mid-send)
                sessions.remove(session); // Remove the failed session
                closeQuietly(session); // Attempt cleanup close
            }
        }
    }

    private String toEventJson(String eventType, Map<String, Object> payload) { // Builds a JSON event object with type, payload, and timestamp
        Map<String, Object> event = Map.of( // Construct the event structure
                "type", eventType, // Event type (e.g. "message.updated", "peer.updated")
                "payload", payload == null ? Map.of() : payload, // Event data; defaults to empty map
                "timestamp", Instant.now().toEpochMilli() // Current time in epoch milliseconds
        );

        try {
            return objectMapper.writeValueAsString(event); // Serialize the event map to a JSON string
        } catch (JsonProcessingException exception) { // Serialization error (shouldn't happen with simple maps)
            return null; // Return null to signal failure; caller skips the broadcast
        }
    }

    private void closeQuietly(WebSocketSession session) { // Gracefully closes a session, swallowing any errors
        try {
            if (session.isOpen()) { // Only attempt close if session is still open
                session.close(); // Close the WebSocket connection
            }
        } catch (IOException ignored) { // Ignore errors — this is best-effort cleanup
            // Best effort close
        }
    }
}
