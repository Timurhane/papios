import { Route, Routes } from 'react-router';
import { AuthGate } from '@/auth/AuthGate';
import { Shell } from '@/layout/Shell';
import { panelModules } from '@/modules';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { NotFound } from '@/pages/NotFound';

export function App() {
  return (
    <AuthGate>
      <Shell>
        <Routes>
          {panelModules.map((m) => (
            <Route key={m.path} path={m.path} element={<ModulePlaceholder module={m} />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </AuthGate>
  );
}
