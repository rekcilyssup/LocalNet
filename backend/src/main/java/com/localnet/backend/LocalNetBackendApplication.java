package com.localnet.backend;

import org.springframework.boot.SpringApplication; // Provides the static run() method to launch the app
import org.springframework.boot.autoconfigure.SpringBootApplication; // Enables auto-config, component scan, and Spring config
import org.springframework.scheduling.annotation.EnableScheduling; // Enables @Scheduled method support

@SpringBootApplication // Marks this as the main Spring Boot entry point with auto-configuration
@EnableScheduling // Activates scheduled task execution for peer cleanup
public class LocalNetBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(LocalNetBackendApplication.class, args); // Bootstraps and starts the Spring application context
    }
}