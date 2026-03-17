package com.localnet.backend.controller;

import org.springframework.web.bind.annotation.GetMapping; // Maps HTTP GET requests to handler methods
import org.springframework.web.bind.annotation.RequestMapping; // Sets base URL path for all endpoints in this controller
import org.springframework.web.bind.annotation.RestController; // Combines @Controller + @ResponseBody for JSON responses

import java.net.InetAddress; // Utility to resolve the local hostname
import java.net.UnknownHostException; // Thrown when hostname cannot be resolved
import java.util.Map; // Used to return key-value JSON responses

@RestController // Marks this as a REST controller; methods return JSON directly
@RequestMapping("/api") // All routes in this controller start with /api
public class StatusController {

    @GetMapping("/status") // Handles GET /api/status — health check endpoint
    public Map<String, String> getStatus() throws UnknownHostException { // May throw if hostname lookup fails
        return Map.of( // Return an immutable map as JSON
                "status", "ok", // Indicates the server is running
                "deviceName", InetAddress.getLocalHost().getHostName() // Resolves and returns the host machine's name
        );
    }
}