import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Paperclip, User, X, File as FileIcon, Download, Trash2, Clock, MonitorSmartphone, Timer } from 'lucide-react';
import { cn } from './lib/utils';

type Peer = {
  peerId: string;
  deviceName: string;
  ipAddress: string;
  avatar?: string;
  isPublic?: boolean;
};

type Message = {
  messageId: string;
  text: string;
  expiresAt: number;
  isMine?: boolean;
  senderPeerId?: string;
  senderDeviceName?: string;
  senderAvatar?: string;
  fileId?: string;
  fileName?: string;
};

const AVATARS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄'];
const PUBLIC_CHAT_PEER: Peer = {
  peerId: 'public_room',
  deviceName: 'Public Chat',
  ipAddress: 'Everyone on LocalNet',
  avatar: '🌐',
  isPublic: true
};

const PEER_POLL_INTERVAL_MS = 5000;
const MESSAGE_POLL_INTERVAL_MS = 2000;
const WS_RECONNECT_DELAY_MS = 2000;

const getUnreadKeyForPeer = (peer: Peer) => (peer.isPublic ? PUBLIC_CHAT_PEER.peerId : peer.peerId);

const getMessagesEndpoint = (peer: Peer, viewerPeerId: string) =>
  peer.isPublic
    ? `/api/messages/public?viewerPeerId=${encodeURIComponent(viewerPeerId)}`
    : `/api/messages/${encodeURIComponent(peer.peerId)}?viewerPeerId=${encodeURIComponent(viewerPeerId)}`;

const getUnreadCountsEndpoint = (viewerPeerId: string) =>
  `/api/messages/unread-counts?viewerPeerId=${encodeURIComponent(viewerPeerId)}`;

const getWebSocketEndpoint = () => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) {
    try {
      const wsUrl = new URL(envBase);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.pathname = '/ws';
      wsUrl.search = '';
      wsUrl.hash = '';
      return wsUrl.toString();
    } catch (error) {
      console.error('Invalid VITE_API_BASE_URL for websocket connection', error);
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

export default function App() {
  const [myDevice, setMyDevice] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [activePeer, setActivePeer] = useState<Peer | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState(60);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePeerRef = useRef<Peer | null>(null);
  const myDeviceRef = useRef<Peer | null>(null);

  useEffect(() => {
    activePeerRef.current = activePeer;
  }, [activePeer]);

  useEffect(() => {
    myDeviceRef.current = myDevice;
  }, [myDevice]);

  const fetchPeers = useCallback(async () => {
    const currentDevice = myDeviceRef.current;
    if (!currentDevice) {
      return;
    }

    try {
      const res = await fetch('/api/peers');
      if (!res.ok) {
        throw new Error(`Failed to fetch peers (${res.status})`);
      }
      const data = await res.json();
      setPeers(data.filter((p: Peer) => p.peerId !== currentDevice.peerId));
    } catch (e) {
      console.error('Failed to fetch peers', e);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    const currentDevice = myDeviceRef.current;
    const currentPeer = activePeerRef.current;
    if (!currentDevice || !currentPeer) {
      return;
    }

    try {
      const res = await fetch(getMessagesEndpoint(currentPeer, currentDevice.peerId));
      if (!res.ok) {
        throw new Error(`Failed to fetch messages (${res.status})`);
      }
      const data = await res.json();
      setMessages(data);
    } catch (e) {
      console.error('Failed to fetch messages', e);
    }
  }, []);

  const fetchUnreadCounts = useCallback(async () => {
    const currentDevice = myDeviceRef.current;
    if (!currentDevice) {
      return;
    }

    try {
      const res = await fetch(getUnreadCountsEndpoint(currentDevice.peerId));
      if (!res.ok) {
        throw new Error(`Failed to fetch unread counts (${res.status})`);
      }

      const data = await res.json() as Record<string, unknown>;
      const normalizedCounts: Record<string, number> = {};
      for (const [key, value] of Object.entries(data)) {
        const count = Number(value);
        if (Number.isFinite(count) && count > 0) {
          normalizedCounts[key] = count;
        }
      }
      setUnreadCounts(normalizedCounts);
    } catch (e) {
      console.error('Failed to fetch unread counts', e);
    }
  }, []);

  useEffect(() => {
    if (!myDevice) {
      return;
    }
    void fetchPeers();
    void fetchUnreadCounts();
  }, [myDevice, fetchPeers, fetchUnreadCounts]);

  useEffect(() => {
    if (!myDevice || !activePeer) {
      setMessages([]);
      return;
    }
    const syncActiveConversation = async () => {
      await fetchMessages();
      await fetchUnreadCounts();
    };
    void syncActiveConversation();
  }, [activePeer, myDevice, fetchMessages, fetchUnreadCounts]);

  useEffect(() => {
    if (!activePeer) {
      return;
    }

    const unreadKey = getUnreadKeyForPeer(activePeer);
    setUnreadCounts((prev) => {
      if (!prev[unreadKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[unreadKey];
      return next;
    });
  }, [activePeer]);

  useEffect(() => {
    if (!myDevice) {
      return;
    }

    let socket: WebSocket | null = null;
    let peerPollInterval: ReturnType<typeof setInterval> | null = null;
    let messagePollInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const startPollingFallback = () => {
      if (!peerPollInterval) {
        peerPollInterval = setInterval(() => {
          void fetchPeers();
        }, PEER_POLL_INTERVAL_MS);
      }
      if (!messagePollInterval) {
        messagePollInterval = setInterval(() => {
          void fetchMessages();
          void fetchUnreadCounts();
        }, MESSAGE_POLL_INTERVAL_MS);
      }
    };

    const stopPollingFallback = () => {
      if (peerPollInterval) {
        clearInterval(peerPollInterval);
        peerPollInterval = null;
      }
      if (messagePollInterval) {
        clearInterval(messagePollInterval);
        messagePollInterval = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimeout) {
        return;
      }
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, WS_RECONNECT_DELAY_MS);
    };

    const handleRealtimeEvent = (rawData: string) => {
      try {
        const event = JSON.parse(rawData) as { type?: string };
        if (event.type === 'peer.updated') {
          void fetchPeers();
          void fetchUnreadCounts();
          return;
        }
        if (event.type === 'message.updated') {
          void fetchMessages();
          void fetchUnreadCounts();
          return;
        }
      } catch (error) {
        console.error('Failed to parse websocket event', error);
      }

      void fetchPeers();
      void fetchMessages();
      void fetchUnreadCounts();
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      startPollingFallback();
      try {
        socket = new WebSocket(getWebSocketEndpoint());
      } catch (error) {
        console.error('Failed to create websocket connection', error);
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        stopPollingFallback();
        void fetchPeers();
        void fetchMessages();
        void fetchUnreadCounts();
      };

      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          handleRealtimeEvent(event.data);
          return;
        }
        void fetchPeers();
        void fetchMessages();
        void fetchUnreadCounts();
      };

      socket.onerror = () => {
        // Let onclose handle fallback and reconnection.
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }
        startPollingFallback();
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      disposed = true;
      stopPollingFallback();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    };
  }, [myDevice, fetchPeers, fetchMessages, fetchUnreadCounts]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleJoin = async (deviceName: string, avatar: string) => {
    try {
      const res = await fetch('/api/peers/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName, avatar })
      });
      if (!res.ok) {
        throw new Error(`Failed to broadcast presence (${res.status})`);
      }
      setMyDevice(await res.json());
    } catch (e) {
      console.error("Failed to broadcast presence", e);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activePeer || !myDevice || (!inputText.trim() && !selectedFile)) return;

    let fileId;
    let fileName;

    if (selectedFile) {
      try {
        const requestRes = await fetch('/api/files/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: selectedFile.name, fileSize: selectedFile.size, fileType: selectedFile.type })
        });
        if (!requestRes.ok) {
          throw new Error(`Failed to request file transfer (${requestRes.status})`);
        }

        const formData = new FormData();
        formData.append('file', selectedFile);
        const uploadRes = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData
        });
        if (!uploadRes.ok) {
          throw new Error(`Failed to upload file (${uploadRes.status})`);
        }
        const uploadData = await uploadRes.json();
        if (!uploadData.fileId) {
          throw new Error('Upload response did not include fileId');
        }
        fileId = uploadData.fileId;
        fileName = selectedFile.name;
      } catch (e) {
        console.error("File upload failed", e);
        return;
      }
    }

    try {
      const sendRes = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderPeerId: myDevice.peerId,
          targetPeerId: activePeer.isPublic ? undefined : activePeer.peerId,
          targetIp: activePeer.isPublic ? undefined : activePeer.ipAddress,
          text: inputText,
          ttlSeconds,
          fileId,
          fileName
        })
      });
      if (!sendRes.ok) {
        throw new Error(`Failed to send message (${sendRes.status})`);
      }

      setInputText('');
      setSelectedFile(null);
      
      // Optimistic fetch
      const res = await fetch(getMessagesEndpoint(activePeer, myDevice.peerId));
      if (!res.ok) {
        throw new Error(`Failed to refresh messages (${res.status})`);
      }
      setMessages(await res.json());
      void fetchUnreadCounts();
    } catch (e) {
      console.error("Failed to send message", e);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    if (!myDevice) return;
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(id)}?requesterPeerId=${encodeURIComponent(myDevice.peerId)}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Failed to delete message (${res.status})`);
      }
      setMessages(prev => prev.filter(m => m.messageId !== id));
      void fetchUnreadCounts();
    } catch (e) {
      console.error("Failed to delete message", e);
    }
  };

  const handleExpire = (id: string) => {
    setMessages(prev => prev.filter(m => m.messageId !== id));
  };

  const handleOpenPeer = (peer: Peer) => {
    setActivePeer(peer);
    const unreadKey = getUnreadKeyForPeer(peer);
    setUnreadCounts((prev) => {
      if (!prev[unreadKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[unreadKey];
      return next;
    });
  };

  const getUnreadCount = (peer: Peer) => unreadCounts[getUnreadKeyForPeer(peer)] ?? 0;
  const publicUnreadCount = getUnreadCount(PUBLIC_CHAT_PEER);

  if (!myDevice) {
    return <JoinScreen onJoin={handleJoin} />;
  }

  return (
    <div className="premium-shell relative h-[100dvh] overflow-hidden p-3 md:p-5 text-zinc-50">
      <div className="pointer-events-none absolute -left-28 top-16 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-12 h-80 w-80 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="relative z-10 flex h-full flex-col gap-3 md:flex-row">
      {/* Sidebar */}
      <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/45 backdrop-blur-xl md:w-80">
        <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300/25 via-indigo-400/20 to-indigo-600/30 text-xl shadow-inner shadow-cyan-100/10">
            {myDevice.avatar}
          </div>
          <div>
            <h2 className="font-semibold tracking-tight text-slate-100">{myDevice.deviceName}</h2>
            <p className="flex items-center gap-1 text-xs font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"></span>
              Online on LocalNet
            </p>
          </div>
        </div>
        
        <div className="flex-1 space-y-1 overflow-y-auto p-3 md:p-4">
          <h3 className="mb-3 mt-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Nearby Peers</h3>
          <button
            onClick={() => handleOpenPeer(PUBLIC_CHAT_PEER)}
            className={cn(
              "w-full rounded-2xl border p-3 text-left transition-all duration-300 flex items-center gap-3",
              activePeer?.isPublic
                ? "border-cyan-300/35 bg-gradient-to-r from-cyan-300/20 to-indigo-400/15 shadow-lg shadow-cyan-500/10"
                : "border-transparent bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.06]"
            )}
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg">
              {PUBLIC_CHAT_PEER.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium text-slate-100">{PUBLIC_CHAT_PEER.deviceName}</p>
              <p className="truncate text-xs text-slate-400">{PUBLIC_CHAT_PEER.ipAddress}</p>
            </div>
            {publicUnreadCount > 0 && <UnreadBadge count={publicUnreadCount} />}
          </button>

          {peers.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-400">
              <MonitorSmartphone className="mx-auto mb-2 h-8 w-8 opacity-25" />
              No peers found on network
            </div>
          ) : (
            peers.map(peer => {
              const unreadCount = getUnreadCount(peer);
              return (
                <button
                  key={peer.peerId}
                  onClick={() => handleOpenPeer(peer)}
                  className={cn(
                    "w-full rounded-2xl border p-3 text-left transition-all duration-300 flex items-center gap-3",
                    activePeer?.peerId === peer.peerId
                      ? "border-cyan-300/35 bg-gradient-to-r from-cyan-300/15 to-indigo-400/15 shadow-lg shadow-cyan-500/10"
                      : "border-transparent bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.06]"
                  )}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg">
                    {peer.avatar || '👤'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-slate-100">{peer.deviceName}</p>
                    <p className="truncate text-xs text-slate-400">{peer.ipAddress}</p>
                  </div>
                  {unreadCount > 0 && <UnreadBadge count={unreadCount} />}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/45 shadow-2xl shadow-black/45 backdrop-blur-xl">
        {activePeer ? (
          <>
            <header className="z-10 flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-5 py-4 md:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-xl">
                  {activePeer.avatar || '👤'}
                </div>
                <div>
                  <h2 className="font-semibold tracking-tight text-slate-100">{activePeer.deviceName}</h2>
                  <p className="text-xs text-slate-400">{activePeer.ipAddress}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] p-1">
                <Timer className="ml-2 h-4 w-4 text-slate-300" />
                <select 
                  value={ttlSeconds}
                  onChange={(e) => setTtlSeconds(Number(e.target.value))}
                  className="cursor-pointer border-none bg-transparent py-1 pr-8 text-sm text-slate-100 focus:ring-0"
                >
                  <option value={10}>10 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={300}>5 minutes</option>
                  <option value={3600}>1 hour</option>
                </select>
              </div>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-5 md:p-6">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center space-y-4 text-slate-400">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.06]">
                    <Send className="h-8 w-8 opacity-60" />
                  </div>
                  <p className="text-center text-sm md:text-base">
                    {activePeer.isPublic
                      ? 'Send a premium, ephemeral message to everyone on LocalNet'
                      : `Send a premium, ephemeral message to ${activePeer.deviceName}`}
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const showPublicSender = !!activePeer.isPublic && !msg.isMine;
                  return (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    key={msg.messageId}
                    className={cn("flex max-w-[90%] flex-col gap-1 md:max-w-[78%]", msg.isMine ? "ml-auto items-end" : "items-start")}
                  >
                    <div className="flex items-center gap-2 px-1">
                      <Countdown expiresAt={msg.expiresAt} onExpire={() => handleExpire(msg.messageId)} />
                      {msg.isMine && (
                        <button onClick={() => handleDeleteMessage(msg.messageId)} className="text-slate-500 transition-colors hover:text-rose-300">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className={cn("flex items-end gap-2", msg.isMine && "flex-row-reverse")}>
                      {showPublicSender && (
                        <div className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-sm shadow-lg shadow-black/20">
                          {msg.senderAvatar || '👤'}
                        </div>
                      )}
                      <div className={cn(
                        "rounded-2xl border px-4 py-3 shadow-sm backdrop-blur",
                        msg.isMine
                          ? "rounded-tr-sm border-cyan-200/25 bg-gradient-to-br from-cyan-400/85 to-indigo-500/85 text-white"
                          : "rounded-tl-sm border-white/15 bg-white/[0.07] text-slate-100"
                      )}>
                      {activePeer.isPublic && (
                        <p className={cn(
                          "mb-1 text-xs font-medium",
                          msg.isMine ? "text-cyan-100" : "text-slate-300"
                        )}>
                          {msg.isMine ? 'You' : (msg.senderDeviceName || 'Unknown')}
                        </p>
                      )}
                      {msg.fileId && (
                        <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/15 bg-black/20 p-3">
                          <FileIcon className="h-5 w-5 opacity-80" />
                          <span className="max-w-[150px] truncate text-sm">{msg.fileName}</span>
                          <a href={`/api/files/download/${msg.fileId}`} download={msg.fileName} className="ml-auto rounded-lg bg-white/10 p-1.5 transition-colors hover:bg-white/20">
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      )}
                      {msg.text && <p className="text-[15px] leading-relaxed break-words">{msg.text}</p>}
                      </div>
                    </div>
                  </motion.div>
                );
                })
              )}
              <div ref={messagesEndRef} className="h-1" />
            </div>

            <footer className="z-10 border-t border-white/10 bg-white/[0.03] p-4">
              <AnimatePresence>
                {selectedFile && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="flex items-center gap-3 overflow-hidden rounded-xl border border-white/15 bg-white/[0.06] p-3"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-300/20 text-cyan-200">
                      <FileIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{selectedFile.name}</p>
                      <p className="text-xs text-slate-400">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button 
                      onClick={() => setSelectedFile(null)}
                      className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                <div className="flex flex-1 items-end overflow-hidden rounded-2xl border border-white/15 bg-white/[0.05] transition-all focus-within:border-cyan-300/45 focus-within:ring-1 focus-within:ring-cyan-300/30">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3.5 text-slate-400 transition-colors hover:text-cyan-200"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={`Message ${activePeer.deviceName}...`}
                    className="max-h-32 min-h-[52px] flex-1 resize-none border-none bg-transparent px-2 py-3.5 text-slate-100 placeholder:text-slate-500 focus:ring-0"
                    rows={1}
                    style={{ height: inputText ? 'auto' : '52px' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputText.trim() && !selectedFile}
                  className="flex-shrink-0 rounded-2xl bg-gradient-to-r from-cyan-400 to-indigo-500 p-4 text-white shadow-lg shadow-cyan-500/30 transition-all hover:from-cyan-300 hover:to-indigo-400 disabled:opacity-50 disabled:hover:from-cyan-400 disabled:hover:to-indigo-500"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-slate-400">
            <MonitorSmartphone className="mb-4 h-16 w-16 opacity-25" />
            <h2 className="mb-2 text-xl font-medium text-slate-200">Select a Peer</h2>
            <p className="max-w-md">Choose a device from the sidebar to start a secure, ephemeral chat session over your local network.</p>
          </div>
        )}
      </main>
      </div>
    </div>
  );
}

function UnreadBadge({ count }: { count: number }) {
  const displayValue = count > 99 ? '99+' : String(count);

  return (
    <span className="min-w-6 rounded-full bg-rose-500 px-2 py-0.5 text-center text-[11px] font-semibold text-white shadow-lg shadow-rose-600/40">
      {displayValue}
    </span>
  );
}

function Countdown({ expiresAt, onExpire }: { expiresAt: number, onExpire: () => void }) {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      const newTimeLeft = Math.max(0, expiresAt - Date.now());
      setTimeLeft(newTimeLeft);
      if (newTimeLeft === 0) {
        onExpire();
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
      <Clock className="w-3 h-3"/> 
      {minutes > 0 ? `${minutes}m ` : ''}{seconds}s
    </span>
  );
}

function JoinScreen({ onJoin }: { onJoin: (name: string, avatar: string) => void }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);

  return (
    <div className="premium-shell relative min-h-[100dvh] p-6 text-zinc-50">
      <div className="pointer-events-none absolute -left-16 top-10 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-20 w-20 rotate-3 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-lg shadow-cyan-500/25">
            <MonitorSmartphone className="h-10 w-10 text-white" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">LocalNet</h1>
          <p className="text-sm text-slate-300">Peer-to-peer ephemeral sharing</p>
        </div>

        <div className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/55 p-6 shadow-2xl shadow-black/45 backdrop-blur-xl">
          <div className="space-y-3">
            <label className="ml-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Choose Avatar</label>
            <div className="grid grid-cols-8 gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={cn(
                    "rounded-xl p-1 text-2xl transition-all hover:scale-110",
                    avatar === a ? "scale-110 bg-white/10 ring-2 ring-cyan-300 shadow-md shadow-cyan-500/20" : "opacity-50 hover:opacity-100"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="ml-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Device Name</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Windows-Host"
                className="w-full rounded-2xl border border-white/15 bg-white/[0.04] py-4 pl-12 pr-4 text-slate-100 placeholder:text-slate-500 transition-all focus:border-cyan-300/55 focus:outline-none focus:ring-2 focus:ring-cyan-300/35"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    onJoin(name.trim(), avatar);
                  }
                }}
              />
            </div>
          </div>

          <button
            onClick={() => name.trim() && onJoin(name.trim(), avatar)}
            disabled={!name.trim()}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-indigo-500 py-4 font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:from-cyan-300 hover:to-indigo-400 disabled:opacity-50 disabled:hover:from-cyan-400 disabled:hover:to-indigo-500 active:scale-[0.98]"
          >
            Broadcast Presence
          </button>
        </div>
      </motion.div>
      </div>
    </div>
  );
}
