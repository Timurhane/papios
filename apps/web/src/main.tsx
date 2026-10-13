import { createClient } from '@supabase/supabase-js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { createSupabaseAuthClient } from './auth/auth-client';
import { ConfigMissing } from './ConfigMissing';
import { readPublicConfig } from './lib/config';
import { PanelApiProvider } from './data/PanelApiContext';
import { createSupabasePanelApi } from './data/supabase-api';
import { createSupabasePortalClient } from './portal/portal-client';
import { PortalApp } from './portal/PortalApp';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
const root = createRoot(container);
const config = readPublicConfig(import.meta.env);

if (!config) {
  root.render(<ConfigMissing />);
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  // K-13.11: the client portal is a separate app; the panel itself only ever admits Timurhan's account.
  if (window.location.pathname.startsWith('/portal')) {
    root.render(
      <StrictMode>
        <PortalApp client={createSupabasePortalClient(supabase)} />
      </StrictMode>,
    );
  } else {
    const authClient = createSupabaseAuthClient(supabase, config.allowedEmail);
    root.render(
      <StrictMode>
        <BrowserRouter>
          <AuthProvider client={authClient}>
            <PanelApiProvider api={createSupabasePanelApi(supabase, config.apiUrl)}>
              <App />
            </PanelApiProvider>
          </AuthProvider>
        </BrowserRouter>
      </StrictMode>,
    );
  }
}
