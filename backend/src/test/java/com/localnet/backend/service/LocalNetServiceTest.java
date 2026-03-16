package com.localnet.backend.service;

import com.localnet.backend.model.Peer;
import com.localnet.backend.model.SendMessageRequest;
import com.localnet.backend.model.StoredFile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LocalNetServiceTest {

    @TempDir
    Path tempDir;

    private LocalNetService service;

    @BeforeEach
    void setUp() throws IOException {
        service = new LocalNetService(tempDir.toString());
    }

    @Test
    void deleteMessageAllowsFutureSendsInSameConversation() {
        Peer sender = service.registerPeer("Sender", "😀", "192.168.1.10");
        Peer target = service.registerPeer("Target", "😎", "192.168.1.11");

        String firstMessageId = service.sendMessage(new SendMessageRequest(
                sender.peerId(),
                target.peerId(),
                null,
                "first",
                60L,
                null,
                null
        ));

        service.deleteMessage(firstMessageId, sender.peerId());

        assertDoesNotThrow(() -> service.sendMessage(new SendMessageRequest(
                sender.peerId(),
                target.peerId(),
                null,
                "second",
                60L,
                null,
                null
        )));
        assertEquals(1, service.getMessages(sender.peerId(), target.peerId()).size());
    }

    @Test
    void deleteMessageRejectsNonOwner() {
        Peer sender = service.registerPeer("Sender", "😀", "192.168.1.10");
        Peer nonOwner = service.registerPeer("Other", "😎", "192.168.1.11");

        String messageId = service.sendMessage(new SendMessageRequest(
                sender.peerId(),
                null,
                null,
                "public message",
                60L,
                null,
                null
        ));

        assertThrows(SecurityException.class, () -> service.deleteMessage(messageId, nonOwner.peerId()));
    }

    @Test
    void sendMessageRejectsUnknownSender() {
        Peer target = service.registerPeer("Target", "😎", "192.168.1.11");

        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class, () -> service.sendMessage(
                new SendMessageRequest(
                        "peer_unknown",
                        target.peerId(),
                        null,
                        "hello",
                        60L,
                        null,
                        null
                )
        ));

        assertTrue(exception.getMessage().contains("Unknown senderPeerId"));
    }

    @Test
    void storeFileNormalizesNameAndKeepsFileInsideStorage() throws IOException {
        MockMultipartFile multipartFile = new MockMultipartFile(
                "file",
                "../../secret.txt",
                "text/plain",
                "payload".getBytes(StandardCharsets.UTF_8)
        );

        StoredFile storedFile = service.storeFile(multipartFile);

        assertEquals("secret.txt", storedFile.originalName());
        assertTrue(storedFile.path().startsWith(tempDir.toAbsolutePath().normalize()));
        assertTrue(Files.exists(storedFile.path()));
    }

    @Test
    void unreadCountsAreTrackedAndClearedWhenConversationIsViewed() {
        Peer alice = service.registerPeer("Alice", "😀", "192.168.1.10");
        Peer bob = service.registerPeer("Bob", "😎", "192.168.1.11");

        service.sendMessage(new SendMessageRequest(
                bob.peerId(),
                alice.peerId(),
                null,
                "hi alice",
                60L,
                null,
                null
        ));

        Map<String, Integer> unreadBeforeRead = service.getUnreadCounts(alice.peerId());
        assertEquals(1, unreadBeforeRead.getOrDefault(bob.peerId(), 0));

        service.getMessages(alice.peerId(), bob.peerId());

        Map<String, Integer> unreadAfterRead = service.getUnreadCounts(alice.peerId());
        assertFalse(unreadAfterRead.containsKey(bob.peerId()));
    }

    @Test
    void publicUnreadCountsAreTrackedAndClearedWhenPublicChatIsViewed() {
        Peer alice = service.registerPeer("Alice", "😀", "192.168.1.10");
        Peer bob = service.registerPeer("Bob", "😎", "192.168.1.11");

        service.sendMessage(new SendMessageRequest(
                bob.peerId(),
                null,
                null,
                "hello everyone",
                60L,
                null,
                null
        ));

        Map<String, Integer> unreadBeforeRead = service.getUnreadCounts(alice.peerId());
        assertEquals(1, unreadBeforeRead.getOrDefault("public_room", 0));

        service.getPublicMessages(alice.peerId());

        Map<String, Integer> unreadAfterRead = service.getUnreadCounts(alice.peerId());
        assertFalse(unreadAfterRead.containsKey("public_room"));
    }
}
