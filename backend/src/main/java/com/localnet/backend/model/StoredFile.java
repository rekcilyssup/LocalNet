package com.localnet.backend.model;

import java.nio.file.Path; // Represents the filesystem location of the stored file

public record StoredFile( // Metadata record for a file saved to disk
        String fileId, // Unique identifier (UUID-based) for retrieval
        String originalName, // Original filename as uploaded by the client
        String contentType, // MIME type (e.g. "image/png", "application/pdf")
        Path path // Absolute path to the stored file on disk
) {
}