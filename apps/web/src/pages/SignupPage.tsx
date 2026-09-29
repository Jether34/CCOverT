import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthForm, AuthLayout, AuthLinks } from '../components/AuthForm';

export function SignupPage(): JSX.Element {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const submit = async (email: string, password: string, paperSite?: string, captchaToken?: string) => {
    setPending(true);
    try {
      const result = await signup(email, password, paperSite, captchaToken);
      void result;
      navigate('/login', { state: { message: 'Your account was created. Check your email if verification is required, then enter your password to receive a login code.' } });
    } finally { setPending(false); }
  };
  return <AuthLayout title="Create your research account" intro="Save successful prediction snapshots, review your history, and use authorized AI interpretation." footer={<AuthLinks mode="signup" />}>
    <AuthForm mode="signup" onSubmit={submit} pending={pending} />
  </AuthLayout>;
}
