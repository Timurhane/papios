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
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
const root = createRoot(container);
const config = readPublicConfig(import.meta.env);

if (!config) {
  root.render(<ConfigMissing />);
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
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
