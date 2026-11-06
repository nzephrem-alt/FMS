import { useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, LogIn, UserPlus, Mail, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

const MIN_PASSWORD = 8;

/** Turns Supabase's technical messages into plain ones. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (m.includes('email not confirmed')) return 'Confirm your email first: open the link we sent you, then sign in.';
  if (m.includes('database error saving new user') || m.includes('not approved')) {
    return 'This email is not approved for ISTA FORTIS. Ask the Managing Director to add it, then try again.';
  }
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Sign in instead.';
  if (m.includes('rate limit')) return 'Too many attempts. Wait a few minutes and try again.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Cannot reach the sign-in service. Check your internet connection.';
  if (m.includes('same as the old') || m.includes('different from the old')) return 'Choose a password different from your old one.';
  if (m.includes('expired') || (m.includes('invalid') && m.includes('link'))) return 'This link has expired. Request a new one.';
  return message;
}

/**
 * Sign in, create an account, reset a forgotten password, or set a new one after the reset link.
 * Page styles live here so this page is a single file; everything is scoped under .auth-page.
 */
const AUTH_CSS = `
.auth-page{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#5f6e66;--line:#e3e9e5;--brand:#1a9e6f;--brand-deep:#0f7a53;
  min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);background:#f6f8f6;color:var(--ink);font-family:'Poppins',sans-serif}
.auth-page *{box-sizing:border-box}
.auth-brand{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:48px clamp(28px,5vw,72px);
  background:linear-gradient(150deg,#1a9e6f 0%,#0f7a53 55%,#0b3d2a 100%);color:#fff;
  position:sticky;top:0;height:100vh;height:100dvh;align-self:start}
.auth-brand::before,.auth-brand::after{content:"";position:absolute;border-radius:50%;background:#ffffff12;pointer-events:none}
.auth-brand::before{width:420px;height:420px;right:-140px;top:-120px}
.auth-brand::after{width:260px;height:260px;left:-90px;bottom:-90px}
.auth-logo{position:relative;display:flex;align-items:center;gap:12px}
.auth-logo img{display:block;width:190px;max-width:60vw;height:auto}
.auth-pitch{position:relative;max-width:440px}
.auth-pitch h1{font-size:clamp(26px,2.6vw,36px);line-height:1.2;font-weight:700;margin:0 0 14px;letter-spacing:-.5px}
.auth-pitch p{font-size:15px;line-height:1.6;margin:0;color:#e3f4ec}
.auth-points{position:relative;display:grid;gap:10px;margin:0;padding:0;list-style:none;font-size:14px;color:#e3f4ec}
.auth-points li{display:flex;align-items:center;gap:10px}
.auth-points svg{color:var(--lime);flex-shrink:0}

.auth-main{display:flex;align-items:center;justify-content:center;padding:40px 24px}
.auth-card{width:100%;max-width:420px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:32px;box-shadow:0 10px 40px #1c2b2210}
.auth-card h2{font-size:24px;font-weight:700;margin:0 0 6px;letter-spacing:-.3px}
.auth-card .auth-sub{font-size:14px;color:var(--muted);margin:0 0 22px;line-height:1.5}
.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin-bottom:22px;background:#f1f5f3;border-radius:12px}
.auth-tab{height:38px;border:0;border-radius:9px;background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.auth-tab.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px #1c2b2218}
.auth-form{display:grid;gap:14px}
.auth-field{display:grid;gap:6px;font-size:13px;font-weight:600;color:#3b4a42}
.auth-input{position:relative}
.auth-input input{width:100%;height:46px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font:inherit;font-size:15px;outline:none;transition:border-color .15s,box-shadow .15s}
.auth-input input{font-weight:400}
.auth-input input::placeholder{color:#9aa69f}
.auth-input input:focus{border-color:var(--brand);box-shadow:0 0 0 3px #1a9e6f22}
.auth-input.has-toggle input{padding-right:46px}
.auth-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer}
.auth-eye:hover{background:#f1f5f3;color:var(--ink)}
.auth-hint{font-size:12.5px;font-weight:400;color:var(--muted)}
.auth-row{display:flex;justify-content:flex-end;margin-top:-4px}
.auth-link{border:0;background:none;padding:0;color:var(--brand-deep);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}
.auth-link:hover{text-decoration:underline}
.auth-submit{height:48px;margin-top:4px;border:0;border-radius:12px;background:var(--lime);color:var(--lime-ink);font:inherit;font-size:15px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
.auth-submit:hover:not(:disabled){background:#c8ea52}
.auth-submit:disabled{opacity:.6;cursor:wait}
.auth-msg{padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.5}
.auth-msg.error{background:#fbd6db;color:#8f2d3b}
.auth-msg.ok{background:#bdeed6;color:#1f6b46;display:flex;gap:10px;align-items:flex-start}
.auth-msg.ok svg{flex-shrink:0;margin-top:1px}
.auth-back{display:inline-flex;align-items:center;gap:6px;margin-bottom:18px}
.auth-foot{margin:20px 0 0;text-align:center;font-size:12.5px;color:var(--muted)}
.auth-page button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}

@media(max-width:900px){
  .auth-page{grid-template-columns:1fr}
  .auth-brand{padding:28px 20px 30px;gap:18px;position:relative;height:auto}
  .auth-pitch h1{font-size:24px;margin-bottom:8px}
  .auth-pitch p{font-size:14px}
  .auth-points{display:none}
  .auth-main{align-items:flex-start;padding:24px 16px 40px;margin-top:-18px}
  .auth-card{padding:24px 20px;border-radius:18px}
  .auth-input input{font-size:16px}
}
@media(prefers-reduced-motion:reduce){.auth-input input{transition:none}}
`;

export default function AuthPage({ initialMode = 'signin', onPasswordUpdated }: { initialMode?: AuthMode; onPasswordUpdated?: () => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const switchMode = (next: AuthMode) => {
    setMode(next); setError(''); setSuccess(''); setPassword(''); setConfirm(''); setShowPassword(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(''); setSuccess('');
    if (!supabase) { setError('Sign-in is not set up yet. Add the Supabase keys in Vercel.'); return; }
    const cleanEmail = email.trim().toLowerCase();
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { setError('Enter a valid email address.'); return; }
    if ((mode === 'signup' || mode === 'reset') && password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters for the password.`); return; }
    if ((mode === 'signup' || mode === 'reset') && password !== confirm) { setError('The two passwords do not match.'); return; }
    if (mode === 'signin' && !password) { setError('Enter your password.'); return; }

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (e) throw e;
        // The app switches to the dashboard as soon as the session exists.
      } else if (mode === 'signup') {
        const { data, error: e } = await supabase.auth.signUp({ email: cleanEmail, password, options: { emailRedirectTo: window.location.origin } });
        if (e) throw e;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError('An account with this email already exists. Sign in instead.');
        } else if (!data.session) {
          setSuccess(`Account created. We sent a confirmation link to ${cleanEmail}. Open it, then sign in.`);
          setPassword(''); setConfirm('');
        }
      } else if (mode === 'forgot') {
        const { error: e } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: window.location.origin });
        if (e) throw e;
        setSuccess(`If ${cleanEmail} has an account, a reset link is on its way. Check your inbox.`);
      } else {
        const { error: e } = await supabase.auth.updateUser({ password });
        if (e) throw e;
        setSuccess('Password updated.');
        onPasswordUpdated?.();
      }
    } catch (e) {
      setError(friendly(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const title = { signin: 'Welcome back', signup: 'Create your account', forgot: 'Reset your password', reset: 'Set a new password' }[mode];
  const subtitle = {
    signin: 'Sign in to continue to the financial management system.',
    signup: 'Use your approved company email.',
    forgot: 'Enter your email and we will send you a reset link.',
    reset: 'Choose a new password for your account.',
  }[mode];
  const needsPassword = mode !== 'forgot';
  const needsConfirm = mode === 'signup' || mode === 'reset';
  const submitLabel = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save new password' }[mode];
  const SubmitIcon = { signin: LogIn, signup: UserPlus, forgot: Mail, reset: KeyRound }[mode];

  return (
    <div className="auth-page">
      <style>{AUTH_CSS}</style>

      <aside className="auth-brand">
        <div className="auth-logo">
          <img src="/istafortis-white-logo.png" alt="ISTA FORTIS Group Ltd" />
        </div>
        <div className="auth-pitch">
          <h1>Financial Management System</h1>
          <p>Projects, costs, site labour, invoices and reports in one place.</p>
        </div>
        <ul className="auth-points">
          <li><CheckCircle2 size={18} /> Double-entry ledger behind every figure</li>
          <li><CheckCircle2 size={18} /> Daily site labour sheets and payments</li>
          <li><CheckCircle2 size={18} /> Live reports, balance sheet and cash flow</li>
        </ul>
      </aside>

      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          {mode === 'forgot' && (
            <button type="button" className="auth-link auth-back" onClick={() => switchMode('signin')}><ArrowLeft size={15} /> Back to sign in</button>
          )}
          {(mode === 'signin' || mode === 'signup') && (
            <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
              <button type="button" role="tab" aria-selected={mode === 'signin'} className={`auth-tab${mode === 'signin' ? ' active' : ''}`} onClick={() => switchMode('signin')}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === 'signup'} className={`auth-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => switchMode('signup')}>Create account</button>
            </div>
          )}

          <h2 id="auth-title">{title}</h2>
          <p className="auth-sub">{subtitle}</p>

          <form className="auth-form" onSubmit={submit} noValidate>
            {mode !== 'reset' && (
              <label className="auth-field">Email
                <span className="auth-input"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required /></span>
              </label>
            )}
            {needsPassword && (
              <label className="auth-field">{mode === 'reset' ? 'New password' : 'Password'}
                <span className="auth-input has-toggle">
                  <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" className="auth-eye" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </span>
                {needsConfirm && <span className="auth-hint">At least {MIN_PASSWORD} characters.</span>}
              </label>
            )}
            {needsConfirm && (
              <label className="auth-field">Confirm password
                <span className="auth-input"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></span>
              </label>
            )}
            {mode === 'signin' && (
              <div className="auth-row"><button type="button" className="auth-link" onClick={() => switchMode('forgot')}>Forgot password?</button></div>
            )}

            {error && <p className="auth-msg error" role="alert">{error}</p>}
            {success && <p className="auth-msg ok" role="status"><CheckCircle2 size={17} /><span>{success}</span></p>}

            <button type="submit" className="auth-submit" disabled={busy}><SubmitIcon size={17} /> {busy ? 'Please wait…' : submitLabel}</button>
          </form>

          {mode === 'signup' && <p className="auth-foot">Only emails approved by ISTA FORTIS can create an account.</p>}
        </section>
      </main>
    </div>
  );
}
