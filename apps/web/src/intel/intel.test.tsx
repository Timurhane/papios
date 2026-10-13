import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { PanelApiProvider } from '@/data/PanelApiContext';
import type { LeafletMapProps } from './LeafletMap';
import { FakePanelApi } from '@/test/fake-panel-api';
import { ContentPage } from './ContentPage';
import { MapPage } from './MapPage';
import { MetricsPage } from './MetricsPage';
import { PrintPage } from './PrintPage';
import { RoutinesPage } from './RoutinesPage';

// Leaflet needs a real layout engine; the map itself is replaced, the page logic is tested.
vi.mock('./LeafletMap', () => ({
  LeafletMap: ({ companies, route, onToggle }: LeafletMapProps) => (
    <div aria-label="Harita">
      {companies.map((c) => (
        <button key={c.id} onClick={() => onToggle(c.id)}>
          işaret {c.name}
        </button>
      ))}
      <span data-testid="route">{route.join(',')}</span>
    </div>
  ),
}));

function renderAt(path: string, api = new FakePanelApi()) {
  render(
    <PanelApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/rutinler" element={<RoutinesPage />} />
          <Route path="/icerik" element={<ContentPage />} />
          <Route path="/olcutler" element={<MetricsPage />} />
          <Route path="/harita" element={<MapPage />} />
          <Route path="/harita/yazdir" element={<PrintPage />} />
        </Routes>
      </MemoryRouter>
    </PanelApiProvider>,
  );
  return api;
}

describe('Rutinler', () => {
  it('lists routines, toggles them and changes their time', async () => {
    const api = renderAt('/rutinler');
    expect(
      await screen.findByText('Hafta içi her gün 08:45 · Sabah brifingi · hazır'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Haftalık patron özeti açık'));
    expect(api.routines[1]?.enabled).toBe(false);
    const time = screen.getByLabelText('Sabah brifingi saati');
    await userEvent.clear(time);
    await userEvent.type(time, '09:15');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Saati kaydet' })[0] as HTMLElement,
    );
    expect(api.routines[0]).toMatchObject({
      schedule: { kind: 'weekdays', time: '09:15' },
      next_run_at: null,
    });
  });

  it('creates a routine from plain language after showing what it understood', async () => {
    const api = new FakePanelApi();
    api.hasWorker = true;
    const spec = {
      name: 'Sıcak adaylar',
      action: 'hot_leads_digest',
      schedule: { kind: 'weekly', time: '09:00', days: [1] },
      params: { min_score: 70, limit: 10 },
    };
    api.workerReplies['routine.parse'] = {
      spec,
      description: 'Sıcak adaylar — Her Pazartesi 09:00 — Sıcak adaylar özeti',
    };
    renderAt('/rutinler', api);
    await userEvent.type(
      await screen.findByLabelText('Rutin isteği'),
      "Her pazartesi 9'da sıcak adayları özetle",
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anla' }));
    expect(await screen.findByText(/Her Pazartesi 09:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(api.workerCalls.map((c) => c.action)).toEqual(['routine.parse', 'routine.save']);
    expect(api.workerCalls[1]?.body).toEqual({ spec });
  });
});

describe('İçerik', () => {
  it('offers one-tap sharing for approved drafts and records posting', async () => {
    const api = renderAt('/icerik');
    const share = await screen.findByRole('link', { name: "X'te paylaş" });
    expect(share.getAttribute('href')).toMatch(/^https:\/\/x\.com\/intent\/post\?text=Gece/);
    expect(screen.getByText(/Onay için Bugün ekranı/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paylaştım' }));
    expect(api.content[0]?.status).toBe('posted');
  });
});

describe('Ölçütler', () => {
  it('shows revenue, funnel with rates, clients and health; filters by playbook', async () => {
    const api = renderAt('/olcutler');
    expect(await screen.findByText('Hedefe kalan: ₺78.325')).toBeInTheDocument();
    const f = screen.getByRole('list', { name: 'Huni' });
    expect(within(f).getByText('Temas').parentElement?.textContent).toContain('120');
    expect(within(f).getByText('Cevap').parentElement?.textContent).toContain('%15');
    expect(screen.getByText('13 saat')).toBeInTheDocument();
    expect(screen.getByText(/^Örnek Diş Kliniği — 20 Kas 2026/)).toBeInTheDocument();
    expect(screen.getByText('Kota gemini: 40/250 bugün')).toBeInTheDocument();
    const limits = screen.getByRole('list', { name: 'Ücretsiz limitler' });
    expect(within(limits).getByText(/42,5 \/ 500 MB · %9/)).toBeInTheDocument();
    expect(within(limits).getByText('Limite yaklaşıldı.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Playbook'), 'sinyal');
    expect(api.metricsCalls.at(-1)).toEqual({ days: 30, playbook: 'sinyal', channel: 'all' });
  });
});

describe('Harita', () => {
  it('plans a nearest-neighbour route for picked companies and links to the print view', async () => {
    renderAt('/harita');
    await userEvent.click(await screen.findByRole('button', { name: 'işaret Uzak Otel' }));
    await userEvent.click(screen.getByLabelText('Örnek Diş Kliniği rotaya ekle'));
    const route = screen.getByRole('list', { name: 'Ziyaret rotası' });
    expect(
      within(route)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Örnek Diş Kliniği — Anafartalar Cd. 1', 'Uzak Otel — Uzak Cd. 9']);
    expect(screen.getByTestId('route').textContent).toBe('c1,m1');
    expect(
      screen.getByRole('link', { name: 'Yazdırılabilir analizler' }).getAttribute('href'),
    ).toBe('/harita/yazdir?ids=c1,m1');
  });

  it('filters by minimum score', async () => {
    renderAt('/harita');
    await screen.findByRole('list', { name: 'Haritadaki adaylar' });
    const min = screen.getByLabelText('En düşük puan');
    await userEvent.clear(min);
    await userEvent.type(min, '50');
    const list = screen.getByRole('list', { name: 'Haritadaki adaylar' });
    expect(within(list).queryByText('Soğuk Galeri')).toBeNull();
    expect(within(list).getByText('Uzak Otel')).toBeInTheDocument();
  });

  it('prints one page per stop with the analysis', async () => {
    renderAt('/harita/yazdir?ids=c1');
    expect(await screen.findByText(/Mobil site yavaş olduğu için/)).toBeInTheDocument();
    expect(screen.getByText('Puanın gerekçesi')).toBeInTheDocument();
    expect(screen.queryByText('info@ornekdis.com')).toBeNull();
  });
});
