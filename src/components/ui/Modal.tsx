import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { IconButton } from './IconButton';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** When false, hides the close button and ignores backdrop clicks — for modals that must run to completion. */
  dismissible?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ open, onClose, title, children, footer, size = 'md', className, dismissible = true }: ModalProps) {
  if (!open) return null;

  return (
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
        <div className="px-6 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-hairline shrink-0">{footer}</div>}
      </GlassCard>
    </div>
  );
}
