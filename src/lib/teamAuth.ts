import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export interface AppProfile {
  name: string;
  avatar: string;
}

export function profileFromSession(session: Session | null): AppProfile {
  const meta = session?.user?.user_metadata || {};
  return { name: meta.name || '', avatar: meta.avatar || '' };
}

const KNOWN_EMAILS_KEY = 'team_known_emails';

export function getKnownEmails(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KNOWN_EMAILS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function rememberEmail(email: string) {
  const existing = getKnownEmails().filter(e => e !== email);
  localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify([email, ...existing].slice(0, 8)));
}

export function useTeamAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load Supabase session:', err);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) rememberEmail(email);
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string, avatar: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, avatar } },
    });
    if (error) return { error: error.message, needsConfirmation: false };
    rememberEmail(email);
    // If email confirmation is required, Supabase returns a user but no session.
    return { error: null, needsConfirmation: !data.session };
  }, []);

  const updateProfile = useCallback(async (name: string, avatar: string) => {
    const { error } = await supabase.auth.updateUser({ data: { name, avatar } });
    if (!error) {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
    }
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return error ? error.message : null;
  }, []);

  return { session, loading, signIn, signUp, signOut, updateProfile, signInWithGoogle };
}
