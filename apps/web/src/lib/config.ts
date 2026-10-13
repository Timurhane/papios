export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  allowedEmail: string;
}

/** Reads public (browser-safe) config. Returns null when anything is missing. */
export function readPublicConfig(env: Record<string, string | undefined>): PublicConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  const allowedEmail = env.VITE_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!supabaseUrl || !supabaseAnonKey || !allowedEmail) return null;
  return { supabaseUrl, supabaseAnonKey, allowedEmail };
}
