import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xl border border-border bg-surface-2 px-4 text-base text-foreground placeholder:text-muted/70 focus:border-violet focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}
