import { cn } from '@/lib/utils';
import { scoreTone } from './labels';

const TONE = {
  hot: 'bg-gradient-to-r from-violet to-blue text-white',
  warm: 'bg-violet/20 text-violet ring-1 ring-violet/40',
  cold: 'bg-surface-2 text-muted ring-1 ring-border',
  none: 'bg-surface-2 text-muted/60 ring-1 ring-border',
} as const;

export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 min-w-11 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums',
        TONE[scoreTone(score)],
        className,
      )}
      aria-label={score === null ? 'Puan yok' : `Puan ${score}`}
    >
      {score ?? '—'}
    </span>
  );
}
