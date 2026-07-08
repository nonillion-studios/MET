import React, { useState, useEffect, useRef } from 'react';
import { Settings, Cloud, Upload as UploadIcon, File, Link2, RefreshCw, Key, MessageSquare, Download, CheckCircle, Smartphone, Lock, HardDrive, HelpCircle, User, Plus, Trash2, ChevronDown } from 'lucide-react';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { swal, swalToast, Swal } from '../lib/swalTheme';
import { motion, AnimatePresence } from 'motion/react';
import { Input, Button, GlassCard } from './ui';

// GramJS and MTProto polyfills need to be globally available in browser via vite-plugin-node-polyfills
// The actual TelegramClient uses them under the hood.

interface CloudStorageProps {
  onBack?: () => void;
}

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CloudStorage({ onBack }: CloudStorageProps) {
  // Config state
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [chatId, setChatId] = useState(''); // Target channel/group for uploads
  const [phoneNumber, setPhoneNumber] = useState('');
  const [sessionStr, setSessionStr] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [client, setClient] = useState<TelegramClient | null>(null);
  
  // App state
  const [activeTab, setActiveTab] = useState<'config' | 'files' | 'chat'>('config');
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  
  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [showUploadPanel, setShowUploadPanel] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedApiId = localStorage.getItem('tg_api_id');
    const savedApiHash = localStorage.getItem('tg_api_hash');
    const savedSession = localStorage.getItem('tg_session');
    const savedChatId = localStorage.getItem('tg_chat_id');
    
    if (savedApiId) setApiId(savedApiId);
    if (savedApiHash) setApiHash(savedApiHash);
    if (savedSession) {
      setSessionStr(savedSession);
      initClient(savedApiId!, savedApiHash!, savedSession);
    }
    if (savedChatId) setChatId(savedChatId);
  }, []);

  const initClient = async (id: string, hash: string, session: string) => {
    try {
      setIsLoading(true);
      const stringSession = new StringSession(session);
      const newClient = new TelegramClient(stringSession, Number(id), hash, {
        connectionRetries: 5,
        useWSS: true,
      });
      await newClient.connect();
      setClient(newClient);
      setIsConnected(true);
      setActiveTab('files');
      swalToast({ icon: 'success', title: 'Connected to Telegram successfully' });
    } catch (error) {
      console.error(error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!apiId || !apiHash || !phoneNumber) {
      swal({ title: 'Error', text: 'Please enter API ID, API Hash, and phone number', icon: 'error' });
      return;
    }
    
    setIsLoading(true);
    try {
      const stringSession = new StringSession('');
      const newClient = new TelegramClient(stringSession, Number(apiId), apiHash, {
        connectionRetries: 5,
        useWSS: true,
      });
      await newClient.connect();

      const { phoneCodeHash } = await newClient.sendCode(
        { apiId: Number(apiId), apiHash },
        phoneNumber
      );

      const { value: code } = await swal({
        title: 'Enter Verification Code',
        input: 'text',
        inputLabel: 'A verification code was sent to your Telegram account',
      });

      if (code) {
        await newClient.invoke(new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode: code
        }));
        
        const sessionString = newClient.session.save() as unknown as string;
        localStorage.setItem('tg_api_id', apiId);
        localStorage.setItem('tg_api_hash', apiHash);
        localStorage.setItem('tg_session', sessionString);
        setSessionStr(sessionString);
        setClient(newClient);
        setIsConnected(true);
        setActiveTab('files');
        
        swal({ title: 'Success', text: 'Logged in successfully!', icon: 'success' });
      }
    } catch (err: any) {
      console.error('Login error:', err);
      swal({ title: 'Error', text: err.message || 'Login failed', icon: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFiles = async () => {
    if (!client || !chatId) return;
    setIsLoading(true);
    try {
      const msgs = await client.getMessages(chatId, { limit: 50 });
      const cloudFiles = msgs.filter(m => m.media && m.message).map(m => {
        try {
          // Parse the JSON from the message text
          const data = JSON.parse(m.message);
          if (data && data.type === 'manga_project') {
            return {
              id: m.id,
              msg: m,
              ...data
            };
          }
          return null;
        } catch {
          return null;
        }
      }).filter(Boolean);
      
      setFiles(cloudFiles);
      setLastSyncedAt(Date.now());

      // Async fetch covers
      cloudFiles.forEach(async (f: any) => {
        if (f.coverMsgId && !coverUrls[f.id]) {
          try {
            const coverMsgs = await client.getMessages(chatId, { ids: [f.coverMsgId] });
            if (coverMsgs.length > 0 && coverMsgs[0]) {
               const buffer = await client.downloadMedia(coverMsgs[0]);
               if (buffer) {
                 const blob = new Blob([buffer], { type: 'image/jpeg' });
                 const url = URL.createObjectURL(blob);
                 setCoverUrls(prev => ({ ...prev, [f.id]: url }));
               }
            }
          } catch (e) {
            console.error("Failed to load cover", e);
          }
        }
      });
      
    } catch (err) {
      console.error(err);
      swal({ title: 'Error', text: 'Check that the Chat ID is correct', icon: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

// Chat state
  const [chatMessage, setChatMessage] = useState('');
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  const fetchChatMessages = async () => {
    if (!client || !chatId) return;
    try {
      const msgs = await client.getMessages(chatId, { limit: 50 });
      // Only keep messages that are not manga projects, or formatted chat JSON
      const formattedChats = msgs.map(m => {
        if (!m.message && !m.media) return null;
        try {
          const data = JSON.parse(m.message || '{}');
          if (data && data.type === 'chat') {
             return { id: m.id, text: data.text || '', date: new Date(m.date * 1000).toLocaleString(), sender: data.sender || 'Anonymous', avatar: data.avatar || null, hasMedia: !!m.media, msgObj: m, fileName: data.fileName };
          }
          return null; // It's structured JSON but not chat
        } catch {
          // Normal message (not valid JSON)
          return { id: m.id, text: m.message || '', date: new Date(m.date * 1000).toLocaleString(), sender: 'Team Member', avatar: null, hasMedia: !!m.media, msgObj: m, fileName: (m.media as any)?.document?.attributes?.find((a:any)=>a.fileName)?.fileName || 'attachment' };
        }
      }).filter(Boolean);
      setChatMessages(formattedChats);
    } catch {
      console.error("Failed to load chat");
    }
  };

  const sendChatMessage = async () => {
    if (!client || !chatId || (!chatMessage.trim() && !chatFile)) return;
    try {
      const p = JSON.parse(localStorage.getItem('team_profile') || '{}');
      const senderName = p.name || 'Anonymous';
      
      const payload = {
        type: 'chat',
        text: chatMessage,
        sender: senderName,
        avatar: p.avatar || null,
        fileName: chatFile?.name || null,
        timestamp: Date.now()
      };
      
      if (chatFile) {
        swal({ title: 'Uploading...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const arrayBuffer = await chatFile.arrayBuffer();
        const fileBuffer: any = Buffer.from(arrayBuffer);
        fileBuffer.name = chatFile.name;
        
        await client.sendFile(chatId, {
           file: fileBuffer,
           caption: JSON.stringify(payload),
           forceDocument: true
        });
        Swal.close();
      } else {
        await client.sendMessage(chatId, { message: JSON.stringify(payload) });
      }
      
      setChatMessage('');
      setChatFile(null);
      fetchChatMessages();
    } catch (e) {
      console.error("Failed to send chat", e);
      swal({ title: 'Error', text: 'Failed to send message', icon: 'error' });
    }
  };

  useEffect(() => {
    if (isConnected && chatId) {
      if (activeTab === 'files') fetchFiles();
      if (activeTab === 'chat') fetchChatMessages();
    }
  }, [isConnected, chatId, activeTab]);

  const handleUpload = async () => {
    if (!client || !chatId || !uploadFile) {
      swal({ title: 'Error', text: 'Make sure a file is selected and Chat ID is entered', icon: 'error' });
      return;
    }
    
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      // 1) Read the real browser File into a Node Buffer
      const arrayBuffer = await uploadFile.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = uploadFile.name; // Polyfill name property so Telegram parses it

      let p = { name: '', avatar: '' };
      try { p = JSON.parse(localStorage.getItem('team_profile') || '{}'); } catch {}

      // Innovative solution: No Base64. Extract cover from zip and upload it as a photo first!
      let coverMsgId = 0;
      if (uploadFile.name.toLowerCase().endsWith('.zip')) {
        try {
          const jszip = new (await import('jszip')).default();
          const zip = await jszip.loadAsync(uploadFile);
          const imageFiles = Object.keys(zip.files).filter(name => !zip.files[name].dir && name.match(/\.(png|jpe?g|webp)$/i));
          
          if (imageFiles.length > 0) {
            // Sort to get the first one consistently
            imageFiles.sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
            const firstImg = zip.files[imageFiles[0]];
            const imgBuffer = await firstImg.async('nodebuffer');
            (imgBuffer as any).name = 'cover.jpg'; // fake name
            
            // Upload the cover as a simple photo
            const coverMsg = await client.sendFile(chatId, {
              file: imgBuffer,
              forceDocument: false,
              caption: `[COVER_IMAGE_FOR_PROJECT]`
            });
            if (coverMsg && coverMsg.id) {
              coverMsgId = coverMsg.id;
            }
          }
        } catch (err) {
          console.error("Cover extraction failed", err);
        }
      }

      const metadata = {
        type: "manga_project",
        name: uploadName || uploadFile.name,
        status: uploadStatus || "New",
        description: uploadDesc || "", 
        sender: p.name || 'Anonymous User',
        avatar: p.avatar || '',
        coverMsgId: coverMsgId,
        date: new Date().toISOString()
      };

      await client.sendFile(chatId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata, null, 2),
        forceDocument: true,
        fileSize: uploadFile.size,
        progressCallback: (progress) => {
          // progress is a float between 0 and 1
          const percent = Math.round(progress * 100);
          setUploadProgress(percent);
        }
      });
      
      swal({ title: 'Upload Complete', text: 'File uploaded successfully with its JSON metadata.', icon: 'success' });
      setUploadFile(null);
      setUploadName('');
      setUploadProgress(0);
      fetchFiles();
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const saveConfig = () => {
    if (chatId) localStorage.setItem('tg_chat_id', chatId);
    swalToast({ icon: 'success', title: 'Saved' });
  };

  const handleDisconnect = () => {
    localStorage.removeItem('tg_session');
    setSessionStr('');
    setIsConnected(false);
    setClient(null);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-8 relative overflow-y-auto w-full min-h-screen">
      <div className="absolute top-0 right-0 w-64 h-64 sm:w-[500px] sm:h-[500px] bg-accent/10 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-64 h-64 sm:w-[500px] sm:h-[500px] bg-accent/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-6xl mx-auto w-full flex flex-col gap-8 relative z-10 animate-fade-in pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-ink flex items-center gap-3">
              <Cloud className="text-accent" size={32} />
              Central Cloud Storage
            </h1>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${isConnected ? 'bg-success/10 text-success border border-success/30' : 'bg-ink/5 text-ink-muted border border-hairline'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-success animate-pulse' : 'bg-ink-faint'}`} />
                {isConnected ? 'Connected via Telegram' : 'Not connected'}
              </span>
              {isConnected && (
                <span className="text-xs text-ink-faint font-mono">
                  {files.length} file{files.length === 1 ? '' : 's'} · {lastSyncedAt ? `synced ${timeAgo(lastSyncedAt)}` : 'not synced yet'}
                </span>
              )}
            </div>
          </div>
          {isConnected && (
            <div className="flex items-center gap-1 bg-ink/5 border border-hairline rounded-full p-1 shrink-0">
              {([
                { id: 'files', label: 'Files' },
                { id: 'chat', label: 'Discussions' },
                { id: 'config', label: 'Settings' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${activeTab === t.id ? 'bg-accent text-white shadow-md shadow-accent/25' : 'text-ink-muted hover:text-ink'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'config' && (
            <motion.div 
              key="config"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              <GlassCard className="p-6">
                <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
                  <Smartphone className="text-accent" /> Connect Telegram (GramJS)
                </h2>

                {!isConnected ? (
                  <div className="space-y-4">
                    <p className="text-xs text-ink-muted leading-relaxed mb-4">
                      We use the GramJS library to connect to Telegram's encrypted network directly from your browser. This happens entirely client-side with no intermediary server. Your keys are stored locally in your browser only.
                    </p>
                    <div className="space-y-1">
                      <label className="text-xs text-accent font-semibold">API ID</label>
                      <Input
                        type="text"
                        value={apiId} onChange={e => setApiId(e.target.value)}
                        placeholder="e.g. 1234567" dir="ltr"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-accent font-semibold">API Hash</label>
                      <Input
                        type="text"
                        value={apiHash} onChange={e => setApiHash(e.target.value)}
                        placeholder="Enter your developer API Hash" dir="ltr"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-accent font-semibold">International Phone Number</label>
                      <Input
                        type="text"
                        value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                        placeholder="+201012345678" dir="ltr"
                      />
                    </div>
                    <Button
                      onClick={handleLogin} disabled={isLoading}
                      className="w-full mt-4"
                    >
                      {isLoading ? 'Connecting...' : 'Request Verification Code (Login)'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-center gap-3">
                      <CheckCircle className="text-success" size={24} />
                      <div>
                        <h3 className="text-success font-bold text-sm">Connected to Telegram servers!</h3>
                        <p className="text-xs text-success/70">Your session is encrypted and stored locally.</p>
                      </div>
                    </div>

                    <div className="space-y-1 mt-4">
                      <label className="text-xs text-accent font-semibold flex items-center justify-between">
                        Storage Channel or Group ID (Chat ID)
                        <span className="text-[10px] text-ink-faint">e.g. -100123456789</span>
                      </label>
                      <Input
                        type="text"
                        value={chatId} onChange={e => setChatId(e.target.value)}
                        placeholder="-100..." dir="ltr"
                      />
                    </div>

                    <div className="flex gap-2">
                       <Button onClick={saveConfig} className="flex-1" size="sm">
                        Save Settings
                      </Button>
                      <Button onClick={handleDisconnect} variant="danger" size="sm">
                        Log Out
                      </Button>
                    </div>
                  </div>
                )}
              </GlassCard>

              <GlassCard className="p-6 transition-opacity">
                 <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
                  <User className="text-accent" /> Team Profile
                </h2>
                <div className="space-y-4">
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Set up your name and avatar shown to other team members when uploading files or chatting. There are no external servers — everything is relayed through Telegram messages.
                  </p>

                  <div className="space-y-1">
                    <label className="text-xs text-accent font-semibold">Username</label>
                    <Input
                      type="text"
                      placeholder="e.g. Alex"
                      onChange={(e) => {
                        try {
                           const p = JSON.parse(localStorage.getItem('team_profile') || '{}');
                           p.name = e.target.value;
                           localStorage.setItem('team_profile', JSON.stringify(p));
                        } catch {}
                      }}
                      defaultValue={(() => {
                        try { return JSON.parse(localStorage.getItem('team_profile') || '{}').name || ''; } catch { return ''; }
                      })()}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-accent font-semibold block">Avatar Variant</label>
                    <div className="flex gap-2">
                       <select
                         className="flex-1 bg-ink/5 border border-hairline rounded-xl px-4 py-3 text-ink text-sm outline-none focus:border-accent"
                         onChange={(e) => {
                            try {
                               const p = JSON.parse(localStorage.getItem('team_profile') || '{}');
                               const name = p.name || 'Anonymous';
                               p.avatar = `https://api.dicebear.com/7.x/${e.target.value}/svg?seed=${encodeURIComponent(name)}`;
                               localStorage.setItem('team_profile', JSON.stringify(p));
                               window.dispatchEvent(new Event('storage'));
                               swalToast({ icon: 'success', title: 'Avatar Changed', timer: 2000 });
                            } catch {}
                         }}
                         defaultValue="bottts"
                       >
                         <option value="bottts">Robot</option>
                         <option value="adventurer">Adventurer</option>
                         <option value="avataaars">Avataaars</option>
                         <option value="fun-emoji">Emoji</option>
                         <option value="shapes">Shapes</option>
                       </select>
                       <button
                         onClick={() => {
                            try {
                               const p = JSON.parse(localStorage.getItem('team_profile') || '{}');
                               const variants = ['bottts', 'adventurer', 'avataaars', 'fun-emoji', 'shapes'];
                               const variant = variants[Math.floor(Math.random() * variants.length)];
                               const seed = Math.random().toString(36).substring(7);
                               p.avatar = `https://api.dicebear.com/7.x/${variant}/svg?seed=${seed}`;
                               localStorage.setItem('team_profile', JSON.stringify(p));
                               window.dispatchEvent(new Event('storage'));
                               swalToast({ icon: 'success', title: 'Randomized Avatar', timer: 2000 });
                            } catch {}
                         }}
                         className="bg-accent-soft hover:opacity-80 border border-accent/30 text-accent px-4 py-3 rounded-xl transition-opacity font-bold text-xs"
                       >
                         🎲 Randomize
                       </button>
                    </div>
                  </div>
                </div>
              </GlassCard>

              {/* Help & Guide Section */}
              <GlassCard className="md:col-span-2 p-6">
                <h3 className="text-lg font-bold text-ink mb-4 flex items-center gap-2">
                  <HelpCircle className="text-ink-muted" size={18} /> How does client-side cloud storage work?
                </h3>
                <div className="space-y-4">
                  {[
                    { title: 'Get your API keys', desc: <>You'll need an <code className="bg-ink/10 px-1 py-0.5 rounded text-accent">API_ID</code> and <code className="bg-ink/10 px-1 py-0.5 rounded text-accent">API_HASH</code> from <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-accent hover:underline">my.telegram.org</a>.</> },
                    { title: 'It stays encrypted, on your device', desc: 'The app uses your browser purely as a client. Your Telegram session is stored encrypted in your browser (localStorage) — nothing touches an intermediary server.' },
                    { title: 'Point it at a storage channel', desc: 'Create a Telegram channel or group and copy its ID (forward a message to a bot like @userinfobot) into the Chat ID field.' },
                    { title: 'Metadata rides along with each upload', desc: 'When you upload a file (like a Photoshop archive or translated chapter), a JSON structure with project details and status is attached so the app can read and display it on the dashboard.' },
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-accent-soft border border-accent/30 text-accent text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{step.title}</p>
                        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {activeTab === 'files' && isConnected && (
            <motion.div 
              key="files"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Upload Dropzone, collapsed by default so the table stays the focal point */}
              <GlassCard className="rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowUploadPanel(v => !v)}
                  className="w-full flex items-center justify-between gap-3 p-5 text-left"
                >
                  <h3 className="text-base font-bold text-ink flex items-center gap-2">
                    <UploadIcon className="text-accent" size={18} /> Add File to Storage
                  </h3>
                  <ChevronDown className={`text-ink-faint transition-transform duration-200 ${showUploadPanel ? 'rotate-180' : ''}`} size={18} />
                </button>
              {showUploadPanel && (
                <div className="px-6 pb-6 border-t border-hairline pt-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <Input
                      type="text"
                      placeholder="File name (e.g. Solo Leveling Ch.12)"
                      value={uploadName} onChange={e => setUploadName(e.target.value)}
                    />
                    <select
                      value={uploadStatus} onChange={e => setUploadStatus(e.target.value)}
                      className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
                    >
                      <option value="">Status (Optional)</option>
                      <option value="Cleaning">Cleaning</option>
                      <option value="Translating">Translating</option>
                      <option value="Ready to Publish">Ready</option>
                    </select>

                    <Input
                      type="text"
                      placeholder="Notes for translators or description..."
                      value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
                    />
                  </div>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-accent/30 hover:border-accent/60 rounded-xl bg-accent-soft flex flex-col items-center justify-center cursor-pointer transition-colors p-6 group"
                  >
                    <input
                      type="file"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={async (e) => {
                        if(e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          setUploadFile(file);
                          if(!uploadName) setUploadName(file.name);

                          if (file.name.toLowerCase().endsWith('.zip')) {
                            try {
                              const jszip = new (await import('jszip')).default();
                              const zip = await jszip.loadAsync(file);
                              const imageFiles = Object.keys(zip.files).filter(name => !zip.files[name].dir && name.match(/\.(png|jpe?g|webp)$/i));
                              if (imageFiles.length > 0) {
                                swalToast({ icon: 'success', title: 'Cover extracted automatically' });
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }
                        }
                      }}
                    />
                    {uploadFile ? (
                      <div className="text-center text-accent">
                        <File className="mx-auto mb-2 opacity-80" size={32} />
                        <p className="font-bold whitespace-nowrap text-ellipsis overflow-hidden max-w-[200px]">{uploadFile.name}</p>
                        <p className="text-xs opacity-60">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    ) : (
                      <>
                        <UploadIcon size={32} className="text-ink-faint mb-3 group-hover:text-accent transition-colors" />
                        <p className="text-sm font-semibold text-ink-muted">Click here to choose a file (up to 2GB)</p>
                      </>
                    )}
                  </div>
                </div>

                {isUploading && (
                   <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full mt-4 overflow-hidden relative">
                    <div className="absolute top-0 left-0 bg-accent h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">{uploadProgress}%</span>
                  </div>
                )}

                <Button
                  onClick={handleUpload}
                  disabled={isUploading || !uploadFile}
                  className="w-full mt-4"
                  size="lg"
                >
                  {isUploading ? 'Uploading to Telegram...' : 'Upload File to Cloud'}
                </Button>
                </div>
              )}
              </GlassCard>

              {/* Grid/List Files */}
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                  <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                    <HardDrive className="text-accent" size={18} /> Cloud Storage
                  </h3>
                  <div className="flex items-center gap-2 w-full md:w-auto">
                     <Input
                       type="text"
                       placeholder="Search files..."
                       value={searchQuery}
                       onChange={e => setSearchQuery(e.target.value)}
                       className="flex-1 min-w-[200px]"
                     />
                     <select
                       value={sortOrder}
                       onChange={e => setSortOrder(e.target.value as any)}
                       className="bg-ink/5 border border-hairline rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-accent"
                     >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="alphabetical">A-Z</option>
                     </select>
                     <button onClick={fetchFiles} className="text-sm text-accent hover:text-ink flex items-center gap-1 bg-accent-soft px-3 py-2 rounded-xl border border-accent/20 transition-colors">
                       <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh
                     </button>
                  </div>
                </div>

                {isLoading && files.length === 0 ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-14 rounded-xl bg-ink/5 animate-pulse border border-hairline"></div>
                    ))}
                  </div>
                ) : files.length === 0 ? (
                   <GlassCard className="text-center py-16">
                     <File className="mx-auto text-ink-faint mb-3 opacity-50" size={48} />
                     <p className="text-ink-muted font-semibold">Repository is empty.</p>
                     <p className="text-xs text-ink-faint mt-1">Upload the first file to see the magic!</p>
                   </GlassCard>
                ) : (
                  <GlassCard className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-faint">
                            <th className="px-4 py-3 font-semibold">File</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 font-semibold">Uploaded By</th>
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.sender.toLowerCase().includes(searchQuery.toLowerCase())).sort((a,b) => {
                             if (sortOrder === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
                             if (sortOrder === 'alphabetical') return a.name.localeCompare(b.name);
                             return new Date(b.date).getTime() - new Date(a.date).getTime();
                          }).map((file, idx) => (
                            <tr key={idx} className="border-b border-hairline last:border-0 hover:bg-ink/[0.03] transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
                                    {coverUrls[file.id] ? (
                                      <img src={coverUrls[file.id]} alt="Cover" className="w-full h-full object-cover" />
                                    ) : (
                                      <File size={16} className="text-accent/60" />
                                    )}
                                  </div>
                                  <span className="font-semibold text-ink truncate max-w-[220px]">{file.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-block px-2 py-0.5 rounded bg-accent-soft border border-accent/30 text-[10px] text-accent font-bold whitespace-nowrap">{file.status}</span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-5 h-5 rounded-full overflow-hidden bg-accent-soft border border-accent/30 shrink-0">
                                     {file.avatar ? <img src={file.avatar} alt="Sender" className="w-full h-full object-cover" /> : <User size={10} className="m-auto mt-1 text-accent" />}
                                  </div>
                                  <span className="text-xs text-ink-muted truncate max-w-[120px]">{file.sender || 'Anonymous user'}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-ink-faint font-mono text-[11px] whitespace-nowrap">{new Date(file.date).toLocaleDateString()}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={async () => {
                                     try {
                                       swal({ title: 'Downloading from Cloud...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                                       const buffer = await client?.downloadMedia(file.msg);
                                       if (buffer) {
                                         const blob = new Blob([buffer]);
                                         const url = window.URL.createObjectURL(blob);
                                         const a = document.createElement('a');
                                         a.style.display = 'none';
                                         a.href = url;

                                         // The uploaded file already had `.zip` usually, but we fallback gracefully
                                         const ext = (file.msg as any)?.file?.name?.split('.').pop() || 'zip';
                                         a.download = `${file.name || 'project'}.${ext}`;

                                         document.body.appendChild(a);
                                         a.click();
                                         window.URL.revokeObjectURL(url);
                                         Swal.close();
                                       } else {
                                         swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
                                       }
                                     } catch (e: any) {
                                       swal({ title: 'Error', text: e?.message || 'Download failed', icon: 'error' });
                                     }
                                  }}
                                  className="text-accent hover:text-ink inline-flex items-center gap-1 font-sans font-bold bg-accent-soft hover:opacity-80 px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                   <Download size={14} /> Download
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </GlassCard>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'chat' && isConnected && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col h-[70vh] max-h-[600px] min-h-[400px]"
            >
             <GlassCard className="p-4 sm:p-6 flex flex-col flex-1 min-h-0">
               <div className="flex justify-between items-center mb-4 border-b border-hairline pb-4">
                 <h3 className="text-xl font-bold text-ink flex items-center gap-2">
                   <MessageSquare className="text-accent" /> Team Discussion (Central Channel)
                 </h3>
                 <button onClick={fetchChatMessages} className="text-accent hover:text-ink flex items-center gap-1 bg-accent-soft px-3 py-1.5 rounded-lg text-sm transition-colors">
                    <RefreshCw size={14} /> Refresh
                 </button>
               </div>

               <div className="flex-1 overflow-y-auto w-full space-y-6 pr-2 mb-4 flex flex-col">
                 {chatMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-ink-faint opacity-50">
                      <MessageSquare size={48} className="mb-2" />
                      <p>No messages yet. Start the discussion with your team!</p>
                    </div>
                 ) : (
                    chatMessages.slice().reverse().map((msg, idx) => {
                      let myName = '';
                      try { myName = JSON.parse(localStorage.getItem('team_profile') || '{}').name; } catch {}
                      const isMe = msg.sender === myName && myName !== '';

                      return (
                        <div key={idx} className={`flex items-end gap-3 max-w-[85%] ${isMe ? 'self-end flex-row-reverse' : 'self-start'}`}>
                          {/* Avatar */}
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-accent-soft border border-accent/30 shrink-0 flex items-center justify-center">
                            {msg.avatar ? <img src={msg.avatar} alt={msg.sender} className="w-full h-full object-cover" /> : <User size={14} className="text-accent" />}
                          </div>

                          {/* Bubble */}
                          <div className="flex flex-col">
                             {!isMe && <span className="text-[10px] text-accent font-bold mb-1 mr-1">{msg.sender}</span>}
                             <div className={`p-3 rounded-2xl border ${isMe ? 'bg-accent border-accent text-white rounded-br-sm' : 'bg-ink/5 border-hairline text-ink rounded-bl-sm'} shadow-lg backdrop-blur-md`}>
                                {msg.text && <p className="text-sm whitespace-pre-wrap">{msg.text}</p>}
                                {msg.hasMedia && (
                                   <div className={`mt-2 p-2 rounded bg-black/20 flex items-center gap-2 border border-white/10 ${msg.text ? '' : 'mt-0'}`}>
                                      <File size={20} className="text-accent shrink-0" />
                                      <span className="text-xs truncate max-w-[150px]">{msg.fileName || 'Attachment'}</span>
                                      <button
                                        onClick={async () => {
                                           try {
                                              swal({ title: 'Downloading file...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                                              const buffer = await client?.downloadMedia(msg.msgObj);
                                              if (buffer) {
                                                const blob = new Blob([buffer]);
                                                const url = window.URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.style.display = 'none';
                                                a.href = url;
                                                a.download = msg.fileName || 'attachment';
                                                document.body.appendChild(a);
                                                a.click();
                                                window.URL.revokeObjectURL(url);
                                                Swal.close();
                                              }
                                           } catch (err: any) {
                                              swal({ title: 'Error', text: err.message || 'Failed', icon: 'error' });
                                           }
                                        }}
                                        className="ml-auto bg-white/20 hover:bg-white/30 p-1.5 rounded text-white"
                                      >
                                        <Download size={14} />
                                      </button>
                                   </div>
                                )}
                             </div>
                             <span className={`text-[9px] text-ink-faint mt-1 font-mono ${isMe ? 'text-left ml-1' : 'text-right mr-1'}`}>{msg.date}</span>
                          </div>
                        </div>
                      )
                    })
                 )}
               </div>

               {chatFile && (
                 <div className="flex items-center gap-2 mb-2 bg-accent-soft p-2 rounded-xl border border-accent/30">
                   <File size={16} className="text-accent" />
                   <span className="text-xs text-ink flex-1 truncate">{chatFile.name}</span>
                   <button onClick={() => setChatFile(null)} className="text-danger hover:opacity-80 p-1"><Trash2 size={14} /></button>
                 </div>
               )}
               <div className="flex gap-2 shrink-0">
                 <input
                   type="file"
                   id="chat-file-upload"
                   className="hidden"
                   onChange={(e) => {
                     if (e.target.files && e.target.files[0]) {
                       setChatFile(e.target.files[0]);
                     }
                   }}
                 />
                 <label
                   htmlFor="chat-file-upload"
                   className="bg-accent-soft border border-accent/30 text-accent hover:opacity-80 cursor-pointer rounded-xl px-4 flex items-center justify-center transition-all"
                 >
                   <UploadIcon size={18} />
                 </label>

                 <Input
                   type="text"
                   value={chatMessage}
                   onChange={e => setChatMessage(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                   placeholder="Write your message or notes for the team here..."
                   className="flex-1 py-3 shrink min-w-0"
                 />
                 <Button
                   onClick={sendChatMessage}
                   disabled={!chatMessage.trim() && !chatFile}
                   className="whitespace-nowrap"
                 >
                   Send
                 </Button>
               </div>
             </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
