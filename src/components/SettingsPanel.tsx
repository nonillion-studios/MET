import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Laptop, Trash2, Info, ShieldCheck, FileText, ImagePlus, Save, LogOut, Download, CloudUpload, Archive, Eraser, Users, Sparkles } from 'lucide-react';
import { clear } from 'idb-keyval';
import { useTheme, type ThemeMode } from '../contexts/ThemeContext';
import { GlassCard, Button, Input } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import { readAvatarFile, uploadImageToStorage } from '../lib/image';
import { useTeamAuth, profileFromSession } from '../lib/teamAuth';
import { requestNotificationPermission, getUserNotificationPrefs, setUserNotificationPrefs, type UserNotificationPrefs, type NotifyChannel } from '../lib/notifications';
import { subscribeToPush, unsubscribeFromPush, isPushSupported } from '../lib/webPush';
import { Bell } from 'lucide-react';
import { AdminAnnouncementsPanel } from './AdminAnnouncementsPanel';
import { isAllowedAnnouncementSender } from '../lib/adminMessages';
import { AdminDashboard } from './AdminDashboard';
import { isSiteAdmin } from '../lib/adminDashboard';
import { loadMagicEraseServer, saveMagicEraseServer } from '../lib/magicEraseStore';
import { loadAiTranslationSettings, saveAiTranslationSettings } from '../lib/aiSettingsStore';
import { AI_PROVIDERS, defaultModelFor, type AiProvider } from '../lib/aiTranslate';

interface SettingsPanelProps {
  onShowPrivacy: () => void;
  onShowTerms: () => void;
  workspaceCount: number;
  isCloudConnected: boolean;
  onDownloadAllBackup: () => void;
  isDownloadingAllBackup: boolean;
  onBackupAllToCloud: () => void;
  isBackingUpAll: boolean;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Laptop },
];

const APP_VERSION = '0.1.0';

export function SettingsPanel({
  onShowPrivacy, onShowTerms, workspaceCount, isCloudConnected,
  onDownloadAllBackup, isDownloadingAllBackup, onBackupAllToCloud, isBackingUpAll,
}: SettingsPanelProps) {
  const { mode, setMode } = useTheme();
  const { session, signOut, updateProfile } = useTeamAuth();
  const profile = profileFromSession(session);
  const [canSendAnnouncements, setCanSendAnnouncements] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const sessionUserId = session?.user?.id ?? null;

  useEffect(() => {
    if (!sessionUserId) { setCanSendAnnouncements(false); setIsAdmin(false); return; }
    isAllowedAnnouncementSender().then(setCanSendAnnouncements);
    isSiteAdmin().then(setIsAdmin);
    // Depends on the user's id, not the session object — Supabase issues a new session
    // object (new token) on every background refresh, and re-running this on every
    // refresh would be wasteful without ever changing the result.
  }, [sessionUserId]);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(
    typeof Notification !== 'undefined' ? Notification.permission : null
  );

  const [magicEraseServer, setMagicEraseServer] = useState('');
  const [savingMagicErase, setSavingMagicErase] = useState(false);

  useEffect(() => {
    loadMagicEraseServer().then(setMagicEraseServer);
  }, []);

  const handleSaveMagicEraseServer = async () => {
    setSavingMagicErase(true);
    await saveMagicEraseServer(magicEraseServer);
    setSavingMagicErase(false);
    swalToast({ icon: 'success', title: 'Magic Erase server saved' });
  };

  const PRESET_LANGUAGES = ['English', 'Spanish', 'Arabic', 'Japanese', 'Korean', 'French', 'German', 'Portuguese', 'Italian', 'Indonesian'];
  const [aiProvider, setAiProvider] = useState<AiProvider>('gemini');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiTargetLanguage, setAiTargetLanguage] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [customLanguage, setCustomLanguage] = useState('');
  const [customLanguageMode, setCustomLanguageMode] = useState(false);
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const isCustomLanguage = customLanguageMode || (aiTargetLanguage !== '' && !PRESET_LANGUAGES.includes(aiTargetLanguage));
  const activeProviderInfo = AI_PROVIDERS.find(p => p.id === aiProvider) ?? AI_PROVIDERS[0];

  useEffect(() => {
    if (!sessionUserId) return;
    loadAiTranslationSettings().then(settings => {
      if (!settings) return;
      setAiProvider(settings.provider);
      setAiModel(settings.model || defaultModelFor(settings.provider));
      setAiApiKey(settings.apiKey);
      setAiPrompt(settings.defaultPrompt);
      setAiTargetLanguage(settings.targetLanguage);
      setAiBaseUrl(settings.baseUrl);
      if (settings.targetLanguage && !PRESET_LANGUAGES.includes(settings.targetLanguage)) {
        setCustomLanguage(settings.targetLanguage);
        setCustomLanguageMode(true);
      }
    });
    // Depends on the user's id (stable across Supabase's background token refreshes),
    // not the session object — reloading on every refresh was silently overwriting any
    // unsaved edits (prompt, provider choice, etc.) with the last-saved DB values.
  }, [sessionUserId]);

  const handleSaveAiSettings = async () => {
    setSavingAiSettings(true);
    await saveAiTranslationSettings({
      provider: aiProvider,
      model: aiModel.trim() || defaultModelFor(aiProvider),
      apiKey: aiApiKey,
      defaultPrompt: aiPrompt,
      targetLanguage: aiTargetLanguage,
      baseUrl: aiBaseUrl,
    });
    setSavingAiSettings(false);
    swalToast({ icon: 'success', title: 'AI translation settings saved' });
  };

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    if (result) setNotifPermission(result);
  };

  const [userPrefs, setUserPrefs] = useState<UserNotificationPrefs | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [savingPush, setSavingPush] = useState(false);

  useEffect(() => {
    if (!sessionUserId) return;
    getUserNotificationPrefs().then(prefs => {
      setUserPrefs(prefs);
      setPushEnabled(prefs.broadcasts.channel === 'in_app_push' || prefs.requests.channel === 'in_app_push');
    });
  }, [sessionUserId]);

  const updateCategoryPref = async (category: 'broadcasts' | 'requests', patch: Partial<{ enabled: boolean; channel: NotifyChannel }>) => {
    if (!userPrefs) return;
    const next: UserNotificationPrefs = { ...userPrefs, [category]: { ...userPrefs[category], ...patch } };
    setUserPrefs(next);
    await setUserNotificationPrefs(next);
  };

  const handleTogglePush = async () => {
    setSavingPush(true);
    if (pushEnabled) {
      await unsubscribeFromPush();
      setPushEnabled(false);
      if (userPrefs) {
        const next: UserNotificationPrefs = {
          broadcasts: { ...userPrefs.broadcasts, channel: 'in_app' },
          requests: { ...userPrefs.requests, channel: 'in_app' },
        };
        setUserPrefs(next);
        await setUserNotificationPrefs(next);
      }
    } else {
      const error = await subscribeToPush();
      if (error) {
        swal({ icon: 'error', title: 'Could not enable push notifications', text: error });
      } else {
        setPushEnabled(true);
        // Without persisting this, the toggle reverts to "Enable" on the next reload even
        // though a valid push_subscriptions row already exists — the DB-derived pushEnabled
        // state above would go stale and desync from the real subscription.
        if (userPrefs) {
          const next: UserNotificationPrefs = {
            broadcasts: { ...userPrefs.broadcasts, channel: 'in_app_push' },
            requests: { ...userPrefs.requests, channel: 'in_app_push' },
          };
          setUserPrefs(next);
          await setUserNotificationPrefs(next);
        }
      }
    }
    setSavingPush(false);
  };

  const handleSaveProfile = async () => {
    if (!name.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Enter a name for your profile.' });
      return;
    }
    setSaving(true);
    let avatarUrl = avatar;
    if (avatar.startsWith('data:') && session?.user.id) {
      const uploaded = await uploadImageToStorage(avatar, `${session.user.id}/avatar.jpg`);
      if (uploaded) avatarUrl = uploaded;
    }
    const error = await updateProfile(name.trim(), avatarUrl);
    setSaving(false);
    if (error) {
      swal({ icon: 'error', title: 'Update failed', text: error });
      return;
    }
    swalToast({ icon: 'success', title: 'Profile updated' });
  };

  const handleSignOut = async () => {
    const result = await swal({
      icon: 'question',
      title: 'Sign out?',
      text: "You'll need to sign in again to access your account.",
      showCancelButton: true,
      confirmButtonText: 'Sign Out',
    });
    if (result.isConfirmed) await signOut();
  };

  const handleSwitchAccount = async () => {
    const result = await swal({
      icon: 'question',
      title: 'Switch account?',
      text: 'This signs you out so you can sign back in with a different account.',
      showCancelButton: true,
      confirmButtonText: 'Switch Account',
    });
    if (result.isConfirmed) await signOut();
  };

  const handleClearData = async () => {
    const result = await swal({
      icon: 'warning',
      title: 'Clear all local data?',
      text: 'This removes your entire library and all saved preferences from this device. This cannot be undone.',
      showCancelButton: true,
      confirmButtonText: 'Clear Everything',
      cancelButtonText: 'Cancel',
    });
    if (!result.isConfirmed) return;
    await clear();
    localStorage.clear();
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-6">
      <GlassCard className="p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink font-display">Account</h3>
        <p className="text-xs text-ink-muted -mt-2">Signed in as {session?.user.email}</p>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="w-16 h-16 rounded-full border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
          >
            {avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : <ImagePlus size={18} className="text-ink-faint" />}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setAvatar); }} />
          <div className="flex-1 space-y-1">
            <label className="text-xs text-accent font-semibold">Name</label>
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={handleSaveProfile} disabled={saving} className="flex-1">
            <Save size={14} /> {saving ? 'Saving...' : 'Save Profile'}
          </Button>
          <Button variant="secondary" onClick={handleSwitchAccount} className="flex-1">
            <Users size={14} /> Switch Account
          </Button>
          <Button variant="secondary" onClick={handleSignOut} className="flex-1">
            <LogOut size={14} /> Sign Out
          </Button>
        </div>
      </GlassCard>

      <GlassCard className="p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink font-display">Appearance</h3>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ mode: m, label, icon: Icon }) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-colors ${
                mode === m ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted hover:bg-ink/10'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      </GlassCard>

      {notifPermission !== null && (
        <GlassCard className="p-6 space-y-4">
          <h3 className="text-base font-semibold text-ink font-display">Notifications</h3>
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <Bell size={16} className="text-ink-faint" /> Browser Notifications
              </span>
              <span className="text-[10px] text-ink-faint font-normal">Required before push can be enabled below</span>
            </span>
            {notifPermission === 'granted' ? (
              <span className="text-xs font-semibold text-accent">Enabled</span>
            ) : notifPermission === 'denied' ? (
              <span className="text-xs text-ink-faint">Blocked in browser settings</span>
            ) : (
              <Button size="sm" onClick={handleEnableNotifications}>Enable</Button>
            )}
          </div>

          {isPushSupported() && (
            <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-ink">Push Notifications</span>
                <span className="text-[10px] text-ink-faint font-normal">Get notified even when the app tab is closed</span>
              </span>
              <Button size="sm" variant={pushEnabled ? 'secondary' : 'primary'} onClick={handleTogglePush} disabled={savingPush || notifPermission !== 'granted'}>
                {savingPush ? 'Saving...' : pushEnabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
          )}

          {userPrefs && (
            <div className="space-y-3 border-t border-hairline pt-4">
              <p className="text-[10px] text-ink-faint">
                Chat, task and bank notifications are configured per-team from that team's settings — these two are global.
              </p>
              {(['broadcasts', 'requests'] as const).map(category => (
                <div key={category} className="flex items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink capitalize">{category === 'broadcasts' ? 'Admin Broadcasts' : 'Team Request Outcomes'}</span>
                    <span className="text-[10px] text-ink-faint font-normal">
                      {category === 'broadcasts' ? 'Announcements posted above the Library' : 'Join requests, invites, tasks, bank, etc. being accepted/refused'}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        checked={userPrefs[category].enabled}
                        onChange={e => updateCategoryPref(category, { enabled: e.target.checked })}
                      />
                      On
                    </label>
                    <select
                      className="text-xs rounded-lg border border-hairline bg-ink/5 px-2 py-1 text-ink disabled:opacity-40"
                      value={userPrefs[category].channel}
                      disabled={!userPrefs[category].enabled}
                      onChange={e => updateCategoryPref(category, { channel: e.target.value as NotifyChannel })}
                    >
                      <option value="in_app">In-app only</option>
                      <option value="in_app_push">In-app + Web</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink font-display">Backup</h3>
        <p className="text-xs text-ink-muted -mt-2">
          Back up your entire library ({workspaceCount} workspace{workspaceCount === 1 ? '' : 's'}) — every series, volume, chapter, and Studio project.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="secondary" onClick={onDownloadAllBackup} disabled={isDownloadingAllBackup || workspaceCount === 0} className="flex-1">
            <Download size={14} /> {isDownloadingAllBackup ? 'Preparing...' : 'Download All (.zip)'}
          </Button>
          <Button onClick={onBackupAllToCloud} disabled={isBackingUpAll || workspaceCount === 0} className="flex-1">
            {isBackingUpAll ? <Archive size={14} className="animate-pulse" /> : <CloudUpload size={14} />}
            {isBackingUpAll ? 'Backing up...' : isCloudConnected ? 'Backup to Telegram Cloud' : 'Connect & Backup to Telegram'}
          </Button>
        </div>
      </GlassCard>

      <GlassCard className="p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink font-display flex items-center gap-2">
          <Eraser size={16} className="text-ink-faint" /> Magic Erase Server
        </h3>
        <p className="text-xs text-ink-muted -mt-2">
          Paste the server address you were given to enable Studio's Magic Erase tool. Studio sends the
          selected region (and only that region) to this address when you use Magic Erase — nothing is
          sent otherwise.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="e.g. your-space.met.server"
            value={magicEraseServer}
            onChange={(e) => setMagicEraseServer(e.target.value)}
            className="flex-1"
          />
          <Button onClick={handleSaveMagicEraseServer} disabled={savingMagicErase}>
            <Save size={14} /> {savingMagicErase ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </GlassCard>

      {session && (
        <GlassCard className="p-6 space-y-4">
          <h3 className="text-base font-semibold text-ink font-display flex items-center gap-2">
            <Sparkles size={16} className="text-ink-faint" /> AI Translation
          </h3>
          <p className="text-xs text-ink-muted -mt-2">
            Your API key is encrypted and synced to your account — it's never stored in plain text.
            Used by the Text Editor's AI translation mode.
          </p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">Provider</label>
            <select
              className="w-full text-sm rounded-xl border border-hairline bg-ink/5 px-3 py-2.5 text-ink outline-none focus:border-accent"
              value={aiProvider}
              onChange={(e) => {
                const next = e.target.value as AiProvider;
                setAiProvider(next);
                // Swap in the new provider's default model unless the field was already
                // hand-edited away from the previous provider's own default.
                setAiModel(prev => (prev === '' || prev === activeProviderInfo.defaultModel) ? defaultModelFor(next) : prev);
              }}
            >
              {AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">Model</label>
            <Input
              placeholder={activeProviderInfo.defaultModel}
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="w-full"
            />
          </div>
          {activeProviderInfo.openAiCompatible && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">Base URL</label>
              <Input
                placeholder={activeProviderInfo.defaultBaseUrl}
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                className="w-full"
              />
              <p className="text-[10px] text-ink-faint">
                {activeProviderInfo.id === 'ollama'
                  ? "Point this at your local/self-hosted Ollama instance, e.g. http://localhost:11434/v1."
                  : `Leave blank to use ${activeProviderInfo.label}'s default endpoint, or override it (e.g. a self-hosted gateway).`}
              </p>
            </div>
          )}
          {!activeProviderInfo.noKeyRequired && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">{activeProviderInfo.keyHint}</label>
              <Input
                type="password"
                placeholder={`Paste your ${activeProviderInfo.label} API key`}
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                className="w-full"
              />
              <p className="text-[10px] text-ink-faint">Switching provider needs its own key pasted in here — only one key is stored at a time.</p>
            </div>
          )}
          {activeProviderInfo.noKeyRequired && (
            <p className="text-xs text-ink-muted">{activeProviderInfo.keyHint}</p>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">Target Language</label>
            <select
              className="w-full text-sm rounded-xl border border-hairline bg-ink/5 px-3 py-2.5 text-ink outline-none focus:border-accent"
              value={isCustomLanguage ? '__custom__' : aiTargetLanguage}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomLanguageMode(true);
                  setAiTargetLanguage(customLanguage);
                } else {
                  setCustomLanguageMode(false);
                  setAiTargetLanguage(e.target.value);
                }
              }}
            >
              <option value="">Select a language...</option>
              {PRESET_LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
              <option value="__custom__">Custom...</option>
            </select>
            {isCustomLanguage && (
              <Input
                autoFocus
                placeholder="Enter a language"
                value={customLanguage}
                onChange={(e) => { setCustomLanguage(e.target.value); setAiTargetLanguage(e.target.value); }}
                className="w-full mt-1"
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-muted">Translation Prompt</label>
            <textarea
              placeholder="Instructions the AI follows while translating (tone, honorifics, formatting conventions, etc.)"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={4}
              className="w-full text-sm rounded-xl border border-hairline bg-ink/5 px-3 py-2.5 text-ink outline-none focus:border-accent resize-y"
            />
          </div>
          <Button onClick={handleSaveAiSettings} disabled={savingAiSettings}>
            <Save size={14} /> {savingAiSettings ? 'Saving...' : 'Save'}
          </Button>
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-4">
        <h3 className="text-base font-semibold text-ink font-display">System</h3>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <Info size={16} className="text-ink-faint" /> App Version
            </span>
            <span className="text-xs font-mono text-ink-faint">{APP_VERSION}</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
            <span className="flex flex-col">
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <Trash2 size={16} className="text-danger" /> Clear Local Data
              </span>
              <span className="text-[10px] text-ink-faint font-normal">Wipes your library and settings from this device</span>
            </span>
            <Button variant="danger" size="sm" onClick={handleClearData}>Clear</Button>
          </div>
        </div>
      </GlassCard>

      {canSendAnnouncements && <AdminAnnouncementsPanel />}
      {isAdmin && <AdminDashboard />}

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-base font-semibold text-ink font-display">Legal</h3>
        <div className="flex flex-col gap-2">
          <button
            onClick={onShowPrivacy}
            className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-ink/5 border border-hairline hover:bg-ink/10 text-sm font-medium text-ink transition-colors"
          >
            <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-ink-faint" /> Privacy Policy</span>
            <span className="text-ink-faint">›</span>
          </button>
          <button
            onClick={onShowTerms}
            className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-ink/5 border border-hairline hover:bg-ink/10 text-sm font-medium text-ink transition-colors"
          >
            <span className="flex items-center gap-2"><FileText size={16} className="text-ink-faint" /> User Agreement</span>
            <span className="text-ink-faint">›</span>
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
