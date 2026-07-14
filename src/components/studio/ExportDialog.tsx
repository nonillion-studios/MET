import { useState } from 'react';
import { Download } from 'lucide-react';
import { Modal, Button } from '../ui';
import { compositeFlattenedImage, downloadBlob, type ImageExportFormat } from '../../lib/exportImage';
import { swal } from '../../lib/swalTheme';
import type { ExportSnapshot } from './StudioCanvas';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  fileBaseName: string;
  getSnapshot: () => ExportSnapshot | null;
  /** Undefined while ag-psd hasn't loaded/isn't available — PSD option is hidden in that case. */
  exportPsd?: (snapshot: ExportSnapshot) => Promise<Blob>;
}

const IMAGE_FORMATS: { id: ImageExportFormat; label: string; ext: string }[] = [
  { id: 'png', label: 'PNG', ext: 'png' },
  { id: 'jpg', label: 'JPG', ext: 'jpg' },
  { id: 'webp', label: 'WEBP', ext: 'webp' },
];

export function ExportDialog({ open, onClose, fileBaseName, getSnapshot, exportPsd }: ExportDialogProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function handleExport(format: ImageExportFormat | 'psd') {
    const snapshot = getSnapshot();
    if (!snapshot) {
      swal({ icon: 'warning', title: 'Nothing to export', text: 'Select a page first.' });
      return;
    }
    setBusy(format);
    try {
      if (format === 'psd') {
        if (!exportPsd) return;
        const blob = await exportPsd(snapshot);
        downloadBlob(blob, `${fileBaseName}.psd`);
      } else {
        const blob = await compositeFlattenedImage(snapshot, format);
        downloadBlob(blob, `${fileBaseName}.${format}`);
      }
      onClose();
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Export Failed', text: err instanceof Error ? err.message : 'Could not export this page.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Export Page" size="sm">
      <p className="text-sm text-ink-muted mb-4">Flattens the background and every visible layer at full resolution.</p>
      <div className="grid grid-cols-2 gap-2">
        {IMAGE_FORMATS.map(f => (
          <Button key={f.id} variant="secondary" disabled={busy !== null} onClick={() => handleExport(f.id)}>
            <Download size={14} /> {busy === f.id ? 'Exporting…' : f.label}
          </Button>
        ))}
        <Button
          variant="secondary"
          disabled={busy !== null || !exportPsd}
          onClick={() => handleExport('psd')}
          title={exportPsd ? 'Layers + editable text' : 'Loading PSD support…'}
        >
          <Download size={14} /> {busy === 'psd' ? 'Exporting…' : 'PSD'}
        </Button>
      </div>
    </Modal>
  );
}
