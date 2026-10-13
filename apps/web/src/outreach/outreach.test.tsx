import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PanelApiProvider } from '@/data/PanelApiContext';
import { FakePanelApi } from '@/test/fake-panel-api';
import { TodayPage } from '@/today/TodayPage';
import { InboxPage } from './InboxPage';
import { PlaybooksPage } from './PlaybooksPage';

function renderAt(path: string, api = new FakePanelApi()) {
  render(
    <PanelApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/gelen-kutusu" element={<InboxPage />} />
          <Route path="/playbooklar" element={<PlaybooksPage />} />
        </Routes>
      </MemoryRouter>
    </PanelApiProvider>,
  );
  return api;
}

describe('panel approvals (Bugün)', () => {
  it('approves a draft as is', async () => {
    const api = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Soğuk Ana 1\. adım/ }));
    expect(screen.getByText(/Mobil siteniz yavaş açılıyor/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    expect(api.decisions).toEqual([{ id: 'a1', decision: 'approved' }]);
    expect(await screen.findByText('Onay bekleyen iş yok ✅')).toBeInTheDocument();
  });

  it('edits then approves; the edit is sent along', async () => {
    const api = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Soğuk Ana 1\. adım/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle' }));
    const text = screen.getByLabelText('Metin');
    await userEvent.clear(text);
    await userEvent.type(text, 'Merhaba, kısa bir not.');
    await userEvent.click(screen.getByRole('button', { name: 'Düzenlenmiş hâliyle onayla' }));
    expect(api.decisions[0]).toMatchObject({
      decision: 'approved',
      edit: { text: 'Merhaba, kısa bir not.', subject: 'Mobil siteniz hakkında' },
    });
  });

  it('blocks approving a cold email over the word limit', async () => {
    const api = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Soğuk Ana 1\. adım/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Düzenle' }));
    const text = screen.getByLabelText('Metin');
    await userEvent.clear(text);
    await userEvent.type(text, 'kelime '.repeat(81));
    expect(screen.getByText('81/80 kelime (soğuk mail sınırı)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Düzenlenmiş hâliyle onayla' })).toBeDisabled();
    expect(api.decisions).toEqual([]);
  });

  it('rejects a draft', async () => {
    const api = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Soğuk Ana 1\. adım/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Reddet' }));
    expect(api.decisions).toEqual([{ id: 'a1', decision: 'rejected' }]);
  });
});

describe('one-click queue and calls (Bugün)', () => {
  it('shows a WhatsApp link with the prepared text and records "Gönderdim"', async () => {
    const api = renderAt('/');
    const link = await screen.findByRole('link', { name: "WhatsApp'ta aç" });
    expect(link.getAttribute('href')).toContain('wa.me/905321112233');
    await userEvent.click(screen.getByRole('button', { name: 'Gönderdim' }));
    expect(api.completions).toEqual([{ id: 't1', action: 'sent' }]);
    expect(await screen.findByText('Gönderilecek tek tık mesaj yok.')).toBeInTheDocument();
  });

  it('lists calls with a tel: link; a call can be skipped', async () => {
    const api = renderAt('/');
    const call = await screen.findByRole('link', { name: 'Ara: +902661234567' });
    expect(call).toHaveAttribute('href', 'tel:+902661234567');
    await userEvent.click(screen.getByRole('button', { name: 'Aradım' }));
    expect(api.completions).toEqual([{ id: 't2', action: 'sent' }]);
  });

  it('shows hot replies', async () => {
    renderAt('/');
    expect(await screen.findByText('Sıcak cevaplar (1)')).toBeInTheDocument();
  });
});

describe('Gelen kutusu', () => {
  it('lists classified replies and filters by class', async () => {
    renderAt('/gelen-kutusu');
    const list = await screen.findByRole('list', { name: 'Cevaplar' });
    expect(within(list).getByText('Soru')).toBeInTheDocument();
    expect(within(list).getByText('Otomatik yanıt')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Sınıf' })).getByRole('button', { name: 'Soru' }),
    );
    await screen.findByText('Merhaba, ilgimi çekti. Fiyat nedir?');
    expect(screen.queryByText('Ofis dışındayım.')).not.toBeInTheDocument();
  });

  it('marks a reply handled; handled replies leave the open view', async () => {
    const api = renderAt('/gelen-kutusu');
    const list = await screen.findByRole('list', { name: 'Cevaplar' });
    await userEvent.click(within(list).getAllByRole('button', { name: 'İşlendi' })[0]!);
    expect(api.inbox.find((m) => m.id === 'm1')?.handled).toBe(true);
    await screen.findByText('Ofis dışındayım.');
    expect(screen.queryByText('Merhaba, ilgimi çekti. Fiyat nedir?')).not.toBeInTheDocument();
  });
});

describe("Playbook'lar", () => {
  it('shows steps with per-step performance', async () => {
    renderAt('/playbooklar');
    const table = await screen.findByRole('table', { name: 'Soğuk Ana adımları' });
    expect(within(table).getByText('En güçlü bulgu')).toBeInTheDocument();
    expect(within(table).getByText('%20')).toBeInTheDocument();
    expect(screen.getByText(/3 aktif firma · 10 temas · cevap oranı %20/)).toBeInTheDocument();
  });
});
