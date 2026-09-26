import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthForm, AuthLayout, AuthLinks } from '../components/AuthForm';
import { Notice } from '../components/States';

function verificationPath(value: string): string {
  const url = new URL(value, window.location.origin);
  return `${url.pathname}${url.search}`;
}

export function SignupPage(): JSX.Element {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState('');
  const submit = async (email: string, password: string) => {
    setPending(true);
    try {
      const result = await signup(email, password);
      if (result.developmentVerificationUrl) {
        setVerificationUrl(result.developmentVerificationUrl);
      } else {
        navigate('/settings');
      }
    } finally { setPending(false); }
  };
  return <AuthLayout title="Create your research account" intro="Save successful prediction snapshots, review your history, and use authorized AI interpretation." footer={<AuthLinks mode="signup" />}>
    {verificationUrl ? <Notice tone="success" title="Development verification link"><p>Open this one-time link to verify the local account.</p><Link className="button button-secondary" to={verificationPath(verificationUrl)}>Verify development account</Link></Notice> : <AuthForm mode="signup" onSubmit={submit} pending={pending} />}
  </AuthLayout>;
}
