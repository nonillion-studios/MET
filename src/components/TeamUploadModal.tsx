import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Modal, Button, Input, Textarea } from './ui';
import { readImageFile } from '../lib/image';

export interface TeamUploadMeta {
  displayName: string;
  description: string;
  coverDataUrl: string | null;
}

/**
 * Pre-upload metadata prompt for Team Cloud, matching TeleCloud's
 * name/notes-before-upload flow instead of TeamCloud's previous
 * upload-immediately-then-edit-later pattern.
 */
export function TeamUploadModal({ file, uploading, onConfirm, onClose }: {
  file: File;
  uploading: boolean;
  onConfirm: (meta: TeamUploadMeta) => void;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(file.name);
  const [description, setDescription] = useState('');
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handlePickCover = (f: File) => {
    readImageFile(f, (dataUrl) => setCoverDataUrl(dataUrl));
  };

  const handleConfirm = () => {
    onConfirm({ displayName: displayName.trim() || file.name, description: description.trim(), coverDataUrl });
  };

  return (
    <Modal
      open
      onClose={uploading ? () => {} : onClose}
      dismissible={!uploading}
      title="Upload to Team Cloud"
      size="sm"
      footer={
        <Button className="w-full" onClick={handleConfirm} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Name</label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={file.name} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Description (optional)</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What is this file?" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Cover image (optional)</label>
          <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePickCover(f); e.target.value = ''; }} />
          {coverDataUrl ? (
            <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-hairline">
              <img src={coverDataUrl} alt="Cover preview" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setCoverDataUrl(null)}
                className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label="Remove cover"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="w-24 h-24 rounded-xl border border-dashed border-hairline flex flex-col items-center justify-center gap-1 text-ink-faint hover:text-accent hover:border-accent transition-colors"
            >
              <ImagePlus size={18} />
              <span className="text-[10px]">Add cover</span>
            </button>
          )}
        </div>
        <p className="text-[11px] text-ink-faint truncate">File: {file.name}</p>
      </div>
    </Modal>
  );
}
