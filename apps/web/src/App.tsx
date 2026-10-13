import { Route, Routes } from 'react-router';
import { AuthGate } from '@/auth/AuthGate';
import { Shell } from '@/layout/Shell';
import { CompanyPage } from '@/crm/CompanyPage';
import { CrmPage } from '@/crm/CrmPage';
import { panelModules } from '@/modules';
import { InboxPage } from '@/outreach/InboxPage';
import { PlaybooksPage } from '@/outreach/PlaybooksPage';
import { TodayPage } from '@/today/TodayPage';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { NotFound } from '@/pages/NotFound';

const IMPLEMENTED = new Set(['/', '/crm', '/gelen-kutusu', '/playbooklar']);

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
