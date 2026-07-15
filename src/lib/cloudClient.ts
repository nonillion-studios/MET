import { useCallback, useEffect, useState } from 'react';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { swal, swalToast, Swal } from './swalTheme';
import { genId } from './id';
import { migrateWorkspace } from './migrate';
import { loadTelegramCredentials, saveTelegramCredentials } from './telegramSync';
import type { Workspace } from '../types';

export interface CloudFile {
  id: number;
  msg: any;
  type: 'workspace_backup' | 'team_file';
  name: string;
  description: string;
  tags: string[];
  sender: string;
  folderId: number | null;
  coverMsgId: number;
  sizeBytes: number;
  date: string;
}

export interface CloudFolder {
  id: number;
  name: string;
  parentId: number | null;
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
  const [meName, setMeName] = useState('');

  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(0);

  const loadMe = useCallback(async (newClient: TelegramClient) => {
    try {
      const me = await newClient.getMe();
      const name = [(me as any)?.firstName, (me as any)?.lastName].filter(Boolean).join(' ') || (me as any)?.username || 'Team Member';
      setMeName(name);
    } catch {
      setMeName('Team Member');
    }
  }, []);

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
      await loadMe(newClient);
      swalToast({ icon: 'success', title: 'Connected to Telegram successfully' });
    } catch (error) {
      console.error(error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadMe]);

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

    // No local session yet on this device — try pulling synced credentials from Supabase.
    if (!savedSession) {
      loadTelegramCredentials().then(creds => {
        if (!creds) return;
        if (creds.apiId) setApiId(creds.apiId);
        if (creds.apiHash) setApiHash(creds.apiHash);
        if (creds.chatId) setChatId(creds.chatId);
        if (creds.session && creds.apiId && creds.apiHash) {
          localStorage.setItem('tg_api_id', creds.apiId);
          localStorage.setItem('tg_api_hash', creds.apiHash);
          localStorage.setItem('tg_session', creds.session);
          if (creds.chatId) localStorage.setItem('tg_chat_id', creds.chatId);
          initClient(creds.apiId, creds.apiHash, creds.session);
        }
      }).catch(console.error);
    }
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
        saveTelegramCredentials({ apiId, apiHash, phone: phoneNumber, session: sessionString }).catch(console.error);
        setClient(newClient);
        setIsConnected(true);
        await loadMe(newClient);

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
      const msgs = await client.getMessages(chatId, { limit: 100 });

      const cloudFiles: CloudFile[] = [];
      const cloudFolders: CloudFolder[] = [];

      msgs.forEach(m => {
        if (!m.message) return;
        try {
          const data = JSON.parse(m.message);
          if (!data || typeof data !== 'object') return;
          if (m.media && data.type === 'workspace_backup') {
            cloudFiles.push({
              id: m.id,
              msg: m,
              type: data.type,
              name: data.name || 'Untitled',
              description: data.description || '',
              tags: Array.isArray(data.tags) ? data.tags : [],
              sender: data.sender || 'Team Member',
              folderId: typeof data.folderId === 'number' ? data.folderId : null,
              coverMsgId: data.coverMsgId || 0,
              sizeBytes: data.sizeBytes || 0,
              date: data.date || new Date(m.date * 1000).toISOString(),
            });
          } else if (!m.media && data.type === 'folder') {
            cloudFolders.push({
              id: m.id,
              name: data.name || 'Untitled Folder',
              parentId: typeof data.parentId === 'number' ? data.parentId : null,
            });
          }
        } catch {
          // not one of ours, ignore
        }
      });

      setFiles(cloudFiles);
      setFolders(cloudFolders);
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

  const createFolder = async (name: string, parentId: number | null) => {
    if (!client || !chatId) return;
    try {
      await client.sendMessage(chatId, { message: JSON.stringify({ type: 'folder', name, parentId }) });
      await fetchFiles();
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Failed to create folder', icon: 'error' });
    }
  };

  const deleteFolder = async (folder: CloudFolder) => {
    if (!client || !chatId) return;
    const result = await swal({
      icon: 'warning',
      title: `Delete folder "${folder.name}"?`,
      text: 'Files inside will remain in Cloud Storage, unfiled.',
      showCancelButton: true,
      confirmButtonText: 'Delete Folder',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    try {
      await client.deleteMessages(chatId, [folder.id], { revoke: true });
      await fetchFiles();
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Failed to delete folder', icon: 'error' });
    }
  };

  const moveFile = async (file: CloudFile, folderId: number | null) => {
    if (!client || !chatId) return;
    try {
      const metadata = {
        type: file.type,
        name: file.name,
        description: file.description,
        tags: file.tags,
        sender: file.sender,
        folderId,
        coverMsgId: file.coverMsgId,
        sizeBytes: file.sizeBytes,
        date: file.date,
      };
      await client.editMessage(chatId, { message: file.id, text: JSON.stringify(metadata, null, 2) });
      await fetchFiles();
    } catch (err: any) {
      swal({ title: 'Error', text: err.message || 'Failed to move file', icon: 'error' });
    }
  };

  const uploadWorkspaceBackup = async (workspace: Workspace, opts: { notes: string; tags: string[]; folderId: number | null }) => {
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
        sender: meName || 'Team Member',
        folderId: opts.folderId,
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

  const downloadCloudFile = async (file: CloudFile) => {
    const result = await swal({
      icon: 'question',
      title: `Download "${file.name}"?`,
      text: `File size: ${formatSize(file.sizeBytes)}`,
      showCancelButton: true,
      confirmButtonText: 'Download',
    });
    if (!result.isConfirmed) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadLabel(file.name);
    setDownloadTotalBytes(file.sizeBytes);
    try {
      const buffer = await client?.downloadMedia(file.msg, {
        progressCallback: (progress: number) => setDownloadProgress(Math.round(progress * 100)),
      } as any);
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
      } else {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
      }
    } catch (e: any) {
      swal({ title: 'Error', text: e?.message || 'Download failed', icon: 'error' });
    } finally {
      setIsDownloading(false);
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
      // Normalize older backups (flat `images: ProcessedImage[]`) to the current `pages: Page[]` shape.
      const parsed = migrateWorkspace(JSON.parse(text) as Workspace);

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
              pages: (c.pages || []).map(page => ({
                ...page,
                id: genId('page'),
                original: { ...page.original, id: genId('image') },
                cleaned: page.cleaned ? { ...page.cleaned, id: genId('image') } : null,
              })),
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

  const uploadTaskAttachment = async (channelId: string, file: File, onProgress?: (pct: number) => void): Promise<{ msgId: number; name: string; size: number } | null> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram and make sure the team has a channel set first', icon: 'error' });
      return null;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = file.name;
      const msg = await client.sendFile(channelId, {
        file: fileBuffer,
        caption: file.name,
        forceDocument: true,
        fileSize: file.size,
        progressCallback: (progress: number) => onProgress?.(Math.round(progress * 100)),
      });
      if (!msg || !msg.id) return null;
      return { msgId: msg.id, name: file.name, size: file.size };
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
      return null;
    }
  };

  const downloadTaskAttachment = async (channelId: string, msgId: number, fileName: string, onProgress?: (pct: number) => void): Promise<void> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram first', icon: 'error' });
      return;
    }
    try {
      const msgs = await client.getMessages(channelId, { ids: [msgId] });
      const msg = msgs[0];
      if (!msg) {
        swal({ title: 'Error', text: 'Attachment message not found', icon: 'error' });
        return;
      }
      const buffer = await client.downloadMedia(msg, {
        progressCallback: (progress: number) => onProgress?.(Math.round(progress * 100)),
      } as any);
      if (!buffer) {
        swal({ title: 'Error', text: 'Empty file buffer received', icon: 'error' });
        return;
      }
      const blob = new Blob([buffer]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Error', text: err.message || 'Download failed', icon: 'error' });
    }
  };

  // ---------------------------------------------------------------------
  // Team Files: browse/upload an arbitrary channel (the team's shared
  // Telegram channel) rather than the user's own personal cloud channel.
  // Any message with media is listed (task submissions included, so the
  // team can see everything sitting in that channel, not just curated
  // uploads); JSON-caption metadata is used when present for name/folder.
  // ---------------------------------------------------------------------

  const fetchChannelFiles = async (channelId: string): Promise<{ files: CloudFile[]; folders: CloudFolder[] }> => {
    if (!client || !channelId) return { files: [], folders: [] };
    const msgs = await client.getMessages(channelId, { limit: 200 });
    const cloudFiles: CloudFile[] = [];
    const cloudFolders: CloudFolder[] = [];

    msgs.forEach(m => {
      if (m.media) {
        let meta: any = null;
        try { meta = m.message ? JSON.parse(m.message) : null; } catch { /* plain caption, not JSON */ }
        cloudFiles.push({
          id: m.id,
          msg: m,
          type: meta?.type === 'workspace_backup' ? 'workspace_backup' : 'team_file',
          name: meta?.name || m.message || (m as any).file?.name || 'Untitled',
          description: meta?.description || '',
          tags: Array.isArray(meta?.tags) ? meta.tags : [],
          sender: meta?.sender || 'Team Member',
          folderId: typeof meta?.folderId === 'number' ? meta.folderId : null,
          coverMsgId: 0,
          sizeBytes: meta?.sizeBytes || (m as any).file?.size || 0,
          date: meta?.date || new Date(m.date * 1000).toISOString(),
        });
      } else if (m.message) {
        try {
          const data = JSON.parse(m.message);
          if (data?.type === 'folder') {
            cloudFolders.push({ id: m.id, name: data.name || 'Untitled Folder', parentId: typeof data.parentId === 'number' ? data.parentId : null });
          }
        } catch { /* not a folder marker */ }
      }
    });

    return { files: cloudFiles, folders: cloudFolders };
  };

  const createChannelFolder = async (channelId: string, name: string, parentId: number | null): Promise<void> => {
    if (!client || !channelId) return;
    await client.sendMessage(channelId, { message: JSON.stringify({ type: 'folder', name, parentId }) });
  };

  const deleteChannelFolder = async (channelId: string, folder: CloudFolder): Promise<void> => {
    if (!client || !channelId) return;
    await client.deleteMessages(channelId, [folder.id], { revoke: true });
  };

  const uploadChannelFile = async (channelId: string, file: File, folderId: number | null, onProgress?: (pct: number) => void): Promise<void> => {
    if (!client || !channelId) {
      swal({ title: 'Error', text: 'Connect Telegram and make sure the team has a channel set first', icon: 'error' });
      return;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer: any = Buffer.from(arrayBuffer);
      fileBuffer.name = file.name;
      const metadata = { type: 'team_file', name: file.name, description: '', tags: [], sender: meName || 'Team Member', folderId, sizeBytes: file.size, date: new Date().toISOString() };
      await client.sendFile(channelId, {
        file: fileBuffer,
        caption: JSON.stringify(metadata),
        forceDocument: true,
        fileSize: file.size,
        progressCallback: (progress: number) => onProgress?.(Math.round(progress * 100)),
      });
    } catch (err: any) {
      console.error(err);
      swal({ title: 'Upload Error', text: err.message || 'An error occurred during upload', icon: 'error' });
    }
  };

  const saveConfig = () => {
    if (chatId) {
      localStorage.setItem('tg_chat_id', chatId);
      saveTelegramCredentials({ chatId }).catch(console.error);
    }
    swalToast({ icon: 'success', title: 'Saved' });
  };

  const handleDisconnect = () => {
    localStorage.removeItem('tg_session');
    saveTelegramCredentials({ session: '' }).catch(console.error);
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
    meName,

    files,
    folders,
    coverUrls,
    lastSyncedAt,
    fetchFiles,
    createFolder,
    deleteFolder,
    moveFile,

    isUploading,
    uploadProgress,
    uploadLabel,
    uploadTotalBytes,
    uploadWorkspaceBackup,

    isDownloading,
    downloadProgress,
    downloadLabel,
    downloadTotalBytes,
    downloadCloudFile,
    restoreWorkspaceFromCloud,

    uploadTaskAttachment,
    downloadTaskAttachment,

    fetchChannelFiles,
    createChannelFolder,
    deleteChannelFolder,
    uploadChannelFile,

    formatSize,
  };
}

export type CloudClient = ReturnType<typeof useCloudClient>;
