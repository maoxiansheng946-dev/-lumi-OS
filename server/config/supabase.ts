import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for Supabase integration');
  }

  supabaseClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
}

/** Sync a local user to Supabase auth — idempotent, creates if not exists */
export async function syncUserToSupabase(uid: string, username: string, passwordHash: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabase();
    // Check if user already exists in Supabase
    const { data: existing } = await supabase
      .from('lumi_users')
      .select('id')
      .eq('local_uid', uid)
      .single();

    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('lumi_users')
      .insert({
        local_uid: uid,
        username,
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Supabase] Sync user failed:', error.message);
      return null;
    }
    return data.id;
  } catch (err: any) {
    console.error('[Supabase] Sync error:', err.message);
    return null;
  }
}
