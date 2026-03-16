package com.localnet.backend.config;

import com.localnet.backend.websocket.LocalNetWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final LocalNetWebSocketHandler localNetWebSocketHandler;

    public WebSocketConfig(LocalNetWebSocketHandler localNetWebSocketHandler) {
        this.localNetWebSocketHandler = localNetWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(localNetWebSocketHandler, "/ws")
                .setAllowedOriginPatterns("*");
    }
}
