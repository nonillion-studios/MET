import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, AlignCenterHorizontal } from 'lucide-react';
import { IconButton, Textarea } from '../ui';
import { cn } from '../ui/cn';
import { StudioPanel } from './StudioPanel';
import { FONT_FAMILIES, type StudioLayer, type TextAlign, type TextLayerData } from './studioTypes';

interface TextPanelProps {
  layer: StudioLayer;
  onUpdate: (id: string, patch: Partial<TextLayerData>) => void;
  onCenter: (id: string) => void;
  /** Built-in fonts plus any custom fonts installed via the Fonts panel. */
  fontFamilies?: string[];
}

export function TextPanel({ layer, onUpdate, onCenter, fontFamilies = FONT_FAMILIES }: TextPanelProps) {
  const text = layer.text;
  if (!text) return null;

  const set = (patch: Partial<TextLayerData>) => onUpdate(layer.id, patch);

  return (
    <StudioPanel
      title="Text"
      actions={
        <IconButton size="sm" aria-label="Center horizontally" title="Center in bubble" onClick={() => onCenter(layer.id)} className="!bg-transparent">
          <AlignCenterHorizontal size={14} />
        </IconButton>
      }
    >
        <Textarea
          value={text.content}
          onChange={(e) => set({ content: e.target.value })}
          placeholder="Type dialogue…"
          rows={3}
          className="!text-title"
        />

        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Font</span>
          <select
            value={text.fontFamily}
            onChange={(e) => set({ fontFamily: e.target.value })}
            className="bg-ink/5 border border-hairline rounded-control px-1.5 py-1.5 text-ink text-micro"
          >
            {fontFamilies.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
            <span className="shrink-0">Size</span>
            <input
              type="number"
              min={6}
              max={200}
              value={Math.round(text.fontSize)}
              onChange={(e) => set({ fontSize: Number(e.target.value) || text.fontSize })}
              className="w-full bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
            />
          </label>
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="shrink-0">Color</span>
            <input
              type="color"
              value={text.color}
              onChange={(e) => set({ color: e.target.value })}
              className="w-8 h-7 rounded-control border border-hairline bg-transparent"
            />
          </label>
        </div>

        <div className="flex items-center gap-1">
          <IconButton size="sm" active={text.bold} aria-label="Bold" onClick={() => set({ bold: !text.bold })} className="!bg-transparent">
            <Bold size={14} />
          </IconButton>
          <IconButton size="sm" active={text.italic} aria-label="Italic" onClick={() => set({ italic: !text.italic })} className="!bg-transparent">
            <Italic size={14} />
          </IconButton>
          <div className="w-px h-6 bg-hairline mx-1" />
          {([
            { id: 'left', icon: AlignLeft },
            { id: 'center', icon: AlignCenter },
            { id: 'right', icon: AlignRight },
          ] as { id: TextAlign; icon: typeof AlignLeft }[]).map(({ id, icon: Icon }) => (
            <IconButton
              key={id}
              size="sm"
              active={text.align === id}
              aria-label={`Align ${id}`}
              onClick={() => set({ align: id })}
              className="!bg-transparent"
            >
              <Icon size={14} />
            </IconButton>
          ))}
        </div>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Line height</span>
          <input
            type="range"
            min={0.8}
            max={2}
            step={0.05}
            value={text.lineHeight}
            onChange={(e) => set({ lineHeight: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-8 text-right tabular-nums">{text.lineHeight.toFixed(2)}</span>
        </label>

        <div className={cn('flex flex-col gap-2 pt-2 border-t border-hairline/60')}>
          <span className="text-micro text-ink-faint">Stroke</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={text.strokeColor}
              onChange={(e) => set({ strokeColor: e.target.value })}
              className="w-8 h-7 rounded-control border border-hairline bg-transparent"
            />
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={text.strokeWidth}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-8 text-right tabular-nums text-micro text-ink-faint">{text.strokeWidth}</span>
          </div>
        </div>
    </StudioPanel>
  );
}
