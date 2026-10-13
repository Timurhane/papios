import { LogOut, Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { tr } from '@/i18n/tr';
import { cn } from '@/lib/utils';
import { panelModules } from '@/modules';

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {panelModules.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-gradient-to-r from-violet/20 to-blue/10 text-foreground ring-1 ring-violet/30'
                : 'text-muted hover:bg-surface-2 hover:text-foreground',
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo-placeholder.svg" alt="" className="h-8 w-8" />
      <div className="leading-tight">
        <p className="text-gradient font-semibold">{tr.appName}</p>
        <p className="text-[10px] tracking-[0.25em] text-muted">{tr.brand.toUpperCase()}</p>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { client, refresh, email } = useAuth();
  const [open, setOpen] = useState(false);
  const signOut = () => void client.signOut().then(refresh);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-border bg-surface/60 p-4 backdrop-blur lg:flex">
        <Brand />
        <Nav />
        <div className="mt-auto border-t border-border pt-4">
          <p className="truncate px-3 text-xs text-muted">{email}</p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4" aria-hidden />
            {tr.signOut}
          </Button>
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <Button variant="ghost" size="icon" aria-label={tr.menu} onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </header>
      {open && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={tr.menu}
        >
          <button
            className="absolute inset-0 bg-black/70"
            aria-label={tr.closeMenu}
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-l border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                aria-label={tr.closeMenu}
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
            <Button variant="outline" size="sm" className="mt-auto" onClick={signOut}>
              <LogOut className="h-4 w-4" aria-hidden />
              {tr.signOut}
            </Button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
