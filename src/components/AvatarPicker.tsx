import { useRef, type ChangeEvent } from 'react';
import { Upload, Shuffle } from 'lucide-react';
import { readImageFile } from '../lib/image';

const VARIANTS = ['bottts', 'adventurer', 'avataaars', 'fun-emoji', 'micah'];
const SEEDS = ['nova', 'atlas'];

const PRESETS = VARIANTS.flatMap(variant =>
  SEEDS.map(seed => `https://api.dicebear.com/7.x/${variant}/svg?seed=${seed}`)
);

interface AvatarPickerProps {
  value: string;
  onChange: (dataUrl: string) => void;
}

export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const randomize = () => {
    const variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
    const seed = Math.random().toString(36).substring(7);
    onChange(`https://api.dicebear.com/7.x/${variant}/svg?seed=${seed}`);
  };

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file, onChange);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2">
        {PRESETS.map(url => (
          <button
            key={url}
            type="button"
            onClick={() => onChange(url)}
            className={`aspect-square rounded-xl overflow-hidden border-2 transition-all ${value === url ? 'border-accent ring-2 ring-accent/30 scale-105' : 'border-hairline hover:border-accent/40'}`}
          >
            <img src={url} alt="Avatar option" className="w-full h-full object-cover bg-accent-soft" />
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 bg-ink/5 hover:bg-ink/10 border border-hairline text-ink-muted py-2.5 rounded-xl transition-colors text-xs font-semibold"
        >
          <Upload size={14} /> Upload Your Own
        </button>
        <button
          type="button"
          onClick={randomize}
          className="flex items-center justify-center gap-2 bg-accent-soft hover:opacity-80 border border-accent/30 text-accent px-4 py-2.5 rounded-xl transition-opacity text-xs font-bold"
        >
          <Shuffle size={14} /> Random
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </div>
  );
}
