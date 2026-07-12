import { Sun, Moon, Laptop, Trash2, Info, ShieldCheck, FileText } from 'lucide-react';
import { clear } from 'idb-keyval';
import { useTheme, type ThemeMode } from '../contexts/ThemeContext';
import { GlassCard, Button } from './ui';
import { AdSlot } from './AdSlot';
import { swal } from '../lib/swalTheme';

interface SettingsPanelProps {
  onShowPrivacy: () => void;
  onShowTerms: () => void;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Laptop },
];

const APP_VERSION = '0.1.0';

export function SettingsPanel({ onShowPrivacy, onShowTerms }: SettingsPanelProps) {
  const { mode, setMode } = useTheme();

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

      <AdSlot placement="settings-bottom" />
    </div>
  );
}
