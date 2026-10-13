import { Route, Routes } from 'react-router';
import { AuthGate } from '@/auth/AuthGate';
import { Shell } from '@/layout/Shell';
import { CompanyPage } from '@/crm/CompanyPage';
import { CrmPage } from '@/crm/CrmPage';
import { panelModules } from '@/modules';
import { InboxPage } from '@/outreach/InboxPage';
import { PlaybooksPage } from '@/outreach/PlaybooksPage';
import { NewProposalPage } from '@/proposals/NewProposalPage';
import { ProposalPage } from '@/proposals/ProposalPage';
import { ProposalsPage } from '@/proposals/ProposalsPage';
import { DemosPage } from '@/sales/DemosPage';
import { FinancePage } from '@/ops/FinancePage';
import { ModulesPage } from '@/ops/ModulesPage';
import { NotesPage } from '@/ops/NotesPage';
import { ProjectPage } from '@/ops/ProjectPage';
import { ProjectsPage } from '@/ops/ProjectsPage';
import { TodayPage } from '@/today/TodayPage';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { NotFound } from '@/pages/NotFound';

const IMPLEMENTED = new Set([
  '/',
  '/crm',
  '/gelen-kutusu',
  '/playbooklar',
  '/teklifler',
  '/demolar',
  '/projeler',
  '/finans',
  '/notlar',
  '/teslim-modulleri',
]);

export function App() {
  return (
    <AuthGate>
      <Shell>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/crm" element={<CrmPage />} />
          <Route path="/crm/:id" element={<CompanyPage />} />
          <Route path="/gelen-kutusu" element={<InboxPage />} />
          <Route path="/playbooklar" element={<PlaybooksPage />} />
          <Route path="/teklifler" element={<ProposalsPage />} />
          <Route path="/teklifler/yeni" element={<NewProposalPage />} />
          <Route path="/teklifler/:id" element={<ProposalPage />} />
          <Route path="/demolar" element={<DemosPage />} />
          <Route path="/projeler" element={<ProjectsPage />} />
          <Route path="/projeler/:id" element={<ProjectPage />} />
          <Route path="/finans" element={<FinancePage />} />
          <Route path="/notlar" element={<NotesPage />} />
          <Route path="/teslim-modulleri" element={<ModulesPage />} />
          {panelModules
            .filter((m) => !IMPLEMENTED.has(m.path))
            .map((m) => (
              <Route key={m.path} path={m.path} element={<ModulePlaceholder module={m} />} />
            ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </AuthGate>
  );
}
