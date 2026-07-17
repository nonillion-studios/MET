import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      // Signup/reset links are opened from a mail app, not necessarily the browser that
      // requested them — PKCE (the default) needs a code verifier stashed in that original
      // browser's storage, so it silently fails whenever the link is opened elsewhere.
      // The implicit flow puts the session tokens directly in the redirect URL instead,
      // so the link works no matter where it's opened.
      flowType: 'implicit',
    },
  },
);
