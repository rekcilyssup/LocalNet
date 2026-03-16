import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import path from "path";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  app.use(express.json());

  const PORT = 3000;

  // --- MOCK BACKEND FOR PREVIEW ---
  // In production, the user will replace this with their own backend.
  const peers = new Map();
  const conversations = new Map();
  const PUBLIC_CHAT_KEY = "__public__";
  const PUBLIC_ROOM_ID = "public_room";
  const readMessageIdsByViewer = new Map<string, Map<string, Set<string>>>();

  const conversationKey = (firstPeerId: string, secondPeerId: string) =>
    firstPeerId < secondPeerId ? `${firstPeerId}::${secondPeerId}` : `${secondPeerId}::${firstPeerId}`;

  const cleanupExpiredMessages = (key: string) => {
    const now = Date.now();
    const current = conversations.get(key) || [];
    const active = current.filter((m: any) => m.expiresAt > now);
    if (active.length === 0) {
      conversations.delete(key);
      return;
    }
    conversations.set(key, active);
  };

  const toMessageView = (message: any, viewerPeerId: string) => {
    const sender = peers.get(message.senderPeerId);

    return {
      messageId: message.messageId,
      text: message.text,
      expiresAt: message.expiresAt,
      isMine: message.senderPeerId === viewerPeerId,
      senderPeerId: message.senderPeerId,
      senderDeviceName: sender?.deviceName || "Unknown",
      senderAvatar: sender?.avatar || "👤",
      fileId: message.fileId,
      fileName: message.fileName,
    };
  };

  const getReadMessageIds = (viewerPeerId: string, key: string) => {
    if (!readMessageIdsByViewer.has(viewerPeerId)) {
      readMessageIdsByViewer.set(viewerPeerId, new Map());
    }
    const readByConversation = readMessageIdsByViewer.get(viewerPeerId)!;
    if (!readByConversation.has(key)) {
      readByConversation.set(key, new Set());
    }
    return readByConversation.get(key)!;
  };

  const markConversationAsRead = (viewerPeerId: string, key: string, items: any[]) => {
    if (!viewerPeerId) return;
    const readIds = getReadMessageIds(viewerPeerId, key);
    for (const message of items) {
      if (message.senderPeerId !== viewerPeerId) {
        readIds.add(message.messageId);
      }
    }
  };

  const countUnread = (viewerPeerId: string, key: string, items: any[]) => {
    const readByConversation = readMessageIdsByViewer.get(viewerPeerId);
    const readIds = readByConversation?.get(key) || new Set<string>();
    return items.filter((message: any) => message.senderPeerId !== viewerPeerId && !readIds.has(message.messageId)).length;
  };

  const getOtherPeerId = (viewerPeerId: string, key: string) => {
    const parts = key.split("::");
    if (parts.length !== 2) return null;
    if (parts[0] === viewerPeerId) return parts[1];
    if (parts[1] === viewerPeerId) return parts[0];
    return null;
  };

  const getUnreadCounts = (viewerPeerId: string) => {
    const counts: Record<string, number> = {};

    for (const key of conversations.keys()) {
      cleanupExpiredMessages(key);
    }

    for (const [key, items] of conversations.entries()) {
      const unread = countUnread(viewerPeerId, key, items);
      if (unread <= 0) continue;

      if (key === PUBLIC_CHAT_KEY) {
        counts[PUBLIC_ROOM_ID] = unread;
        continue;
      }

      const otherPeerId = getOtherPeerId(viewerPeerId, key);
      if (!otherPeerId) continue;
      counts[otherPeerId] = unread;
    }

    return counts;
  };

  app.get("/api/status", (req, res) => {
    res.json({ status: "ok", deviceName: "Windows-Host-Mock" });
  });

  app.get("/api/peers", (req, res) => {
    res.json(Array.from(peers.values()));
  });

  app.post("/api/peers/broadcast", (req, res) => {
    const { deviceName, avatar } = req.body;
    const peerId = "peer_" + Math.random().toString(36).substr(2, 9);
    const ipAddress = req.ip || "192.168.1." + Math.floor(Math.random() * 255);
    const newPeer = { peerId, deviceName, ipAddress, avatar };
    peers.set(peerId, newPeer);
    res.json(newPeer);
  });

  app.get("/api/messages/public", (req, res) => {
    const viewerPeerId = String(req.query.viewerPeerId || "");
    cleanupExpiredMessages(PUBLIC_CHAT_KEY);
    const items = conversations.get(PUBLIC_CHAT_KEY) || [];
    markConversationAsRead(viewerPeerId, PUBLIC_CHAT_KEY, items);
    res.json(items.map((m: any) => toMessageView(m, viewerPeerId)));
  });

  app.get("/api/messages/unread-counts", (req, res) => {
    const viewerPeerId = String(req.query.viewerPeerId || "");
    if (!viewerPeerId) {
      res.status(400).json({ success: false, message: "viewerPeerId is required" });
      return;
    }
    res.json(getUnreadCounts(viewerPeerId));
  });

  app.get("/api/messages/:peerId", (req, res) => {
    const { peerId } = req.params;
    const viewerPeerId = String(req.query.viewerPeerId || "");
    if (!viewerPeerId) {
      res.status(400).json({ success: false, message: "viewerPeerId is required" });
      return;
    }

    const key = conversationKey(viewerPeerId, peerId);
    cleanupExpiredMessages(key);
    const items = conversations.get(key) || [];
    markConversationAsRead(viewerPeerId, key, items);
    res.json(items.map((m: any) => toMessageView(m, viewerPeerId)));
  });

  app.post("/api/messages/send", (req, res) => {
    const { senderPeerId, targetPeerId, targetIp, text, ttlSeconds, fileId, fileName } = req.body;
    const isPublicMessage = !targetPeerId && !targetIp;

    if (!senderPeerId) {
      res.status(400).json({ success: false, message: "senderPeerId is required" });
      return;
    }

    let resolvedTargetPeerId = targetPeerId;
    if (!isPublicMessage && !resolvedTargetPeerId && targetIp) {
      const peer = Array.from(peers.values()).find((p: any) => p.ipAddress === targetIp);
      resolvedTargetPeerId = peer?.peerId;
    }

    if (!isPublicMessage && !resolvedTargetPeerId) {
      res.status(400).json({ success: false, message: "targetPeerId is required for direct messages" });
      return;
    }

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasFile = !!fileId;
    if (!hasText && !hasFile) {
      res.status(400).json({ success: false, message: "Message must contain text or a file" });
      return;
    }

    const key = isPublicMessage ? PUBLIC_CHAT_KEY : conversationKey(senderPeerId, resolvedTargetPeerId);
    if (!conversations.has(key)) conversations.set(key, []);

    const msg = {
      messageId: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      senderPeerId,
      targetPeerId: resolvedTargetPeerId,
      text: hasText ? text.trim() : "",
      expiresAt: Date.now() + Math.max(10, Number(ttlSeconds || 60)) * 1000,
      fileId,
      fileName
    };

    conversations.get(key).push(msg);
    cleanupExpiredMessages(key);

    res.json({ success: true, messageId: msg.messageId });
  });

  app.delete("/api/messages/:id", (req, res) => {
    const { id } = req.params;
    for (const [key, items] of conversations.entries()) {
      conversations.set(key, items.filter((m: any) => m.messageId !== id));
    }
    res.json({ success: true });
  });

  app.post("/api/files/request", (req, res) => {
    res.json({ approved: true });
  });

  // Simple mock for file upload
  app.post("/api/files/upload", (req, res) => {
    // In a real app, parse multipart/form-data
    res.json({ fileId: "mock_file_" + Date.now() });
  });

  app.get("/api/files/download/:id", (req, res) => {
    res.send("Mock file content for " + req.params.id);
  });
  // --------------------------------

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
