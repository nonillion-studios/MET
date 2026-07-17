import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/** A shimmering liquid-glass placeholder block — matches GlassCard's rounding/border so a
 *  loading section reads as "the same card, not yet filled" rather than a generic gray box. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-skeleton rounded-lg border border-hairline/60', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** A GlassCard-shaped skeleton, for whole-card loading states (list/grid items, panels). */
export function SkeletonCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('liquid-glass rounded-2xl overflow-hidden', className)}
      aria-hidden="true"
      {...props}
    >
      <div className="animate-skeleton w-full h-full" />
    </div>
  );
}

/** A few lines of shimmering text-width bars, for list rows / detail panels waiting on data. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
