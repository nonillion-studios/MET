import { useRef, useState } from 'react';
import { Upload as UploadIcon, Download, CalendarClock } from 'lucide-react';
import { Modal, Button, Input } from '../ui';
import { swal } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { stashTransferBlob } from '../../lib/automationEngine';
import type { CloudClient, CloudFolder } from '../../lib/cloudClient';
import type { AutomationTrigger, AutomationAction } from '../../types';

const INTERVAL_PRESETS = [
  { label: 'Hourly', ms: 60 * 60 * 1000 },
  { label: 'Daily', ms: 24 * 60 * 60 * 1000 },
  { label: 'Weekly', ms: 7 * 24 * 60 * 60 * 1000 },
];

interface ScheduleTransferModalProps {
  open: boolean;
  onClose: () => void;
  cc: CloudClient;
  folders: CloudFolder[];
  currentFolderId: number | null;
  createAutomation: (input: { name: string; description: string; trigger: AutomationTrigger; action: AutomationAction }) => void;
}

export function ScheduleTransferModal({ open, onClose, cc, folders, currentFolderId, createAutomation }: ScheduleTransferModalProps) {
  const [direction, setDirection] = useState<'upload' | 'download'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [cloudFileId, setCloudFileId] = useState<number | ''>('');
  const [folderId, setFolderId] = useState<number | ''>(currentFolderId ?? '');
  const [timing, setTiming] = useState<'now' | 'at' | 'interval'>('now');
  const [atValue, setAtValue] = useState('');
  const [intervalMs, setIntervalMs] = useState(INTERVAL_PRESETS[1].ms);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setDirection('upload');
    setFile(null);
    setCloudFileId('');
    setFolderId(currentFolderId ?? '');
    setTiming('now');
    setAtValue('');
    setIntervalMs(INTERVAL_PRESETS[1].ms);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    let action: AutomationAction;
    let name: string;

    if (direction === 'upload') {
      if (!file) {
        swal({ icon: 'error', title: 'No File', text: 'Choose a file to upload first.' });
        return;
      }
      const blobKey = `transfer_blob_${genId('blob')}`;
      await stashTransferBlob(blobKey, file);
      action = { type: 'cloudTransfer', direction: 'upload', fileName: file.name, sizeBytes: file.size, folderId: folderId === '' ? null : Number(folderId), blobKey };
      name = `Upload ${file.name}`;
    } else {
      if (cloudFileId === '') {
        swal({ icon: 'error', title: 'No File', text: 'Choose a cloud file to download.' });
        return;
      }
      const target = cc.files.find(f => f.id === cloudFileId);
      if (!target) return;
      action = { type: 'cloudTransfer', direction: 'download', fileName: target.name, sizeBytes: target.sizeBytes, folderId: target.folderId, cloudFileId: target.id };
      name = `Download ${target.name}`;
    }

    let trigger: AutomationTrigger;
    if (timing === 'now') trigger = { type: 'once', at: new Date().toISOString() };
    else if (timing === 'at') {
      if (!atValue) {
        swal({ icon: 'error', title: 'Pick a Time', text: 'Choose when this transfer should run.' });
        return;
      }
      trigger = { type: 'once', at: new Date(atValue).toISOString() };
    } else {
      trigger = { type: 'interval', everyMs: intervalMs };
    }

    createAutomation({ name, description: '', trigger, action });
    handleClose();
  };

  const sizeLabel = direction === 'upload'
    ? (file ? cc.formatSize(file.size) : null)
    : (cloudFileId !== '' ? cc.formatSize(cc.files.find(f => f.id === cloudFileId)?.sizeBytes || 0) : null);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Schedule Transfer"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave}><CalendarClock size={14} /> Schedule</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDirection('upload')}
            className={`py-2 rounded-xl border text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${direction === 'upload' ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
          >
            <UploadIcon size={13} /> Upload
          </button>
          <button
            onClick={() => setDirection('download')}
            className={`py-2 rounded-xl border text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${direction === 'download' ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
          >
            <Download size={13} /> Download
          </button>
        </div>

        {direction === 'upload' ? (
          <div className="space-y-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-accent/30 hover:border-accent/60 rounded-xl bg-accent-soft flex flex-col items-center justify-center cursor-pointer transition-colors p-6"
            >
              <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <p className="text-sm font-semibold text-accent">{file.name}</p>
              ) : (
                <p className="text-sm text-ink-muted">Click to choose a file to add</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold">Destination Folder</label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
              >
                <option value="">Root</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold">Cloud File</label>
            <select
              value={cloudFileId}
              onChange={(e) => setCloudFileId(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
            >
              <option value="">Choose a file...</option>
              {cc.files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        {sizeLabel && <p className="text-xs text-ink-faint font-mono">Size: {sizeLabel}</p>}

        <div className="space-y-2">
          <label className="text-xs text-accent font-semibold">Run</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'now', label: 'Now' },
              { id: 'at', label: 'At a time' },
              { id: 'interval', label: 'Recurring' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTiming(t.id)}
                className={`py-2 rounded-xl border text-xs font-medium transition-colors ${timing === t.id ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {timing === 'at' && (
            <Input type="datetime-local" value={atValue} onChange={(e) => setAtValue(e.target.value)} />
          )}
          {timing === 'interval' && (
            <div className="grid grid-cols-3 gap-2">
              {INTERVAL_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setIntervalMs(p.ms)}
                  className={`py-2 rounded-xl border text-xs font-medium transition-colors ${intervalMs === p.ms ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
