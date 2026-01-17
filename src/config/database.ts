import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Supabase client with service role key (for server-side operations)
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

// Supabase client with anon key (for user-scoped operations)
export const supabaseAnon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
