import { Modal, Button } from '../ui';

interface ImageSizeDialogProps {
  open: boolean;
  onClose: () => void;
  width: number | null;
  height: number | null;
  title?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImageSizeDialog({ open, onClose, width, height, title = 'Image Size' }: ImageSizeDialogProps) {
  const pixels = width && height ? width * height : 0;
  const uncompressedBytes = pixels * 4;

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col gap-3 text-sm">
        {width != null && height != null ? (
          <>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <span className="text-ink-faint">Width:</span>
              <span className="tabular-nums font-medium">{width} px</span>
              <span className="text-ink-faint">Height:</span>
              <span className="tabular-nums font-medium">{height} px</span>
              <span className="text-ink-faint">Total Pixels:</span>
              <span className="tabular-nums">{pixels.toLocaleString()}</span>
              <span className="text-ink-faint">Aspect Ratio:</span>
              <span className="tabular-nums">{(width / height).toFixed(3)}</span>
              <span className="text-ink-faint">Uncompressed (RGBA):</span>
              <span className="tabular-nums">{formatBytes(uncompressedBytes)}</span>
            </div>
            <div className="h-px bg-hairline" />
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <span className="text-ink-faint">Print (300 DPI):</span>
              <span className="tabular-nums">{(width / 300).toFixed(2)}" x {(height / 300).toFixed(2)}"</span>
              <span className="text-ink-faint">Print (72 DPI):</span>
              <span className="tabular-nums">{(width / 72).toFixed(2)}" x {(height / 72).toFixed(2)}"</span>
            </div>
          </>
        ) : (
          <p className="text-ink-faint italic">No image loaded.</p>
        )}
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
