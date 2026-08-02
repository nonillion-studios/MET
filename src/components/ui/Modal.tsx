import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { IconButton } from './IconButton';
import { cn } from './cn';
import { useFullscreenPortalTarget } from '../../lib/useFullscreenPortalTarget';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** When false, hides the close button and ignores backdrop clicks — for modals that must run to completion. */
  dismissible?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  // Blending Options is the one dialog in this app with a real two-pane (left-nav + right-panel)
  // layout — every other Modal usage fits comfortably in `lg`.
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, children, footer, size = 'md', className, dismissible = true }: ModalProps) {
  // Called unconditionally, before the `!open` early return below — every dialog in the app
  // (Blending Options, Fill/Stroke Path, Filter dialogs, Export, etc.) renders through this one
  // shared Modal, so fixing the portal target here fixes fullscreen compatibility for all of them
  // at once. Falls back to `document.body` outside Studio, where no `#studio-root` exists.
  const portalTarget = useFullscreenPortalTarget();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="animate-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4"
      onClick={dismissible ? onClose : undefined}
    >
      <GlassCard
        variant="heavy"
        radius="2xl"
        className={cn('animate-modal-in w-full max-h-[85vh] flex flex-col overflow-hidden', SIZE_CLASSES[size], className)}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
            <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
            {dismissible && (
              <IconButton aria-label="Close" size="sm" onClick={onClose}>
                <X size={16} />
              </IconButton>
            )}
          </div>
        )}
        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-hairline shrink-0">{footer}</div>}
      </GlassCard>
    </div>,
    portalTarget,
  );
}
