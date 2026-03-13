package com.localnet.backend.controller;

import com.localnet.backend.model.StoredFile;
import com.localnet.backend.service.LocalNetService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@RestController
@RequestMapping("/api/files")
public class FileController {

    private final LocalNetService localNetService;

    public FileController(LocalNetService localNetService) {
        this.localNetService = localNetService;
    }

    @PostMapping("/request")
    public Map<String, Boolean> requestFileTransfer() {
        return Map.of("approved", true);
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, String> upload(@RequestParam("file") MultipartFile file) {
        try {
            StoredFile storedFile = localNetService.storeFile(file);
            return Map.of("fileId", storedFile.fileId());
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(BAD_REQUEST, exception.getMessage(), exception);
        }
    }

    @GetMapping("/download/{id}")
    public ResponseEntity<Resource> download(@PathVariable String id) {
        try {
            StoredFile storedFile = localNetService.getFile(id);
            Resource resource = new FileSystemResource(storedFile.path());
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(storedFile.contentType()))
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + storedFile.originalName() + "\"")
                    .body(resource);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(NOT_FOUND, exception.getMessage(), exception);
        }
    }
}