package com.localnet.backend.model;

import jakarta.validation.constraints.NotBlank;

public record RegisterPeerRequest(
        @NotBlank String deviceName,
        @NotBlank String avatar
) {
}