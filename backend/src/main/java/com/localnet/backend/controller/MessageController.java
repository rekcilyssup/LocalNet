package com.localnet.backend.controller;

import com.localnet.backend.model.MessageView;
import com.localnet.backend.model.SendMessageRequest;
import com.localnet.backend.service.LocalNetService;
import com.localnet.backend.websocket.LocalNetWebSocketHandler;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final LocalNetService localNetService;
    private final LocalNetWebSocketHandler localNetWebSocketHandler;

    public MessageController(LocalNetService localNetService, LocalNetWebSocketHandler localNetWebSocketHandler) {
        this.localNetService = localNetService;
        this.localNetWebSocketHandler = localNetWebSocketHandler;
    }

    @GetMapping("/{peerId}")
    public List<MessageView> getMessages(@PathVariable String peerId, @RequestParam String viewerPeerId) {
        return localNetService.getMessages(viewerPeerId, peerId);
    }

    @GetMapping("/public")
    public List<MessageView> getPublicMessages(@RequestParam String viewerPeerId) {
        return localNetService.getPublicMessages(viewerPeerId);
    }

    @GetMapping("/unread-counts")
    public Map<String, Integer> getUnreadCounts(@RequestParam String viewerPeerId) {
        try {
            return localNetService.getUnreadCounts(viewerPeerId);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
        }
    }

    @PostMapping("/send")
    public Map<String, Object> sendMessage(@RequestBody SendMessageRequest request) {
        try {
            String messageId = localNetService.sendMessage(request);
            localNetWebSocketHandler.broadcast("message.updated", Map.of("messageId", messageId));
            return Map.of("success", true, "messageId", messageId);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
        }
    }

    @DeleteMapping("/{id}")
    public Map<String, Boolean> deleteMessage(@PathVariable String id, @RequestParam String requesterPeerId) {
        try {
            localNetService.deleteMessage(id, requesterPeerId);
            localNetWebSocketHandler.broadcast("message.updated", Map.of("messageId", id));
            return Map.of("success", true);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
        } catch (SecurityException exception) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, exception.getMessage(), exception);
        } catch (NoSuchElementException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, exception.getMessage(), exception);
        }
    }
}
