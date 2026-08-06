import { compositeFlattenedImage, downloadBlob, type ImageExportFormat } from '../lib/exportImage';
import { exportPsd } from '../lib/exportPsd';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';

export type DesignExportFormat = ImageExportFormat | 'psd';

/**
 * Thin wrapper around the existing Studio export functions — no new export logic. `snapshot` is
 * built by `DesignCanvas.exportSnapshot()`, the only place with access to the paint-canvas registry
 * needed to serialize layer pixels.
 */
export async function exportDesignImage(snapshot: ExportSnapshot, name: string, format: DesignExportFormat): Promise<void> {
  const blob = format === 'psd' ? await exportPsd(snapshot) : await compositeFlattenedImage(snapshot, format);
  const ext = format === 'jpg' ? 'jpg' : format;
  downloadBlob(blob, `${name}.${ext}`);
}
