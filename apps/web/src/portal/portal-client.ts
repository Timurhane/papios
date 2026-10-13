import type { SupabaseClient } from '@supabase/supabase-js';

/** K-13.11: what a client sees about their own project (shaped by app.portal_project()). */
export interface PortalProject {
  name: string;
  status: 'setup' | 'active' | 'paused' | 'ended';
  started_on: string;
  contract_end: string | null;
  tasks: { title: string; done: boolean }[];
  payments: {
    kind: 'setup' | 'monthly' | 'project' | 'other';
    amount_kurus: number;
    due_on: string;
    status: 'due' | 'paid';
    payment_link: string | null;
  }[];
  metrics: { period: string; metrics: Record<string, number> }[];
}

export interface PortalClient {
  hasSession(): Promise<boolean>;
  signIn(email: string, password: string): Promise<'ok' | 'invalid'>;
  signOut(): Promise<void>;
  /** 'closed' while the client_portal flag is off; null when the account has no project. */
  project(): Promise<PortalProject | 'closed' | null>;
}

export function createSupabasePortalClient(supabase: SupabaseClient): PortalClient {
  return {
    async hasSession() {
      return Boolean((await supabase.auth.getSession()).data.session);
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? 'invalid' : 'ok';
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async project() {
      const { data, error } = await supabase.schema('app').rpc('portal_project');
      if (error) {
        if (error.code === '42501') return 'closed';
        throw new Error(error.message);
      }
      return (data as PortalProject | null) ?? null;
    },
  };
}
