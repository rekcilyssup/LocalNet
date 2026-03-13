package com.localnet.backend.model;

import java.nio.file.Path;

public record StoredFile(
        String fileId,
        String originalName,
        String contentType,
        Path path
) {
}