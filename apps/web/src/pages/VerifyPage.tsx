import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../lib/api';
import { Notice } from '../components/States';

export function VerifyPage(): JSX.Element {
  const [params] = useSearchParams();
  const { verify } = useAuth();
  const token = params.get('token');
  const [state, setState] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const attemptedToken = useRef<string | null>(null);
  useEffect(() => {
    if (!token) { setState('error'); setMessage('This verification link is missing its token.'); return; }
    if (attemptedToken.current === token) return;
    attemptedToken.current = token;
    window.history.replaceState({}, document.title, window.location.pathname);
    setState('working');
    verify(token).then(() => { setState('success'); setMessage('Your email is verified. Saved prediction and AI features are now available.'); }).catch((error) => { setState('error'); setMessage(getErrorMessage(error)); });
  }, [token, verify]);
  return <div className="auth-page"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark" aria-hidden="true">≈</span><span>CCOverT</span></div><h1>Email verification</h1>{state === 'working' && <Notice tone="info" title="Verifying your account">Please wait…</Notice>}{state === 'success' && <Notice tone="success" title="Account verified">{message}</Notice>}{state === 'error' && <Notice tone="danger" title="Verification failed">{message}</Notice>}<Link className="button button-primary button-wide" to="/home">Continue to workspace</Link></section></div>;
}
