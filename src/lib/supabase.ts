import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase connection used for signing in.
 * The two values come from Vercel (Settings → Environment Variables) or from a local .env file:
 *   VITE_SUPABASE_URL       e.g. https://abcdefgh.supabase.co
 *   VITE_SUPABASE_ANON_KEY  the "anon public" key from Supabase → Project Settings → API
 * The anon key is designed to be public; the approved-emails rule is enforced inside Supabase.
 */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const url = env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

/** False until both values are set, so the app can show setup steps instead of failing. */
export const supabaseConfigured = url.startsWith('https://') && anonKey.length > 20;

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
