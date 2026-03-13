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
  const messages = new Map();

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

  app.get("/api/messages/:peerId", (req, res) => {
    const { peerId } = req.params;
    const peerMsgs = messages.get(peerId) || [];
    // Filter out expired messages
    const now = Date.now();
    const validMsgs = peerMsgs.filter((m: any) => m.expiresAt > now);
    messages.set(peerId, validMsgs);
    res.json(validMsgs);
  });

  app.post("/api/messages/send", (req, res) => {
    const { targetIp, text, ttlSeconds, fileId, fileName } = req.body;
    // Find peer by IP or ID
    const peer = Array.from(peers.values()).find(p => p.ipAddress === targetIp || p.peerId === targetIp);
    const peerId = peer ? peer.peerId : targetIp;

    if (!messages.has(peerId)) messages.set(peerId, []);
    const msg = {
      messageId: "msg_" + Date.now(),
      text,
      expiresAt: Date.now() + (ttlSeconds || 60) * 1000,
      isMine: true,
      fileId,
      fileName
    };
    messages.get(peerId).push(msg);

    // Mock an auto-reply for demonstration purposes
    setTimeout(() => {
      if (messages.has(peerId)) {
        messages.get(peerId).push({
          messageId: "msg_" + Date.now() + "_reply",
          text: "Received your message! (Auto-reply)",
          expiresAt: Date.now() + (ttlSeconds || 60) * 1000,
          isMine: false
        });
      }
    }, 1500);

    res.json({ success: true, messageId: msg.messageId });
  });

  app.delete("/api/messages/:id", (req, res) => {
    const { id } = req.params;
    for (const [peerId, peerMsgs] of messages.entries()) {
      messages.set(peerId, peerMsgs.filter((m: any) => m.messageId !== id));
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
