package com.localnet.backend.controller;

import com.localnet.backend.model.StoredFile; // Metadata record for uploaded files
import com.localnet.backend.service.LocalNetService; // Core business logic service
import org.springframework.core.io.FileSystemResource; // Wraps a java.io.File as a Spring Resource for streaming
import org.springframework.core.io.Resource; // Abstraction for a readable resource (used in response body)
import org.springframework.http.HttpHeaders; // Constants for standard HTTP headers
import org.springframework.http.MediaType; // Constants and parser for MIME types
import org.springframework.http.ResponseEntity; // Builder for full HTTP responses (status + headers + body)
import org.springframework.web.bind.annotation.GetMapping; // Maps GET requests
import org.springframework.web.bind.annotation.PathVariable; // Binds URL path segments to method params
import org.springframework.web.bind.annotation.PostMapping; // Maps POST requests
import org.springframework.web.bind.annotation.RequestMapping; // Sets base URL path for this controller
import org.springframework.web.bind.annotation.RequestParam; // Binds query/form params to method params
import org.springframework.web.bind.annotation.RestController; // Marks class as a REST controller
import org.springframework.web.multipart.MultipartFile; // Represents an uploaded file in multipart requests
import org.springframework.web.server.ResponseStatusException; // Throws HTTP error responses with status codes

import java.util.Map; // Used for returning JSON key-value responses

import static org.springframework.http.HttpStatus.BAD_REQUEST; // 400 status code
import static org.springframework.http.HttpStatus.NOT_FOUND; // 404 status code

@RestController // Marks this as a REST controller returning JSON
@RequestMapping("/api/files") // Base URL: /api/files
public class FileController {

    private final LocalNetService localNetService; // Service handling file storage logic

    public FileController(LocalNetService localNetService) { // Constructor injection of the service
        this.localNetService = localNetService; // Store service reference
    }

    @PostMapping("/request") // POST /api/files/request — checks if file transfer is allowed
    public Map<String, Boolean> requestFileTransfer() {
        return Map.of("approved", true); // Always approves (placeholder for future access control)
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE) // POST /api/files/upload — accepts multipart file uploads
    public Map<String, String> upload(@RequestParam("file") MultipartFile file) { // Binds the "file" form field
        try {
            StoredFile storedFile = localNetService.storeFile(file); // Save file to disk and get metadata
            return Map.of("fileId", storedFile.fileId()); // Return the generated file ID to the client
        } catch (IllegalArgumentException exception) { // Validation errors (empty file, bad name, etc.)
            throw new ResponseStatusException(BAD_REQUEST, exception.getMessage(), exception); // Return 400
        }
    }

    @GetMapping("/download/{id}") // GET /api/files/download/{id} — downloads a previously uploaded file
    public ResponseEntity<Resource> download(@PathVariable("id") String id) { // Binds {id} from the URL path
        try {
            StoredFile storedFile = localNetService.getFile(id); // Look up file metadata by ID
            Resource resource = new FileSystemResource(storedFile.path()); // Wrap the file path as a streamable resource
            return ResponseEntity.ok() // Build a 200 OK response
                    .contentType(MediaType.parseMediaType(storedFile.contentType())) // Set the MIME type header
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + storedFile.originalName() + "\"") // Prompt browser to download with original name
                    .body(resource); // Stream the file content as the response body
        } catch (IllegalArgumentException exception) { // File not found in storage
            throw new ResponseStatusException(NOT_FOUND, exception.getMessage(), exception); // Return 404
        }
    }
}