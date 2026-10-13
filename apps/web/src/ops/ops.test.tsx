import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PanelApiProvider } from '@/data/PanelApiContext';
import { FakePanelApi } from '@/test/fake-panel-api';
import { FinancePage } from './FinancePage';
import { ModulesPage } from './ModulesPage';
import { NotesPage } from './NotesPage';
import { ProjectPage } from './ProjectPage';
import { ProjectsPage } from './ProjectsPage';

function renderAt(path: string, api = new FakePanelApi()) {
  render(
    <PanelApiProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projeler" element={<ProjectsPage />} />
          <Route path="/projeler/:id" element={<ProjectPage />} />
          <Route path="/finans" element={<FinancePage />} />
          <Route path="/notlar" element={<NotesPage />} />
          <Route path="/teslim-modulleri" element={<ModulesPage />} />
        </Routes>
      </MemoryRouter>
    </PanelApiProvider>,
  );
  return api;
}

describe('Projeler', () => {
  it('lists projects with checklist progress', async () => {
    renderAt('/projeler');
    const list = await screen.findByRole('list', { name: 'Projeler' });
    expect(within(list).getByText('Kontrol listesi 0/2')).toBeInTheDocument();
  });

  it('shows the Claude Code prompt, ticks the checklist and records satisfaction', async () => {
    const api = renderAt('/projeler/pr1');
    expect(await screen.findByText(/wrangler secret put/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'papi-config.json indir' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Site sohbet kutusu kodu siteye eklendi'));
    expect(api.project.tasks[1]?.done).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Memnun' }));
    expect(api.project.satisfaction).toBe('positive');
    await userEvent.selectOptions(screen.getByLabelText('Proje durumu'), 'active');
    expect(api.project.status).toBe('active');
  });
});

describe('Finans', () => {
  it('shows MRR and target, marks a payment paid, adds an expense', async () => {
    const api = renderAt('/finans');
    expect(await screen.findByText('₺17.340')).toBeInTheDocument();
    expect(screen.getByText('Hedefe kalan: ₺82.660')).toBeInTheDocument();
    const open = screen.getByRole('list', { name: 'Açık tahsilatlar' });
    await userEvent.click(within(open).getByRole('button', { name: 'Ödendi' }));
    expect(api.payments[0]?.status).toBe('paid');
    await userEvent.type(screen.getByLabelText('Kategori'), 'Alan adı');
    await userEvent.type(screen.getByLabelText('Tutar (TL)'), '450');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(api.financeEntries[0]).toMatchObject({
      kind: 'expense',
      category: 'Alan adı',
      amount_kurus: 45_000,
    });
  });
});

describe('Notlar', () => {
  it('adds a note with tags and searches by tag', async () => {
    const api = renderAt('/notlar');
    await userEvent.type(
      await screen.findByLabelText('Yeni not'),
      'Otel için #fikir: geç check-in mesajı',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(api.noteRows[0]).toMatchObject({ tags: ['fikir'], source: 'panel' });
    await userEvent.type(screen.getByLabelText('Notlarda ara'), '#randevu');
    const list = await screen.findByRole('list', { name: 'Notlar' });
    expect(
      await within(list).findByText('Klinikler için #randevu paketi fikri'),
    ).toBeInTheDocument();
  });
});

describe('Teslim modülleri', () => {
  it('lists the five modules and marks the reference implementation', async () => {
    renderAt('/teslim-modulleri');
    const list = await screen.findByRole('list', { name: 'Modüller' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getByText('Çalışan örnek')).toBeInTheDocument();
  });
});
