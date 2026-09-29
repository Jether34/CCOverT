import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthForm, AuthLayout, AuthLinks } from '../components/AuthForm';
import { Notice } from '../components/States';

export function LoginPage(): JSX.Element {
  const { login, verifyLoginOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/home';
  const signupMessage = (location.state as { message?: string } | null)?.message;
  const submit = async (email: string, password: string, _paperSite?: string, captchaToken?: string) => { setPending(true); try { const result = await login(email, password, captchaToken); if (!result.otpRequired) navigate(from); return result; } finally { setPending(false); } };
  const verifyOtp = async (email: string, code: string) => { setPending(true); try { await verifyLoginOtp(email, code); navigate(from); } finally { setPending(false); } };
  return <AuthLayout title="Welcome back" intro="Sign in to access your saved prediction snapshots and research tools." footer={<AuthLinks mode="login" />}>
    {signupMessage && <Notice tone="success" title="Account created">{signupMessage}</Notice>}
    <AuthForm mode="login" onSubmit={submit} onVerifyOtp={verifyOtp} pending={pending} />
    <p className="auth-switch"><Link to="/forgot-password">Forgot your password?</Link></p>
  </AuthLayout>;
}
