package com.localnet.backend.model;

import jakarta.validation.constraints.NotBlank; // Ensures the field is not null or whitespace-only

public record RegisterPeerRequest( // DTO for incoming peer registration requests
        @NotBlank String deviceName, // Required: the name of the device joining the network
        @NotBlank String avatar // Required: emoji/icon chosen by the user
) {
}