import { useRef, useState } from 'react';
import { UserPlus, LogIn, Mail, Lock, User, ImagePlus, MailCheck } from 'lucide-react';
import { GlassCard, Button, Input } from './ui';
import { swal } from '../lib/swalTheme';
import { readAvatarFile } from '../lib/image';
import { useTeamAuth, getKnownEmails } from '../lib/teamAuth';
import logo from '../assets/logo-new.jpg';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, signIn, signUp } = useTeamAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ink-faint text-sm">Loading...</div>;
  }

  if (session) return <>{children}</>;

  if (awaitingConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GlassCard className="p-8 w-full max-w-sm space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-accent-soft border border-accent/30 flex items-center justify-center">
            <MailCheck className="text-accent" size={22} />
          </div>
          <h2 className="text-lg font-display font-bold text-ink">Confirm your email</h2>
          <p className="text-sm text-ink-muted">We sent a confirmation link to <span className="font-semibold text-ink">{email}</span>. Click it, then sign in below.</p>
          <Button className="w-full" onClick={() => { setAwaitingConfirmation(false); setMode('signin'); }}>Back to Sign In</Button>
        </GlassCard>
      </div>
    );
  }

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      swal({ icon: 'error', title: 'Missing details', text: 'Enter your email and password.' });
      return;
    }
    setSubmitting(true);
    const error = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) swal({ icon: 'error', title: 'Sign in failed', text: error });
  };

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password) {
      swal({ icon: 'error', title: 'Missing details', text: 'Name, email, and password are all required.' });
      return;
    }
    if (password.length < 6) {
      swal({ icon: 'error', title: 'Weak Password', text: 'Use at least 6 characters.' });
      return;
    }
    setSubmitting(true);
    const result = await signUp(email.trim(), password, name.trim(), avatar);
    setSubmitting(false);
    if (result.error) {
      swal({ icon: 'error', title: 'Sign up failed', text: result.error });
      return;
    }
    if (result.needsConfirmation) {
      setAwaitingConfirmation(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <GlassCard className="p-8 w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <img src={logo} alt="MET" className="w-12 h-12 rounded-2xl object-cover ring-1 ring-hairline" />
          <h2 className="text-lg font-display font-bold text-ink">{mode === 'signup' ? 'Create your profile' : 'Welcome back'}</h2>
          <p className="text-xs text-ink-muted">{mode === 'signup' ? 'This is your identity across the whole app.' : 'Sign in to continue.'}</p>
        </div>

        {mode === 'signup' && (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="w-20 h-20 rounded-full border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden hover:border-accent transition-colors"
            >
              {avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : <ImagePlus size={20} className="text-ink-faint" />}
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setAvatar); }} />
            <span className="text-[11px] text-ink-faint">Profile picture (optional)</span>
          </div>
        )}

        <div className="space-y-3">
          {mode === 'signup' && (
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><User size={12} /> Name</label>
              <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold flex items-center gap-1"><Mail size={12} /> Email</label>
            <Input type="email" placeholder="you@team.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {mode === 'signin' && getKnownEmails().length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {getKnownEmails().map(e => (
                  <button
                    key={e}
                    onClick={() => setEmail(e)}
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-hairline text-ink-faint hover:border-accent/40 hover:text-accent transition-colors"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold flex items-center gap-1"><Lock size={12} /> Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (mode === 'signup' ? handleSignUp() : handleSignIn()); }}
            />
          </div>
        </div>

        <Button onClick={mode === 'signup' ? handleSignUp : handleSignIn} disabled={submitting} className="w-full">
          {mode === 'signup' ? <UserPlus size={14} /> : <LogIn size={14} />}
          {submitting ? 'Please wait...' : mode === 'signup' ? 'Create Profile' : 'Sign In'}
        </Button>

        <button
          onClick={() => setMode(m => m === 'signup' ? 'signin' : 'signup')}
          className="w-full text-center text-xs text-ink-muted hover:text-accent transition-colors"
        >
          {mode === 'signup' ? 'Already have a profile? Sign in' : "Don't have a profile? Sign up"}
        </button>
      </GlassCard>
    </div>
  );
}
