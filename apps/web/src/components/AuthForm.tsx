import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '../lib/api';
import { Notice } from './States';
import { PAPER_SITES } from '@ccovert/shared';

declare global {
  interface Window { grecaptcha?: { ready?: (callback: () => void) => void; render: (element: HTMLElement, options: Record<string, unknown>) => number } }
}

function Recaptcha({ onToken }: { onToken: (token: string) => void }): JSX.Element | null {
  const siteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined)?.trim();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !container.current) return;
    let rendered = false;
    const render = (): void => {
      if (rendered || !container.current || !window.grecaptcha) return;
      const draw = (): void => {
        if (rendered || !container.current || !window.grecaptcha) return;
        rendered = true;
        window.grecaptcha.render(container.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken('') });
      };
      window.grecaptcha.ready ? window.grecaptcha.ready(draw) : draw();
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-ccovert-recaptcha]');
    if (existing) {
      render();
      const retry = window.setInterval(render, 100);
      window.setTimeout(() => window.clearInterval(retry), 10000);
      return () => window.clearInterval(retry);
    }
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.ccovertRecaptcha = 'true';
    script.onload = render;
    document.head.appendChild(script);
    return () => { script.onload = null; };
  }, [onToken, siteKey]);
  if (!siteKey) return null;
  return <div className="recaptcha-box" aria-label="Verify your human"><div ref={container} /></div>;
}

export function AuthLayout({ title, intro, children, footer }: { title: string; intro: string; children: React.ReactNode; footer: React.ReactNode }): JSX.Element {
  return <div className="auth-page"><div className="auth-orbit" aria-hidden="true"><span /><span /><span /></div><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark" aria-hidden="true">C%</span><span>CCOverT</span></div><h1>{title}</h1><p className="lede">{intro}</p>{children}<div className="auth-footer">{footer}</div></section></div>;
}

export function AuthForm({ mode, onSubmit, onVerifyOtp, pending }: { mode: 'login' | 'signup'; onSubmit: (email: string, password: string, paperSite?: string, captchaToken?: string) => Promise<{ otpRequired?: boolean } | void>; onVerifyOtp?: (email: string, code: string) => Promise<void>; pending: boolean }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [paperSite, setPaperSite] = useState('');
  const [paperSiteOpen, setPaperSiteOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const attemptedOtp = useRef('');
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [checkingOtp, setCheckingOtp] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!email.includes('@')) { setError('Enter a valid email address.'); return; }
    if (mode === 'signup' && password.length < 12) { setError('Use at least 12 characters with uppercase, lowercase, and a number.'); return; }
    if (!captchaToken) { setError('Complete the reCAPTCHA checkbox before continuing.'); return; }
    if (mode === 'signup' && !termsAccepted) { setError('Review and accept the Terms and Conditions before creating an account.'); return; }
    try {
      const result = await onSubmit(email, password, paperSite || undefined, captchaToken || undefined);
      if (mode === 'login' && result?.otpRequired) setAwaitingOtp(true);
    } catch (submitError) { setError(getErrorMessage(submitError)); }
  };
  const verifyCode = async (code: string): Promise<void> => {
    if (!/^\d{6}$/.test(code) || !onVerifyOtp || checkingOtp) return;
    setError('');
    setCheckingOtp(true);
    try { await onVerifyOtp(email, code); } catch (verifyError) { setError(getErrorMessage(verifyError)); } finally { setCheckingOtp(false); }
  };
  const verifyOtp = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setError('Enter the six-digit code sent to your email.'); return; }
    await verifyCode(otp);
  };
  const updateOtp = (index: number, value: string): void => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    if (digits.length > 1) {
      attemptedOtp.current = '';
      const next = otp.padEnd(6, ' ').split('');
      digits.split('').forEach((digit, offset) => { if (index + offset < 6) next[index + offset] = digit; });
      const updated = next.join('').trimEnd();
      setOtp(updated);
      otpRefs.current[Math.min(index + digits.length, 5)]?.focus();
      return;
    }
    const next = otp.padEnd(6, ' ').split('');
    next[index] = digits;
    const updated = next.join('').trimEnd();
    attemptedOtp.current = '';
    setOtp(updated);
    if (digits && index < 5) otpRefs.current[index + 1]?.focus();
  };
  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };
  const handleOtpPaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData('text');
    if (/\d/.test(pasted)) {
      event.preventDefault();
      updateOtp(index, pasted);
    }
  };
  useEffect(() => {
    if (mode === 'login' && awaitingOtp && otp.length === 6 && otp !== attemptedOtp.current) {
      attemptedOtp.current = otp;
      void verifyCode(otp);
    }
  }, [awaitingOtp, mode, otp]);
  if (mode === 'login' && awaitingOtp) return <form className="otp-form" onSubmit={verifyOtp} noValidate>
    <h2>Verify your human</h2>
    {error && <Notice tone="danger" title="Verification failed">{error}</Notice>}
    <div className="otp-boxes" aria-label="Six-digit verification code">
      {Array.from({ length: 6 }, (_, index) => <input key={index} ref={(element) => { otpRefs.current[index] = element; }} aria-label={`Verification digit ${index + 1}`} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={1} value={otp[index] ?? ''} onChange={(event) => updateOtp(index, event.target.value)} onKeyDown={(event) => handleOtpKeyDown(index, event)} onPaste={(event) => handleOtpPaste(index, event)} autoFocus={index === 0} required />)}
    </div>
    <Link className="button button-secondary button-wide" to="/signup">Back to sign up</Link>
  </form>;
  return <form className="stack-form" onSubmit={submit} noValidate>
    {error && <Notice tone="danger" title="Check the form">{error}</Notice>}
    {notice && <Notice tone="success" title="Account created">{notice}</Notice>}
    <label htmlFor="email">Email<input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <label htmlFor="password">Password<span className="password-input-wrap"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 12 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-visibility-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}><span className="material-symbols-rounded" aria-hidden="true">{showPassword ? 'visibility_off' : 'visibility'}</span></button></span></label>
    {mode === 'signup' && <div className="paper-site-field">
      <span>Preferred paper location (context only)</span>
      <input type="hidden" name="paperSite" value={paperSite} required />
      <div className="paper-site-dropdown">
        <button className="paper-site-trigger" id="paperSite" type="button" aria-haspopup="listbox" aria-expanded={paperSiteOpen} onClick={() => setPaperSiteOpen((open) => !open)}>
          <span>{paperSite || 'Select a location'}</span>
          <span className="material-symbols-rounded" aria-hidden="true">expand_more</span>
        </button>
        {paperSiteOpen && <div className="paper-site-options" role="listbox" aria-label="Paper location">
          {PAPER_SITES.map((site) => <button className={`paper-site-option ${paperSite === site ? 'selected' : ''}`} key={site} type="button" role="option" aria-selected={paperSite === site} onClick={() => { setPaperSite(site); setPaperSiteOpen(false); }}>{site}</button>)}
        </div>}
      </div>
    </div>}
    {mode === 'signup' && <p className="form-hint">Use 12 or more characters with uppercase, lowercase, and a number.</p>}
    {mode === 'signup' && <div className="terms-consent">
      <input id="termsAccepted" name="termsAccepted" type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} required />
      <span>I agree to the <button className="inline-link" type="button" onClick={() => setTermsOpen(true)}>Terms and Conditions</button>.</span>
    </div>}
    <Recaptcha onToken={setCaptchaToken} />
    {!captchaToken && <p className="form-hint recaptcha-required">Complete the reCAPTCHA checkbox to enable {mode === 'login' ? 'Log in' : 'Create account'}.</p>}
    <button className="button button-primary button-wide" type="submit" disabled={pending || !captchaToken || (mode === 'signup' && !termsAccepted)}>{pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
    {mode === 'signup' && termsOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTermsOpen(false); }}>
      <section className="dialog terms-dialog" role="dialog" aria-modal="true" aria-labelledby="terms-title">
        <h2 id="terms-title">Terms and Conditions</h2>
        <div className="dialog-body terms-body">
          <p>By creating a CCOverT account, you agree to use this research workspace lawfully and provide accurate account information.</p>
          <p>Your account gives you access to prediction tools and saved results according to your assigned role. Do not attempt to access another user’s data or restricted researcher or developer controls.</p>
          <p>Prediction outputs are generated from the system’s configured research model and should be interpreted with the information shown with each result.</p>
          <p>Account details, prediction history, and reports are retained to operate the workspace, provide traceability, and support research administration. You may request account or data removal through the system administrator, subject to required audit records and applicable policy.</p>
          <p>Uploaded files must be lawful, relevant, and free of malware. CCOverT may reject, restrict, or remove unsafe or unsupported content.</p>
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={() => setTermsOpen(false)}>Close</button>
          <button className="button button-primary" type="button" onClick={() => { setTermsAccepted(true); setTermsOpen(false); }}>I agree</button>
        </div>
      </section>
    </div>}
  </form>;
}

export function AuthLinks({ mode }: { mode: 'login' | 'signup' }): JSX.Element {
  return <p className="auth-switch">{mode === 'login' ? <>New to CCOverT? <Link to="/signup">Create an account</Link></> : <>Already have an account? <a href="/login">Log in</a></>}</p>;
}
