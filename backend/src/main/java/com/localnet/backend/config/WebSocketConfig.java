package com.localnet.backend.config;

import com.localnet.backend.websocket.LocalNetWebSocketHandler; // Custom handler for WebSocket events
import org.springframework.context.annotation.Configuration; // Marks class as a Spring configuration bean
import org.springframework.web.socket.config.annotation.EnableWebSocket; // Activates WebSocket support in Spring
import org.springframework.web.socket.config.annotation.WebSocketConfigurer; // Interface to register WebSocket handlers
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry; // Registry for mapping WS endpoints to handlers

@Configuration // Registers this class as a Spring-managed configuration
@EnableWebSocket // Enables WebSocket request handling in the application
public class WebSocketConfig implements WebSocketConfigurer { // Implements configurer to register WS endpoints

    private final LocalNetWebSocketHandler localNetWebSocketHandler; // Injected handler that manages WS sessions

    public WebSocketConfig(LocalNetWebSocketHandler localNetWebSocketHandler) { // Constructor injection of the WS handler
        this.localNetWebSocketHandler = localNetWebSocketHandler; // Store handler reference for registration
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) { // Called by Spring to register WS endpoints
        registry.addHandler(localNetWebSocketHandler, "/ws") // Map the handler to the /ws endpoint
                .setAllowedOriginPatterns("*"); // Allow connections from any origin (needed for LAN access)
    }
}
