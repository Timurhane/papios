import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CompanyPage } from '@/crm/CompanyPage';
import { PanelApiProvider } from '@/data/PanelApiContext';
import { DemosPage } from '@/sales/DemosPage';
import { FakePanelApi } from '@/test/fake-panel-api';
import { NewProposalPage } from './NewProposalPage';
import { ProposalPage } from './ProposalPage';
import { ProposalsPage } from './ProposalsPage';

vi.mock('./make-pdf', () => ({
  makeProposalPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45])),
}));

function renderAt(path: string, api = new FakePanelApi()) {
  render(
    <PanelApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/teklifler" element={<ProposalsPage />} />
          <Route path="/teklifler/yeni" element={<NewProposalPage />} />
          <Route path="/teklifler/:id" element={<ProposalPage />} />
          <Route path="/demolar" element={<DemosPage />} />
          <Route path="/crm/:id" element={<CompanyPage />} />
        </Routes>
      </MemoryRouter>
    </PanelApiProvider>,
  );
  return api;
}

describe('Teklif stüdyosu', () => {
  it('lists proposals', async () => {
    renderAt('/teklifler');
    const list = await screen.findByRole('list', { name: 'Teklifler' });
    expect(within(list).getByText('AJNA-2026-0001')).toBeInTheDocument();
    expect(within(list).getByText('Taslak')).toBeInTheDocument();
  });

  it('draft: both payment paths side by side; VAT is required; founder discount can be removed', async () => {
    const api = renderAt('/teklifler/p1');
    const setup = await screen.findByLabelText('Kurulumlu');
    expect(within(setup).getByText(/Kurulum: ₺15\.300/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Onaya gönder' })).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Kurucu müşteri indirimi/));
    expect(
      within(screen.getByLabelText('Kurulumlu')).getByText(/Kurulum: ₺25\.500/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('KDV hariç (+ KDV)'));
    await userEvent.click(screen.getByRole('button', { name: 'Onaya gönder' }));
    expect(api.proposals[0]).toMatchObject({ vat_mode: 'excluded', founder_discount: null });
    expect(api.workerCalls).toContainEqual({
      action: 'proposal.submit',
      body: { proposalId: 'p1' },
    });
  });

  it('approved: PDF is made in the browser and stored; WhatsApp link; mark as sent', async () => {
    const api = new FakePanelApi();
    Object.assign(api.proposals[0]!, { status: 'approved', vat_mode: 'excluded' });
    renderAt('/teklifler/p1', api);
    await userEvent.click(await screen.findByRole('button', { name: 'PDF oluştur' }));
    expect(api.pdfs).toEqual([{ id: 'p1', size: 5 }]);
    const wa = await screen.findByRole('link', { name: "WhatsApp'ta gönder" });
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain(
      'https://storage.test/t/p1.pdf?token=x',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Gönderildi olarak işaretle' }));
    expect(api.workerCalls).toContainEqual({ action: 'proposal.sent', body: { proposalId: 'p1' } });
  });

  it('sent: accepted / rejected', async () => {
    const api = new FakePanelApi();
    Object.assign(api.proposals[0]!, {
      status: 'sent',
      vat_mode: 'excluded',
      pdf_path: 't/p1.pdf',
    });
    renderAt('/teklifler/p1', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Kabul edildi (kurulumlu)' }));
    expect(api.workerCalls).toContainEqual({
      action: 'proposal.close',
      body: { proposalId: 'p1', outcome: 'accepted', path: 'setup' },
    });
  });

  it('new: Satıcı drafts a package proposal for a preset company', async () => {
    const api = new FakePanelApi();
    api.workerReplies['proposal.draft'] = { id: 'p1' };
    renderAt('/teklifler/yeni?firma=c1', api);
    await screen.findByText('Örnek Diş Kliniği');
    await userEvent.click(screen.getByRole('button', { name: /Sistem/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Satıcı taslağı hazırlasın' }));
    expect(api.workerCalls[0]).toEqual({
      action: 'proposal.draft',
      body: { companyId: 'c1', packageCode: 'sistem' },
    });
    expect(await screen.findByText('AJNA-2026-0001')).toBeInTheDocument();
  });

  it('new: a custom project is priced by parts × days', async () => {
    const api = renderAt('/teklifler/yeni?firma=c1');
    await userEvent.click(await screen.findByRole('button', { name: /Özel/ }));
    await userEvent.type(screen.getByLabelText('Parça 1'), 'ERP entegrasyonu');
    const days = screen.getByLabelText('Parça 1 gün');
    await userEvent.clear(days);
    await userEvent.type(days, '6');
    expect(await screen.findByText(/₺72\.000/)).toBeInTheDocument(); // 6 × 10.000 + %20
    await userEvent.type(screen.getByRole('textbox', { name: /Giriş paragrafı/ }), 'Kısa giriş');
    await userEvent.click(screen.getByLabelText('KDV dahil'));
    await userEvent.click(screen.getByRole('button', { name: 'Taslağı kaydet' }));
    expect(api.proposals.at(-1)).toMatchObject({ package_code: 'ozel', vat_mode: 'included' });
  });
});

describe('company sales card and demos', () => {
  it('proposes meeting times and records the chosen one', async () => {
    const api = new FakePanelApi();
    api.workerReplies['meeting.propose'] = {
      meetingId: 'mt9',
      slots: [{ start: '2026-10-15T11:00:00.000Z', label: '15 Ekim Perşembe 14:00' }],
    };
    renderAt('/crm/c1', api);
    await userEvent.click(await screen.findByRole('button', { name: 'Görüşme saatleri öner' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bunu seçti' }));
    expect(api.workerCalls.at(-1)).toEqual({
      action: 'meeting.schedule',
      body: { meetingId: 'mt9', start: '2026-10-15T11:00:00.000Z' },
    });
  });

  it('records a meeting note', async () => {
    const api = renderAt('/crm/c1');
    await userEvent.type(
      await screen.findByLabelText('Görüşme notu'),
      'Instagram mesajlarına geç dönüyorlar.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Notu kaydet ve teklif taslağı çıkar' }),
    );
    expect(api.workerCalls.at(-1)?.action).toBe('meeting.note');
  });

  it('explains when the Worker is not connected', async () => {
    const api = new FakePanelApi();
    api.hasWorker = false;
    renderAt('/crm/c1', api);
    expect(await screen.findByText(/Sunucu bağlantısı \(VITE_API_URL\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo oluştur' })).toBeDisabled();
  });

  it('lists demos with use counts', async () => {
    renderAt('/demolar');
    const list = await screen.findByRole('list', { name: 'Demolar' });
    expect(within(list).getByText('3 ziyaret · 5 mesaj')).toBeInTheDocument();
  });
});
