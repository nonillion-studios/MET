import { useCallback, useEffect, useState } from 'react';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { swal, swalToast, Swal } from './swalTheme';
import { genId } from './id';
import type { Profile, Workspace } from '../types';

export interface CloudFile {
  id: number;
  msg: any;
  type: 'manga_project' | 'workspace_backup';
  name: string;
  description: string;
  tags: string[];
  sender: string;
  avatar: string;
  coverMsgId: number;
  sizeBytes: number;
  date: string;
}

export interface CloudChatMessage {
  id: number;
  text: string;
  date: string;
  timestamp: number;
  sender: string;
  avatar: string | null;
  hasMedia: boolean;
  msgObj: any;
  fileName?: string;
}

function formatSize(bytes: number): string {
  if (!bytes) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

export function useCloudClient() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [chatId, setChatId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [client, setClient] = useState<TelegramClient | null>(null);

  const [files, setFiles] = useState<CloudFile[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const [chatMessages, setChatMessages] = useState<CloudChatMessage[]>([]);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);

  const initClient = useCallback(async (id: string, hash: string, session: string) => {
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
      swalToast({ icon: 'success', title: 'Connected to Telegram successfully' });
    } catch (error) {
      console.error(error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedApiId = localStorage.getItem('tg_api_id');
    const savedApiHash = localStorage.getItem('tg_api_hash');
    const savedSession = localStorage.getItem('tg_session');
    const savedChatId = localStorage.getItem('tg_chat_id');

    if (savedApiId) setApiId(savedApiId);
    if (savedApiHash) setApiHash(savedApiHash);
    if (savedSession && savedApiId && savedApiHash) {
      initClient(savedApiId, savedApiHash, savedSession);
    }
    if (savedChatId) setChatId(savedChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setClient(newClient);
        setIsConnected(true);

        swal({ title: 'Success', text: 'Logged in successfully!', icon: 'success' });
      }
    } catch (err: any) {
      console.error('Login error:', err);
      swal({ title: 'Error', text: err.message || 'Login failed', icon: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFiles = useCallback(async () => {
    if (!client || !chatId) return;
    setIsLoading(true);
    try {
      const msgs = await client.getMessages(chatId, { limit: 50 });
      const cloudFiles: CloudFile[] = msgs.filter(m => m.media && m.message).map(m => {
        try {
          const data = JSON.parse(m.message);
          if (data && (data.type === 'manga_project' || data.type === 'workspace_backup')) {
            return { id: m.id, msg: m, ...data, tags: Array.isArray(data.tags) ? data.tags : [] } as CloudFile;
          }
          return null;
        } catch {
          return null;
        }
      }).filter((f): f is CloudFile => f !== null);

      setFiles(cloudFiles);
      setLastSyncedAt(Date.now());

      cloudFiles.forEach(async (f) => {
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
            console.error('Failed to load cover', e);
          }
        }
      });
    } catch (err) {
      console.error(err);
      swal({ title: 'Error', text: 'Check that the Chat ID is correct', icon: 'error' });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, chatId]);

  const fetchChatMessages = useCallback(async () => {
    if (!client || !chatId) return;
    try {
      const msgs = await client.getMessages(chatId, { limit: 50 });
      const formattedChats = msgs.map(m => {
        if (!m.message && !m.media) return null;
        try {
          const data = JSON.parse(m.message || '{}');
          if (data && data.type === 'chat') {
            return { id: m.id, text: data.text || '', date: new Date(m.date * 1000).toLocaleString(), timestamp: m.date * 1000, sender: data.sender || 'Anonymous', avatar: data.avatar || null, hasMedia: !!m.media, msgObj: m, fileName: data.fileName };
          }
          return null;
        } catch {
          return { id: m.id, text: m.message || '', date: new Date(m.date * 1000).toLocaleString(), timestamp: m.date * 1000, sender: 'Team Member', avatar: null, hasMedia: !!m.media, msgObj: m, fileName: (m.media as any)?.document?.attributes?.find((a: any) => a.fileName)?.fileName || 'attachment' };
        }
      }).filter((m): m is CloudChatMessage => m !== null);
      setChatMessages(formattedChats);
    } catch {
      console.error('Failed to load chat');
    }
  }, [client, chatId]);

  const sendChatMessage = async (text: string, file: File | null, profile: Profile) => {
    if (!client || !chatId || (!text.trim() && !file)) return;
    try {
      const payload = {
        type: 'chat',
        text,
        sender: profile.name || 'Anonymous',
        avatar: profile.avatar || null,
        fileName: file?.name || null,
        timestamp: Date.now()
      };

      if (file) {
        swal({ title: 'Uploading...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer: any = Buffer.from(arrayBuffer);
        fileBuffer.name = file.name;

        await client.sendFile(chatId, {
          file: fileBuffer,
          caption: JSON.stringify(payload),
          forceDocument: true
        });
        Swal.close();
      } else {
        await client.sendMessage(chatId, { message: JSON.stringify(payload) });
      }

      fetchChatMessages();
    } catch (e) {
      console.error('Failed to send chat', e);
      swal({ title: 'Error', text: 'Failed to send message', icon: 'error' });
    }
  };

  const uploadFile = async (file: File, opts: { name: string; notes: string; tags: string[]; coverDataUrl: string | null; profile: Profile }) => {
    if (!client || !chatId) {
      swal({ title: 'Error', text: 'Connect to Telegram and set a Chat ID first', icon: 'error' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadLabel(opts.name || file.name);
    setUploadTotalBytes(file.size);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = file.name;

      let coverMsgId = 0;
      if (opts.coverDataUrl) {
        try {
          const coverBlob = await (await fetch(opts.coverDataUrl)).blob();
          const coverArrayBuffer = await coverBlob.arrayBuffer();
          const coverBuffer: any = Buffer.from(coverArrayBuffer);
          coverBuffer.name = 'cover.jpg';
          const coverMsg = await client.sendFile(chatId, { file: coverBuffer, forceDocument: false, caption: '[COVER_IMAGE_FOR_PROJECT]' });
          if (coverMsg && coverMsg.id) coverMsgId = coverMsg.id;
        } catch (err) {
          console.error('Cover upload failed', err);
        }
      }

      const metadata = {
        type: 'manga_project',
        name: opts.name || file.name,
        description: opts.notes || '',
        tags: opts.tags,
        sender: opts.profile.name || 'Anonymous User',
        avatar: opts.profile.avatar || '',
        coverMsgId,
        sizeBytes: file.size,
        date: new Date().toISOString()
      };

      await client.sendFile(chatId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata, null, 2),
        forceDocument: true,
        fileSize: file.size,
        progressCallback: (progress: number) => setUploadProgress(Math.round(progress * 100)),
      });

      swalToast({ icon: 'success', title: 'Upload complete' });
      fetchFiles();
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const uploadWorkspaceBackup = async (workspace: Workspace, opts: { notes: string; tags: string[]; profile: Profile }) => {
    if (!client || !chatId) {
      swal({ title: 'Error', text: 'Connect to Telegram and set a Chat ID first', icon: 'error' });
      return;
    }

    const json = JSON.stringify(workspace);
    const sizeBytes = new Blob([json]).size;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadLabel(workspace.name);
    setUploadTotalBytes(sizeBytes);

    try {
      const fileBuffer: any = Buffer.from(json, 'utf-8');
      fileBuffer.name = `${workspace.name.replace(/[^a-z0-9]+/gi, '_')}.json`;

      let coverMsgId = 0;
      if (workspace.coverUrl) {
        try {
          const coverBlob = await (await fetch(workspace.coverUrl)).blob();
          const coverArrayBuffer = await coverBlob.arrayBuffer();
          const coverBuffer: any = Buffer.from(coverArrayBuffer);
          coverBuffer.name = 'cover.jpg';
          const coverMsg = await client.sendFile(chatId, { file: coverBuffer, forceDocument: false, caption: '[COVER_IMAGE_FOR_PROJECT]' });
          if (coverMsg && coverMsg.id) coverMsgId = coverMsg.id;
        } catch (err) {
          console.error('Cover upload failed', err);
        }
      }

      const metadata = {
        type: 'workspace_backup',
        name: workspace.name,
        description: opts.notes || workspace.description || '',
        tags: opts.tags,
        sender: opts.profile.name || 'Anonymous User',
        avatar: opts.profile.avatar || '',
        coverMsgId,
        sizeBytes,
        date: new Date().toISOString()
      };

      await client.sendFile(chatId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata, null, 2),
        forceDocument: true,
        fileSize: sizeBytes,
        progressCallback: (progress: number) => setUploadProgress(Math.round(progress * 100)),
      });

      swalToast({ icon: 'success', title: `"${workspace.name}" backed up to Cloud Storage` });
      fetchFiles();
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Backup Error', text: err.message || 'An error occurred during backup', icon: 'error' });
      throw err;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const downloadAttachment = async (msgObj: any, filename: string) => {
    try {
      swal({ title: 'Downloading file...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const buffer = await client?.downloadMedia(msgObj);
      if (buffer) {
        const blob = new Blob([buffer]);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        Swal.close();
      }
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Download failed', icon: 'error' });
    }
  };

  const downloadCloudFile = async (file: CloudFile) => {
    const result = await swal({
      icon: 'question',
      title: `Download "${file.name}"?`,
      text: `File size: ${formatSize(file.sizeBytes)}`,
      showCancelButton: true,
      confirmButtonText: 'Download',
    });
    if (!result.isConfirmed) return;

    try {
      swal({ title: 'Downloading from Cloud...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const buffer = await client?.downloadMedia(file.msg);
      if (buffer) {
        const blob = new Blob([buffer]);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const ext = (file.msg as any)?.file?.name?.split('.').pop() || 'zip';
        a.download = `${file.name || 'project'}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        Swal.close();
      } else {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
      }
    } catch (e: any) {
      swal({ title: 'Error', text: e?.message || 'Download failed', icon: 'error' });
    }
  };

  const restoreWorkspaceFromCloud = async (file: CloudFile): Promise<Workspace | null> => {
    try {
      swal({ title: 'Fetching from Cloud...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const buffer = await client?.downloadMedia(file.msg);
      Swal.close();
      if (!buffer) {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
        return null;
      }
      const text = new TextDecoder('utf-8').decode(buffer as Uint8Array);
      const parsed = JSON.parse(text) as Workspace;

      // Regenerate every id so restoring doesn't collide with existing local data.
      const restored: Workspace = {
        ...parsed,
        id: genId('workspace'),
        mangas: (parsed.mangas || []).map(m => ({
          ...m,
          id: genId('manga'),
          volumes: (m.volumes || []).map(v => ({
            ...v,
            id: genId('volume'),
            chapters: (v.chapters || []).map(c => ({
              ...c,
              id: genId('chapter'),
              images: (c.images || []).map(img => ({ ...img, id: genId('image') })),
            })),
          })),
        })),
      };
      return restored;
    } catch (e: any) {
      console.error(e);
      swal({ title: 'Error', text: e?.message || 'Restore failed', icon: 'error' });
      return null;
    }
  };

  const saveConfig = () => {
    if (chatId) localStorage.setItem('tg_chat_id', chatId);
    swalToast({ icon: 'success', title: 'Saved' });
  };

  const handleDisconnect = () => {
    localStorage.removeItem('tg_session');
    setIsConnected(false);
    setClient(null);
  };

  return {
    apiId, setApiId,
    apiHash, setApiHash,
    chatId, setChatId,
    phoneNumber, setPhoneNumber,
    isConnected,
    isLoading,
    handleLogin,
    handleDisconnect,
    saveConfig,

    files,
    coverUrls,
    lastSyncedAt,
    fetchFiles,

    chatMessages,
    fetchChatMessages,
    sendChatMessage,

    isUploading,
    uploadProgress,
    uploadLabel,
    uploadTotalBytes,
    uploadFile,
    uploadWorkspaceBackup,
    downloadCloudFile,
    downloadAttachment,
    restoreWorkspaceFromCloud,

    formatSize,
  };
}

export type CloudClient = ReturnType<typeof useCloudClient>;
