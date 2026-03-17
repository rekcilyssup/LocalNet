import express from "express"; // Express framework for HTTP routing and middleware
import { createServer as createViteServer } from "vite"; // Vite dev server for HMR and asset serving
import http from "http"; // Node HTTP module to create a raw server
import path from "path"; // Utility for resolving file paths

async function startServer() { // Main async function to bootstrap the server
  const app = express(); // Create Express application instance
  const server = http.createServer(app); // Wrap Express in a raw HTTP server (needed for future WS support)
  app.use(express.json()); // Enable JSON body parsing for incoming requests

  const PORT = 3000; // Port the server listens on

  // --- MOCK BACKEND FOR PREVIEW ---
  // In production, the user will replace this with their own backend.
  const peers = new Map(); // In-memory store of registered peers (peerId -> peer object)
  const conversations = new Map(); // In-memory store of conversations (conversationKey -> message array)
  const PUBLIC_CHAT_KEY = "__public__"; // Internal key for the public chat room
  const PUBLIC_ROOM_ID = "public_room"; // Client-facing ID for the public room
  const readMessageIdsByViewer = new Map<string, Map<string, Set<string>>>(); // Tracks which messages each viewer has read

  const conversationKey = (firstPeerId: string, secondPeerId: string) => // Creates a canonical key for a DM pair (always sorted)
    firstPeerId < secondPeerId ? `${firstPeerId}::${secondPeerId}` : `${secondPeerId}::${firstPeerId}`;

  const cleanupExpiredMessages = (key: string) => { // Removes messages past their TTL from a conversation
    const now = Date.now(); // Current timestamp in millis
    const current = conversations.get(key) || []; // Get messages or empty array
    const active = current.filter((m: any) => m.expiresAt > now); // Keep only non-expired messages
    if (active.length === 0) { // If all messages expired
      conversations.delete(key); // Remove the conversation entirely
      return;
    }
    conversations.set(key, active); // Replace with filtered messages
  };

  const toMessageView = (message: any, viewerPeerId: string) => { // Converts internal message to client-facing view
    const sender = peers.get(message.senderPeerId); // Look up sender's peer info

    return {
      messageId: message.messageId, // Unique message ID
      text: message.text, // Message text content
      expiresAt: message.expiresAt, // Expiration time in epoch millis
      isMine: message.senderPeerId === viewerPeerId, // True if the viewer sent this message
      senderPeerId: message.senderPeerId, // Sender's peer ID
      senderDeviceName: sender?.deviceName || "Unknown", // Resolved sender name, fallback "Unknown"
      senderAvatar: sender?.avatar || "👤", // Resolved sender avatar, fallback default
      fileId: message.fileId, // Attached file ID (may be undefined)
      fileName: message.fileName, // Attached file name (may be undefined)
    };
  };

  const getReadMessageIds = (viewerPeerId: string, key: string) => { // Gets or creates the read-message set for a viewer + conversation
    if (!readMessageIdsByViewer.has(viewerPeerId)) { // First time this viewer is tracked
      readMessageIdsByViewer.set(viewerPeerId, new Map()); // Create their read-tracking map
    }
    const readByConversation = readMessageIdsByViewer.get(viewerPeerId)!; // Get viewer's map (guaranteed to exist)
    if (!readByConversation.has(key)) { // First time this conversation is tracked for this viewer
      readByConversation.set(key, new Set()); // Create the read-message set
    }
    return readByConversation.get(key)!; // Return the set (guaranteed to exist)
  };

  const markConversationAsRead = (viewerPeerId: string, key: string, items: any[]) => { // Marks all messages from others as read by the viewer
    if (!viewerPeerId) return; // Skip if no viewer specified
    const readIds = getReadMessageIds(viewerPeerId, key); // Get the viewer's read set for this conversation
    for (const message of items) { // Iterate all messages
      if (message.senderPeerId !== viewerPeerId) { // Only mark messages NOT sent by the viewer
        readIds.add(message.messageId); // Add to the read set
      }
    }
  };

  const countUnread = (viewerPeerId: string, key: string, items: any[]) => { // Counts unread messages from others in a conversation
    const readByConversation = readMessageIdsByViewer.get(viewerPeerId); // Get viewer's read-tracking map
    const readIds = readByConversation?.get(key) || new Set<string>(); // Get read IDs for this conversation or empty set
    return items.filter((message: any) => message.senderPeerId !== viewerPeerId && !readIds.has(message.messageId)).length; // Count messages not sent by viewer and not yet read
  };

  const getOtherPeerId = (viewerPeerId: string, key: string) => { // Extracts the other peer's ID from a conversation key
    const parts = key.split("::"); // Split "peerA::peerB" into two parts
    if (parts.length !== 2) return null; // Invalid key format
    if (parts[0] === viewerPeerId) return parts[1]; // Viewer is first, return second
    if (parts[1] === viewerPeerId) return parts[0]; // Viewer is second, return first
    return null; // Viewer not in this conversation
  };

  const getUnreadCounts = (viewerPeerId: string) => { // Returns a map of peerId/roomId -> unread count for this viewer
    const counts: Record<string, number> = {}; // Mutable result object

    for (const key of conversations.keys()) { // Clean up expired messages across all conversations
      cleanupExpiredMessages(key);
    }

    for (const [key, items] of conversations.entries()) { // Iterate all conversations
      const unread = countUnread(viewerPeerId, key, items); // Count unread in this conversation
      if (unread <= 0) continue; // Skip if nothing unread

      if (key === PUBLIC_CHAT_KEY) { // Handle public chat separately
        counts[PUBLIC_ROOM_ID] = unread; // Use public room ID as key
        continue;
      }

      const otherPeerId = getOtherPeerId(viewerPeerId, key); // Get the other participant's ID
      if (!otherPeerId) continue; // Skip if can't resolve
      counts[otherPeerId] = unread; // Map peer ID to unread count
    }

    return counts; // Return the complete unread counts
  };

  app.get("/api/status", (req, res) => { // GET /api/status — health check endpoint
    res.json({ status: "ok", deviceName: "Windows-Host-Mock" }); // Returns hardcoded mock status
  });

  app.get("/api/peers", (req, res) => { // GET /api/peers — returns all registered peers
    res.json(Array.from(peers.values())); // Convert Map values to array and return as JSON
  });

  app.post("/api/peers/broadcast", (req, res) => { // POST /api/peers/broadcast — registers a new peer
    const { deviceName, avatar } = req.body; // Extract device name and avatar from request body
    const peerId = "peer_" + Math.random().toString(36).substr(2, 9); // Generate a random peer ID
    const ipAddress = req.ip || "192.168.1." + Math.floor(Math.random() * 255); // Use real IP or generate mock one
    const newPeer = { peerId, deviceName, ipAddress, avatar, lastSeenAt: Date.now() }; // Create peer object with initial heartbeat
    peers.set(peerId, newPeer); // Store in the peers map
    res.json(newPeer); // Return the new peer as JSON
  });

  app.post("/api/peers/heartbeat", (req, res) => { // POST /api/peers/heartbeat — updates peer last-seen timestamp
    const { peerId } = req.body;
    if (!peerId || !peers.has(peerId)) {
        res.status(404).json({ success: false, message: "Peer not found" });
        return;
    }
    const peer = peers.get(peerId);
    peer.lastSeenAt = Date.now();
    peers.set(peerId, peer);
    res.json(peer);
  });

  // Run a cleanup interval every 10 seconds to remove peers with no heartbeat in 30s
  setInterval(() => {
      const now = Date.now();
      const cutoff = now - 30000;
      for (const [peerId, peer] of peers.entries()) {
          if (peer.lastSeenAt < cutoff) {
              peers.delete(peerId);
          }
      }
  }, 10000);

  app.get("/api/messages/public", (req, res) => { // GET /api/messages/public — fetch public chat messages
    const viewerPeerId = String(req.query.viewerPeerId || ""); // Extract viewer ID from query string
    cleanupExpiredMessages(PUBLIC_CHAT_KEY); // Remove expired public messages
    const items = conversations.get(PUBLIC_CHAT_KEY) || []; // Get public messages or empty array
    markConversationAsRead(viewerPeerId, PUBLIC_CHAT_KEY, items); // Mark public messages as read by this viewer
    res.json(items.map((m: any) => toMessageView(m, viewerPeerId))); // Return client-facing message views
  });

  app.get("/api/messages/unread-counts", (req, res) => { // GET /api/messages/unread-counts — returns unread counts per conversation
    const viewerPeerId = String(req.query.viewerPeerId || ""); // Extract viewer ID from query string
    if (!viewerPeerId) { // Validate viewer ID is present
      res.status(400).json({ success: false, message: "viewerPeerId is required" }); // Return 400 if missing
      return;
    }
    res.json(getUnreadCounts(viewerPeerId)); // Return the unread counts map
  });

  app.get("/api/messages/:peerId", (req, res) => { // GET /api/messages/:peerId — fetch DM conversation with a peer
    const { peerId } = req.params; // Extract target peer ID from URL path
    const viewerPeerId = String(req.query.viewerPeerId || ""); // Extract viewer ID from query string
    if (!viewerPeerId) { // Validate viewer ID
      res.status(400).json({ success: false, message: "viewerPeerId is required" }); // Return 400 if missing
      return;
    }

    const key = conversationKey(viewerPeerId, peerId); // Build canonical conversation key
    cleanupExpiredMessages(key); // Remove expired messages
    const items = conversations.get(key) || []; // Get messages or empty array
    markConversationAsRead(viewerPeerId, key, items); // Mark messages as read
    res.json(items.map((m: any) => toMessageView(m, viewerPeerId))); // Return client-facing views
  });

  app.post("/api/messages/send", (req, res) => { // POST /api/messages/send — sends a message (public or direct)
    const { senderPeerId, targetPeerId, targetIp, text, ttlSeconds, fileId, fileName } = req.body; // Destructure request body
    const isPublicMessage = !targetPeerId && !targetIp; // Public if no target specified

    if (!senderPeerId) { // Validate sender is provided
      res.status(400).json({ success: false, message: "senderPeerId is required" }); // Return 400 if missing
      return;
    }

    let resolvedTargetPeerId = targetPeerId; // Start with the provided target ID
    if (!isPublicMessage && !resolvedTargetPeerId && targetIp) { // If no peer ID but have an IP, resolve it
      const peer = Array.from(peers.values()).find((p: any) => p.ipAddress === targetIp); // Find peer by IP
      resolvedTargetPeerId = peer?.peerId; // Use their peer ID if found
    }

    if (!isPublicMessage && !resolvedTargetPeerId) { // DM requires a resolved target
      res.status(400).json({ success: false, message: "targetPeerId is required for direct messages" }); // Return 400
      return;
    }

    const hasText = typeof text === "string" && text.trim().length > 0; // Check for non-empty text
    const hasFile = !!fileId; // Check for file attachment
    if (!hasText && !hasFile) { // Must have text or file
      res.status(400).json({ success: false, message: "Message must contain text or a file" }); // Return 400
      return;
    }

    const key = isPublicMessage ? PUBLIC_CHAT_KEY : conversationKey(senderPeerId, resolvedTargetPeerId); // Determine conversation key
    if (!conversations.has(key)) conversations.set(key, []); // Create conversation array if new

    const msg = { // Build the message object
      messageId: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), // Unique ID: timestamp + random
      senderPeerId, // Who sent it
      targetPeerId: resolvedTargetPeerId, // Who receives it
      text: hasText ? text.trim() : "", // Trimmed text or empty
      expiresAt: Date.now() + Math.max(10, Number(ttlSeconds || 60)) * 1000, // Expiration time (min 10s, default 60s)
      fileId, // Attached file ID
      fileName // Attached file name
    };

    conversations.get(key).push(msg); // Add message to the conversation
    cleanupExpiredMessages(key); // Remove any expired messages

    res.json({ success: true, messageId: msg.messageId }); // Return success with message ID
  });

  app.delete("/api/messages/:id", (req, res) => { // DELETE /api/messages/:id — deletes a message by ID
    const { id } = req.params; // Extract message ID from URL path
    for (const [key, items] of conversations.entries()) { // Search all conversations
      conversations.set(key, items.filter((m: any) => m.messageId !== id)); // Remove the message from each conversation
    }
    res.json({ success: true }); // Return success (no ownership check in mock)
  });

  app.post("/api/messages/typing", (req, res) => { // POST /api/messages/typing — mock typing endpoint
    // The mock backend doesn't implement WebSockets, so this is just a REST no-op
    // to prevent the frontend from getting 404 errors when pointing to the mock.
    res.json({ success: true });
  });

  app.post("/api/files/request", (req, res) => { // POST /api/files/request — checks if file transfer is allowed
    res.json({ approved: true }); // Always approves (mock placeholder)
  });

  // Simple mock for file upload
  app.post("/api/files/upload", (req, res) => { // POST /api/files/upload — mock file upload endpoint
    // In a real app, parse multipart/form-data
    res.json({ fileId: "mock_file_" + Date.now() }); // Returns a mock file ID based on timestamp
  });

  app.get("/api/files/download/:id", (req, res) => { // GET /api/files/download/:id — mock file download endpoint
    res.send("Mock file content for " + req.params.id); // Returns placeholder content
  });
  // --------------------------------

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") { // Development mode: use Vite dev server
    const vite = await createViteServer({ // Create Vite server in middleware mode
      server: { middlewareMode: true }, // Integrate Vite as Express middleware (no standalone server)
      appType: "spa", // Single Page Application mode for client-side routing
    });
    app.use(vite.middlewares); // Attach Vite's middleware to Express for HMR and asset serving
  } else { // Production mode: serve pre-built static files
    const distPath = path.join(process.cwd(), 'dist'); // Path to Vite's production build output
    app.use(express.static(distPath)); // Serve static files from the dist directory
    app.get('*', (req, res) => { // Catch-all route for SPA client-side routing
      res.sendFile(path.join(distPath, 'index.html')); // Always serve index.html for unmatched routes
    });
  }

  server.listen(PORT, "0.0.0.0", () => { // Start the server on all network interfaces
    console.log(`Server running on http://localhost:${PORT}`); // Log the URL for development
  });
}

startServer(); // Execute the server bootstrap function
