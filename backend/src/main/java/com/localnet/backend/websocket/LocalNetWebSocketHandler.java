package com.localnet.backend.websocket;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class LocalNetWebSocketHandler extends TextWebSocketHandler {

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
    private final ObjectMapper objectMapper;

    public LocalNetWebSocketHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        sessions.remove(session);
        closeQuietly(session);
    }

    public void broadcast(String eventType, Map<String, Object> payload) {
        if (sessions.isEmpty()) {
            return;
        }

        String eventJson = toEventJson(eventType, payload);
        if (eventJson == null) {
            return;
        }

        TextMessage message = new TextMessage(eventJson);
        for (WebSocketSession session : sessions) {
            if (!session.isOpen()) {
                sessions.remove(session);
                continue;
            }

            try {
                session.sendMessage(message);
            } catch (IOException exception) {
                sessions.remove(session);
                closeQuietly(session);
            }
        }
    }

    private String toEventJson(String eventType, Map<String, Object> payload) {
        Map<String, Object> event = Map.of(
                "type", eventType,
                "payload", payload == null ? Map.of() : payload,
                "timestamp", Instant.now().toEpochMilli()
        );

        try {
            return objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException exception) {
            return null;
        }
    }

    private void closeQuietly(WebSocketSession session) {
        try {
            if (session.isOpen()) {
                session.close();
            }
        } catch (IOException ignored) {
            // Best effort close
        }
    }
}
