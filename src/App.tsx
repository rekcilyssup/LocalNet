import React, { useState, useEffect, useRef } from 'react';
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

export default function App() {
  const [myDevice, setMyDevice] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [activePeer, setActivePeer] = useState<Peer | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState(60);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getMessagesEndpoint = (peer: Peer, viewerPeerId: string) =>
    peer.isPublic
      ? `/api/messages/public?viewerPeerId=${encodeURIComponent(viewerPeerId)}`
      : `/api/messages/${encodeURIComponent(peer.peerId)}?viewerPeerId=${encodeURIComponent(viewerPeerId)}`;

  // Polling for peers
  useEffect(() => {
    if (!myDevice) return;
    const fetchPeers = async () => {
      try {
        const res = await fetch('/api/peers');
        if (!res.ok) {
          throw new Error(`Failed to fetch peers (${res.status})`);
        }
        const data = await res.json();
        setPeers(data.filter((p: Peer) => p.peerId !== myDevice.peerId));
      } catch (e) {
        console.error("Failed to fetch peers", e);
      }
    };
    fetchPeers();
    const interval = setInterval(fetchPeers, 5000);
    return () => clearInterval(interval);
  }, [myDevice]);

  // Polling for messages
  useEffect(() => {
    if (!activePeer || !myDevice) return;
    const fetchMessages = async () => {
      try {
        const res = await fetch(getMessagesEndpoint(activePeer, myDevice.peerId));
        if (!res.ok) {
          throw new Error(`Failed to fetch messages (${res.status})`);
        }
        const data = await res.json();
        setMessages(data);
      } catch (e) {
        console.error("Failed to fetch messages", e);
      }
    };
    fetchMessages();
    const interval = setInterval(fetchMessages, 2000);
    return () => clearInterval(interval);
  }, [activePeer, myDevice]);

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
    } catch (e) {
      console.error("Failed to delete message", e);
    }
  };

  const handleExpire = (id: string) => {
    setMessages(prev => prev.filter(m => m.messageId !== id));
  };

  if (!myDevice) {
    return <JoinScreen onJoin={handleJoin} />;
  }

  return (
    <div className="flex h-[100dvh] bg-zinc-950 text-zinc-50 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r border-zinc-900 bg-zinc-950/50 flex flex-col">
        <div className="p-4 border-b border-zinc-900 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-xl">
            {myDevice.avatar}
          </div>
          <div>
            <h2 className="font-semibold text-zinc-100">{myDevice.deviceName}</h2>
            <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Online on LocalNet
            </p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-2 mb-3 mt-2">Nearby Peers</h3>
          <button
            onClick={() => setActivePeer(PUBLIC_CHAT_PEER)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left",
              activePeer?.isPublic ? "bg-indigo-600/10 border border-indigo-500/20" : "hover:bg-zinc-900 border border-transparent"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-lg flex-shrink-0">
              {PUBLIC_CHAT_PEER.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-200 truncate">{PUBLIC_CHAT_PEER.deviceName}</p>
              <p className="text-xs text-zinc-500 truncate">{PUBLIC_CHAT_PEER.ipAddress}</p>
            </div>
          </button>

          {peers.length === 0 ? (
            <div className="text-center p-4 text-zinc-500 text-sm">
              <MonitorSmartphone className="w-8 h-8 mx-auto mb-2 opacity-20" />
              No peers found on network
            </div>
          ) : (
            peers.map(peer => (
              <button
                key={peer.peerId}
                onClick={() => setActivePeer(peer)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left",
                  activePeer?.peerId === peer.peerId ? "bg-indigo-600/10 border border-indigo-500/20" : "hover:bg-zinc-900 border border-transparent"
                )}
              >
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-lg flex-shrink-0">
                  {peer.avatar || '👤'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-200 truncate">{peer.deviceName}</p>
                  <p className="text-xs text-zinc-500 truncate">{peer.ipAddress}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {activePeer ? (
          <>
            <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-xl">
                  {activePeer.avatar || '👤'}
                </div>
                <div>
                  <h2 className="font-semibold text-zinc-100">{activePeer.deviceName}</h2>
                  <p className="text-xs text-zinc-500">{activePeer.ipAddress}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                <Timer className="w-4 h-4 text-zinc-500 ml-2" />
                <select 
                  value={ttlSeconds}
                  onChange={(e) => setTtlSeconds(Number(e.target.value))}
                  className="bg-transparent text-sm text-zinc-300 border-none focus:ring-0 py-1 pr-8 cursor-pointer"
                >
                  <option value={10}>10 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={300}>5 minutes</option>
                  <option value={3600}>1 hour</option>
                </select>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center">
                    <Send className="w-8 h-8 opacity-50" />
                  </div>
                  <p>
                    {activePeer.isPublic
                      ? 'Send a secure, ephemeral message to everyone on LocalNet'
                      : `Send a secure, ephemeral message to ${activePeer.deviceName}`}
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    key={msg.messageId}
                    className={cn("flex flex-col gap-1 max-w-[75%]", msg.isMine ? "ml-auto items-end" : "items-start")}
                  >
                    <div className="flex items-center gap-2 px-1">
                      <Countdown expiresAt={msg.expiresAt} onExpire={() => handleExpire(msg.messageId)} />
                      {msg.isMine && (
                        <button onClick={() => handleDeleteMessage(msg.messageId)} className="text-zinc-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className={cn(
                      "px-4 py-3 rounded-2xl shadow-sm",
                      msg.isMine 
                        ? "bg-indigo-600 text-white rounded-tr-sm" 
                        : "bg-zinc-800 text-zinc-100 rounded-tl-sm"
                    )}>
                      {activePeer.isPublic && (
                        <p className={cn(
                          "text-xs mb-1 font-medium",
                          msg.isMine ? "text-indigo-100" : "text-zinc-400"
                        )}>
                          {msg.isMine ? 'You' : (msg.senderDeviceName || 'Unknown')}
                        </p>
                      )}
                      {msg.fileId && (
                        <div className="mb-2 p-3 rounded-xl bg-black/20 flex items-center gap-3">
                          <FileIcon className="w-5 h-5 opacity-70" />
                          <span className="text-sm truncate max-w-[150px]">{msg.fileName}</span>
                          <a href={`/api/files/download/${msg.fileId}`} download={msg.fileName} className="ml-auto p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      )}
                      {msg.text && <p className="text-[15px] leading-relaxed break-words">{msg.text}</p>}
                    </div>
                  </motion.div>
                ))
              )}
              <div ref={messagesEndRef} className="h-1" />
            </div>

            <footer className="p-4 bg-zinc-950 border-t border-zinc-900 z-10">
              <AnimatePresence>
                {selectedFile && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="flex items-center gap-3 bg-zinc-900 p-3 rounded-xl border border-zinc-800 overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center flex-shrink-0">
                      <FileIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">{selectedFile.name}</p>
                      <p className="text-xs text-zinc-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button 
                      onClick={() => setSelectedFile(null)}
                      className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-full transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                <div className="flex-1 bg-zinc-900 rounded-2xl border border-zinc-800 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all flex items-end overflow-hidden">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3.5 text-zinc-400 hover:text-indigo-400 transition-colors"
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
                    className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-100 placeholder:text-zinc-600 resize-none py-3.5 px-2 max-h-32 min-h-[52px]"
                    rows={1}
                    style={{ height: inputText ? 'auto' : '52px' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputText.trim() && !selectedFile}
                  className="p-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors flex-shrink-0 shadow-sm"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-6 text-center">
            <MonitorSmartphone className="w-16 h-16 mb-4 opacity-20" />
            <h2 className="text-xl font-medium text-zinc-300 mb-2">Select a Peer</h2>
            <p className="max-w-md">Choose a device from the sidebar to start a secure, ephemeral chat session over your local network.</p>
          </div>
        )}
      </main>
    </div>
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
    <span className="text-[10px] text-zinc-500 flex items-center gap-1 font-mono">
      <Clock className="w-3 h-3"/> 
      {minutes > 0 ? `${minutes}m ` : ''}{seconds}s
    </span>
  );
}

function JoinScreen({ onJoin }: { onJoin: (name: string, avatar: string) => void }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);

  return (
    <div className="min-h-[100dvh] bg-zinc-950 flex flex-col items-center justify-center p-6 font-sans text-zinc-50">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8"
      >
        <div className="text-center space-y-2">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl mx-auto flex items-center justify-center shadow-lg shadow-indigo-500/20 rotate-3">
            <MonitorSmartphone className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-6">LocalNet</h1>
          <p className="text-zinc-400 text-sm">Peer-to-peer ephemeral sharing</p>
        </div>

        <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800/50 backdrop-blur-xl space-y-6 shadow-xl">
          <div className="space-y-3">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider ml-1">Choose Avatar</label>
            <div className="grid grid-cols-8 gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={cn(
                    "text-2xl p-1 rounded-xl transition-all hover:scale-110",
                    avatar === a ? "bg-zinc-800 ring-2 ring-indigo-500 scale-110 shadow-md" : "opacity-50 hover:opacity-100"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider ml-1">Device Name</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Windows-Host"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
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
            className="w-full bg-indigo-600 text-white font-semibold py-4 rounded-2xl hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/25 active:scale-[0.98]"
          >
            Broadcast Presence
          </button>
        </div>
      </motion.div>
    </div>
  );
}
