import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PortalClient, PortalProject } from './portal-client';
import { PortalApp } from './PortalApp';

const project: PortalProject = {
  name: 'Örnek Diş Kliniği — Sistem',
  status: 'setup',
  started_on: '2026-10-13',
  contract_end: '2027-01-12',
  tasks: [
    { title: 'Kurulum formu alındı', done: true },
    { title: 'Site sohbet kutusu kuruldu', done: false },
  ],
  payments: [
    {
      kind: 'setup',
      amount_kurus: 1_530_000,
      due_on: '2026-10-13',
      status: 'due',
      payment_link: 'https://odeme.test/1',
    },
  ],
  metrics: [{ period: '2026-10-01', metrics: { messages: 120, leads: 9 } }],
};

function fake(result: PortalProject | 'closed' | null): PortalClient & { signedOut: boolean } {
  let session = false;
  const c = {
    signedOut: false,
    hasSession: async () => session,
    signIn: async (_e: string, p: string) => {
      if (p !== 'dogru') return 'invalid' as const;
      session = true;
      return 'ok' as const;
    },
    signOut: async () => {
      session = false;
      c.signedOut = true;
    },
    project: async () => result,
  };
  return c;
}

async function login() {
  await userEvent.type(await screen.findByLabelText('E-posta'), 'musteri@ornek.com');
  await userEvent.type(screen.getByLabelText('Şifre'), 'dogru');
  await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
}

describe('Müşteri portalı (K-13.11)', () => {
  it('shows the client their own project, checklist, payments and monthly results', async () => {
    render(<PortalApp client={fake(project)} />);
    await login();
    expect(await screen.findByText('Kurulum adımları (1/2)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Öde' }).getAttribute('href')).toBe(
      'https://odeme.test/1',
    );
    expect(screen.getByText(/Gelen mesaj 120/)).toBeInTheDocument();
  });

  it('signs the user out and says the portal is closed while the flag is off', async () => {
    const c = fake('closed');
    render(<PortalApp client={c} />);
    await login();
    expect(await screen.findByText(/Müşteri portalı şu an kapalı/)).toBeInTheDocument();
    expect(c.signedOut).toBe(true);
  });

  it('rejects a wrong password', async () => {
    render(<PortalApp client={fake(project)} />);
    await userEvent.type(await screen.findByLabelText('E-posta'), 'musteri@ornek.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'yanlis');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(await screen.findByText('E-posta veya şifre hatalı.')).toBeInTheDocument();
  });
});
