package com.localnet.backend.config;

import org.springframework.context.annotation.Configuration; // Marks class as a Spring configuration bean
import org.springframework.web.servlet.config.annotation.CorsRegistry; // Registry for CORS mapping rules
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer; // Interface to customize Spring MVC config

@Configuration // Registers this class as a Spring-managed configuration
public class WebConfig implements WebMvcConfigurer { // Implements MVC configurer to override CORS settings

    @Override
    public void addCorsMappings(CorsRegistry registry) { // Called by Spring to register CORS rules
        registry.addMapping("/api/**") // Apply CORS to all /api/* endpoints
            .allowedOriginPatterns( // Whitelist local/LAN origins for cross-origin requests
                "http://localhost:*", // Allow any port on localhost
                "http://127.0.0.1:*", // Allow loopback IPv4
                "http://[::1]:*", // Allow loopback IPv6
                "http://192.168.*:*", // Allow private class C subnets
                "http://10.*:*", // Allow private class A subnets
                "http://172.*:*" // Allow private class B subnets
            )
                .allowedMethods("GET", "POST", "DELETE", "OPTIONS") // HTTP methods the frontend can use
                .allowedHeaders("*") // Accept any request header
                .allowCredentials(false); // Cookies/auth headers not required for LAN use
    }
}