import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PanelApiProvider } from '@/data/PanelApiContext';
import { FakePanelApi } from '@/test/fake-panel-api';
import { TodayPage } from '@/today/TodayPage';
import { CompanyPage } from './CompanyPage';
import { CrmPage } from './CrmPage';
import { nextStepText } from './labels';

function renderAt(path: string, api = new FakePanelApi()) {
  render(
    <PanelApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/crm" element={<CrmPage />} />
          <Route path="/crm/:id" element={<CompanyPage />} />
        </Routes>
      </MemoryRouter>
    </PanelApiProvider>,
  );
  return api;
}

describe('CRM list and kanban', () => {
  it('lists companies with score and next step', async () => {
    renderAt('/crm');
    const list = await screen.findByRole('list', { name: 'Firmalar' });
    expect(within(list).getByText('Örnek Diş Kliniği')).toBeInTheDocument();
    expect(within(list).getByLabelText('Puan 78')).toBeInTheDocument();
    expect(within(list).getByText('Playbook: Soğuk Ana')).toBeInTheDocument();
  });

  it('filters by search', async () => {
    renderAt('/crm');
    await screen.findByText('Yılmaz Emlak');
    await userEvent.type(screen.getByPlaceholderText('Firma, şehir veya sektör ara'), 'emlak');
    await screen.findByText('Yılmaz Emlak');
    expect(screen.queryByText('Örnek Diş Kliniği')).not.toBeInTheDocument();
  });

  it('kanban groups by stage', async () => {
    renderAt('/crm');
    await screen.findByText('Yılmaz Emlak');
    await userEvent.click(screen.getByRole('button', { name: /Kanban/ }));
    expect(
      within(screen.getByRole('region', { name: "Playbook'a hazır" })).getByText(
        'Örnek Diş Kliniği',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Bekleme listesi' })).getByText('Yılmaz Emlak'),
    ).toBeInTheDocument();
  });

  it('CSV upload parses Turkish headers and queues rows', async () => {
    const api = renderAt('/crm');
    await userEvent.click(await screen.findByRole('button', { name: 'CSV yükle' }));
    const file = new File(
      ['Firma Adı;Web Sitesi;Şehir\nKıyı Otel;kiyiotel.com;Balıkesir\n'],
      'adaylar.csv',
      { type: 'text/csv' },
    );
    await userEvent.upload(screen.getByLabelText('CSV dosyası'), file);
    expect(await screen.findByText(/1 satır/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kuyruğa ekle' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Kuyruğa eklendi');
    expect(api.imports[0]).toEqual([
      { name: 'Kıyı Otel', website: 'kiyiotel.com', city: 'Balıkesir' },
    ]);
  });
});

describe('company card', () => {
  it('shows score breakdown, rationale, analysis, contacts and timeline', async () => {
    renderAt('/crm/c1');
    expect(await screen.findByRole('heading', { name: 'Örnek Diş Kliniği' })).toBeInTheDocument();
    expect(screen.getByText(/Mobil hız düşük \(35\/100\)/)).toBeInTheDocument();
    expect(screen.getByText(/randevu talepleri kaçıyor/)).toBeInTheDocument();
    expect(screen.getByText(/PageSpeed mobil: 35/)).toBeInTheDocument();
    expect(screen.getByText('karar verici')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Zaman çizelgesi' })).getByText(
        'Puan 78 → Soğuk Ana',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Playbook: Soğuk Ana')).toBeInTheDocument();
  });

  it('next step can be changed to waiting with a reason and date (K-2.5)', async () => {
    const api = renderAt('/crm/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Beklemeye al' }));
    await userEvent.type(screen.getByLabelText('Bekleme nedeni'), 'Sezon sonu aranacak');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(api.steps[0]).toMatchObject({
      id: 'c1',
      step: { kind: 'waiting', reason: 'Sezon sonu aranacak' },
    });
    expect(await screen.findByText(/Sezon sonu aranacak/)).toBeInTheDocument();
  });

  it('next step text always says something', () => {
    expect(
      nextStepText({
        next_step_kind: 'waiting',
        assigned_playbook: null,
        waiting_reason: null,
        waiting_until: null,
      }),
    ).toBe('Bekliyor');
    expect(
      nextStepText({
        next_step_kind: 'closed',
        assigned_playbook: null,
        waiting_reason: null,
        waiting_until: null,
      }),
    ).toBe('Kapalı');
  });
});

describe('Bugün', () => {
  it('shows approvals, fresh analyses and quota', async () => {
    renderAt('/');
    expect(await screen.findByText('Onay bekleyenler (1)')).toBeInTheDocument();
    expect(screen.getByText('Mail: Örnek Klinik')).toBeInTheDocument();
    expect(screen.getByText('Örnek Diş Kliniği')).toBeInTheDocument();
    expect(screen.getByText('gemini')).toBeInTheDocument();
  });
});
