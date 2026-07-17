import { useRef, useState } from 'react';
import { UserPlus, LogIn, Mail, Lock, User, ImagePlus, MailCheck, Check, X, KeyRound } from 'lucide-react';
import { GlassCard, Button, Input, Captcha } from './ui';
import { swal } from '../lib/swalTheme';
import { readAvatarFile } from '../lib/image';
import { useTeamAuth, getKnownEmails } from '../lib/teamAuth';
import logo from '../assets/logo-new.jpg';

const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: 'At least 8 characters', test: pw => pw.length >= 8 },
  { label: 'One uppercase letter', test: pw => /[A-Z]/.test(pw) },
  { label: 'One lowercase letter', test: pw => /[a-z]/.test(pw) },
  { label: 'One number', test: pw => /[0-9]/.test(pw) },
];

function PasswordChecklist({ password }: { password: string }) {
  return (
    <div className="space-y-1 pt-1">
      {PASSWORD_RULES.map(rule => {
        const passed = rule.test(password);
        return (
          <div key={rule.label} className={`flex items-center gap-1.5 text-[11px] ${passed ? 'text-success' : 'text-ink-faint'}`}>
            {passed ? <Check size={11} /> : <X size={11} />}
            {rule.label}
          </div>
        );
      })}
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, signIn, signUp, isRecovery, resetPasswordForEmail, updatePassword } = useTeamAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ink-faint text-sm">Loading...</div>;
  }

  const switchMode = (next: 'signin' | 'signup' | 'forgot') => {
    setCaptchaVerified(false);
    setMode(next);
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      swal({ icon: 'error', title: 'Missing email', text: 'Enter your email address.' });
      return;
    }
    if (!captchaVerified) {
      swal({ icon: 'error', title: 'Quick check failed', text: 'Solve the quick check before continuing.' });
      return;
    }
    setSubmitting(true);
    const error = await resetPasswordForEmail(email.trim());
    setSubmitting(false);
    if (error) {
      swal({ icon: 'error', title: 'Could not send reset link', text: error });
      return;
    }
    setResetSent(true);
  };

  const handleUpdatePassword = async () => {
    if (!PASSWORD_RULES.every(rule => rule.test(newPassword))) {
      swal({ icon: 'error', title: 'Weak Password', text: 'Your new password must meet all the requirements below.' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      swal({ icon: 'error', title: "Passwords don't match", text: 'Re-enter your new password to confirm it.' });
      return;
    }
    setSubmitting(true);
    const error = await updatePassword(newPassword);
    setSubmitting(false);
    if (error) {
      swal({ icon: 'error', title: 'Could not update password', text: error });
      return;
    }
    setNewPassword('');
    setConfirmNewPassword('');
  };

  if (isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GlassCard className="p-8 w-full max-w-sm space-y-5 animate-auth-card">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-accent-soft border border-accent/30 flex items-center justify-center mb-3">
              <KeyRound className="text-accent" size={22} />
            </div>
            <h2 className="text-lg font-display font-bold text-ink">Set a new password</h2>
            <p className="text-xs text-ink-muted mt-1">Choose a new password for your account.</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Lock size={12} /> New Password</label>
              <Input type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <PasswordChecklist password={newPassword} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Lock size={12} /> Confirm New Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleUpdatePassword(); }}
              />
              {confirmNewPassword && (
                <p className={`text-[11px] flex items-center gap-1.5 ${confirmNewPassword === newPassword ? 'text-success' : 'text-danger'}`}>
                  {confirmNewPassword === newPassword ? <Check size={11} /> : <X size={11} />}
                  {confirmNewPassword === newPassword ? 'Passwords match' : "Passwords don't match"}
                </p>
              )}
            </div>
          </div>
          <Button onClick={handleUpdatePassword} disabled={submitting} className="w-full">
            <KeyRound size={14} /> {submitting ? 'Please wait...' : 'Update Password'}
          </Button>
        </GlassCard>
      </div>
    );
  }

  if (session) return <>{children}</>;

  if (mode === 'forgot') {
    if (resetSent) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <GlassCard className="p-8 w-full max-w-sm space-y-4 text-center animate-auth-card">
            <div className="w-12 h-12 mx-auto rounded-full bg-accent-soft border border-accent/30 flex items-center justify-center">
              <MailCheck className="text-accent" size={22} />
            </div>
            <h2 className="text-lg font-display font-bold text-ink">Check your email</h2>
            <p className="text-sm text-ink-muted">We sent a password reset link to <span className="font-semibold text-ink">{email}</span>. Click it to choose a new password.</p>
            <Button className="w-full" onClick={() => { setResetSent(false); switchMode('signin'); }}>Back to Sign In</Button>
          </GlassCard>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GlassCard className="p-8 w-full max-w-sm space-y-5 animate-auth-card">
          <div className="text-center">
            <h2 className="text-lg font-display font-bold text-ink">Reset your password</h2>
            <p className="text-xs text-ink-muted mt-1">Enter your email and we'll send you a reset link.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold flex items-center gap-1"><Mail size={12} /> Email</label>
            <Input
              type="email"
              placeholder="you@team.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleForgotPassword(); }}
            />
          </div>
          <Captcha onChange={setCaptchaVerified} />
          <Button onClick={handleForgotPassword} disabled={submitting} className="w-full">
            <Mail size={14} /> {submitting ? 'Please wait...' : 'Send Reset Link'}
          </Button>
          <button
            onClick={() => switchMode('signin')}
            className="w-full text-center text-xs text-ink-muted hover:text-accent transition-colors"
          >
            Back to Sign In
          </button>
        </GlassCard>
      </div>
    );
  }

  if (awaitingConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GlassCard className="p-8 w-full max-w-sm space-y-4 text-center animate-auth-card">
          <div className="w-12 h-12 mx-auto rounded-full bg-accent-soft border border-accent/30 flex items-center justify-center">
            <MailCheck className="text-accent" size={22} />
          </div>
          <h2 className="text-lg font-display font-bold text-ink">Confirm your email</h2>
          <p className="text-sm text-ink-muted">We sent a confirmation link to <span className="font-semibold text-ink">{email}</span>. Click it, then sign in below.</p>
          <Button className="w-full" onClick={() => { setAwaitingConfirmation(false); switchMode('signin'); }}>Back to Sign In</Button>
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
    if (!PASSWORD_RULES.every(rule => rule.test(password))) {
      swal({ icon: 'error', title: 'Weak Password', text: 'Your password must meet all the requirements below.' });
      return;
    }
    if (password !== confirmPassword) {
      swal({ icon: 'error', title: 'Passwords don\'t match', text: 'Re-enter your password to confirm it.' });
      return;
    }
    if (!captchaVerified) {
      swal({ icon: 'error', title: 'Quick check failed', text: 'Solve the quick check before continuing.' });
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
    <div className="min-h-screen flex items-center justify-center lg:justify-stretch p-4 lg:p-0">
      {/* Branded panel — desktop only */}
      <div className="hidden lg:flex flex-1 h-screen relative overflow-hidden items-center justify-center bg-gradient-to-br from-accent to-[color-mix(in_srgb,var(--color-accent)_60%,black)]">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white, transparent 40%), radial-gradient(circle at 80% 80%, white, transparent 35%)' }} />
        <div className="relative z-10 text-center px-12 max-w-md">
          <img src={logo} alt="MET" className="w-16 h-16 rounded-2xl object-cover ring-1 ring-white/30 mx-auto mb-6 shadow-2xl" />
          <h1 className="text-3xl font-display font-bold text-white mb-3">Manga Editing Tool</h1>
          <p className="text-white/80 text-sm leading-relaxed">A fast, all-in-one workspace for cleaning, translating, and typesetting manga — built for teams that ship.</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center w-full lg:flex-1 lg:h-screen">
      <GlassCard className="p-8 w-full max-w-sm space-y-5 animate-auth-card">
        <div className="flex flex-col items-center text-center gap-2 lg:hidden">
          <img src={logo} alt="MET" className="w-12 h-12 rounded-2xl object-cover ring-1 ring-hairline" />
        </div>
        <div key={mode} className="animate-auth-mode space-y-5">
        <div className="text-center lg:text-left">
          <h2 className="text-lg font-display font-bold text-ink">{mode === 'signup' ? 'Create your profile' : 'Welcome back'}</h2>
          <p className="text-xs text-ink-muted mt-1">{mode === 'signup' ? 'This is your identity across the whole app.' : 'Sign in to continue.'}</p>
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
              onKeyDown={(e) => { if (e.key === 'Enter' && mode === 'signin') handleSignIn(); }}
            />
            {mode === 'signup' && <PasswordChecklist password={password} />}
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-[11px] text-ink-faint hover:text-accent transition-colors"
              >
                Forgot password?
              </button>
            )}
          </div>
          {mode === 'signup' && (
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Lock size={12} /> Confirm Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSignUp(); }}
              />
              {confirmPassword && (
                <p className={`text-[11px] flex items-center gap-1.5 ${confirmPassword === password ? 'text-success' : 'text-danger'}`}>
                  {confirmPassword === password ? <Check size={11} /> : <X size={11} />}
                  {confirmPassword === password ? 'Passwords match' : "Passwords don't match"}
                </p>
              )}
            </div>
          )}
          {mode === 'signup' && <Captcha onChange={setCaptchaVerified} />}
        </div>

        <Button onClick={mode === 'signup' ? handleSignUp : handleSignIn} disabled={submitting} className="w-full">
          {mode === 'signup' ? <UserPlus size={14} /> : <LogIn size={14} />}
          {submitting ? 'Please wait...' : mode === 'signup' ? 'Create Profile' : 'Sign In'}
        </Button>

        <button
          onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
          className="w-full text-center text-xs text-ink-muted hover:text-accent transition-colors"
        >
          {mode === 'signup' ? 'Already have a profile? Sign in' : "Don't have a profile? Sign up"}
        </button>
        </div>
      </GlassCard>
      </div>
    </div>
  );
}
