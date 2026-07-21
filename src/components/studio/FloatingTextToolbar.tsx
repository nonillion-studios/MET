import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic } from 'lucide-react';
import { cn } from '../ui/cn';
import type { TextAlign, TextLayerData } from './studioTypes';

interface FloatingTextToolbarProps {
  text: TextLayerData;
  /** The text box's on-screen rect (already stage-transformed: pos + text.x/y * scale, etc). */
  boxScreenRect: { left: number; top: number; width: number; height: number };
  /** Height of the canvas container, to decide whether the toolbar fits below the box. */
  containerHeight: number;
  fontFamilies: string[];
  onUpdate: (patch: Partial<TextLayerData>) => void;
}

const ALIGN_OPTIONS: { id: TextAlign; icon: typeof AlignLeft }[] = [
  { id: 'left', icon: AlignLeft },
  { id: 'center', icon: AlignCenter },
  { id: 'right', icon: AlignRight },
  { id: 'justify', icon: AlignJustify },
];

const TOOLBAR_HEIGHT = 40;
const GAP = 8;

/**
 * Photoshop-style contextual toolbar that follows the text box being edited — font, size, color,
 * bold/italic, alignment. Positioned below the box by default; flips above it when there isn't
 * room underneath (near the bottom of the canvas), same "flip toward the space that exists"
 * convention as a browser dropdown.
 */
export function FloatingTextToolbar({ text, boxScreenRect, containerHeight, fontFamilies, onUpdate }: FloatingTextToolbarProps) {
  const fitsBelow = boxScreenRect.top + boxScreenRect.height + GAP + TOOLBAR_HEIGHT <= containerHeight;
  const top = fitsBelow
    ? boxScreenRect.top + boxScreenRect.height + GAP
    : Math.max(4, boxScreenRect.top - GAP - TOOLBAR_HEIGHT);

  return (
    <div
      // Keeps the textarea focused — clicking a toolbar control must not steal focus and end the
      // edit (which onBlur would otherwise do).
      onMouseDown={(e) => e.preventDefault()}
      className="liquid-glass-bar absolute z-30 flex items-center gap-1.5 px-2 rounded-control border border-hairline shadow-lg"
      style={{ left: boxScreenRect.left, top, height: TOOLBAR_HEIGHT }}
    >
      <select
        value={text.fontFamily}
        onChange={(e) => onUpdate({ fontFamily: e.target.value })}
        className="bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro max-w-[7rem]"
      >
        {fontFamilies.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>

      <input
        type="number"
        min={6}
        max={400}
        value={Math.round(text.fontSize)}
        onChange={(e) => onUpdate({ fontSize: Number(e.target.value) || text.fontSize })}
        className="w-12 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
      />

      <input
        type="color"
        value={text.color}
        onChange={(e) => onUpdate({ color: e.target.value })}
        className="w-7 h-7 rounded-control border border-hairline bg-transparent shrink-0"
        aria-label="Text color"
      />

      <div className="w-px h-5 bg-hairline shrink-0" />

      <button
        type="button"
        aria-label="Bold"
        onClick={() => onUpdate({ bold: !text.bold })}
        className={cn('w-7 h-7 rounded-control flex items-center justify-center', text.bold ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink')}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        aria-label="Italic"
        onClick={() => onUpdate({ italic: !text.italic })}
        className={cn('w-7 h-7 rounded-control flex items-center justify-center', text.italic ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink')}
      >
        <Italic size={14} />
      </button>

      <div className="w-px h-5 bg-hairline shrink-0" />

      {ALIGN_OPTIONS.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={`Align ${id}`}
          onClick={() => onUpdate({ align: id })}
          className={cn('w-7 h-7 rounded-control flex items-center justify-center', text.align === id ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink')}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
