import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '../lib/api';
import { Notice } from './States';

export function AuthLayout({ title, intro, children, footer }: { title: string; intro: string; children: React.ReactNode; footer: React.ReactNode }): JSX.Element {
  return <div className="auth-page"><div className="auth-orbit" aria-hidden="true"><span /><span /><span /></div><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark" aria-hidden="true">≈</span><span>CCOverT</span></div><h1>{title}</h1><p className="lede">{intro}</p>{children}<div className="auth-footer">{footer}</div></section></div>;
}

export function AuthForm({ mode, onSubmit, pending }: { mode: 'login' | 'signup'; onSubmit: (email: string, password: string) => Promise<void>; pending: boolean }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!email.includes('@')) { setError('Enter a valid email address.'); return; }
    if (mode === 'signup' && password.length < 12) { setError('Use at least 12 characters with uppercase, lowercase, and a number.'); return; }
    try { await onSubmit(email, password); } catch (submitError) { setError(getErrorMessage(submitError)); }
  };
  return <form className="stack-form" onSubmit={submit} noValidate>
    {error && <Notice tone="danger" title="Check the form">{error}</Notice>}
    {notice && <Notice tone="success" title="Account created">{notice}</Notice>}
    <label htmlFor="email">Email<input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <label htmlFor="password">Password<input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 12 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    {mode === 'signup' && <p className="form-hint">Use 12 or more characters with uppercase, lowercase, and a number.</p>}
    <button className="button button-primary button-wide" type="submit" disabled={pending}>{pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
  </form>;
}

export function AuthLinks({ mode }: { mode: 'login' | 'signup' }): JSX.Element {
  return <p className="auth-switch">{mode === 'login' ? <>New to CCOverT? <Link to="/signup">Create an account</Link></> : <>Already have an account? <Link to="/login">Log in</Link></>}</p>;
}
