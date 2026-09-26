import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthForm, AuthLayout, AuthLinks } from '../components/AuthForm';

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/home';
  const submit = async (email: string, password: string) => { setPending(true); try { await login(email, password); navigate(from); } finally { setPending(false); } };
  return <AuthLayout title="Welcome back" intro="Sign in to access your saved prediction snapshots and research tools." footer={<AuthLinks mode="login" />}>
    <AuthForm mode="login" onSubmit={submit} pending={pending} />
    <p className="auth-switch"><Link to="/forgot-password">Forgot your password?</Link></p>
  </AuthLayout>;
}
