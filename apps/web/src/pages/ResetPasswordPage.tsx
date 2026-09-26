import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi, getErrorMessage } from '../lib/api';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';

export function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setPending(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (resetError) {
      setError(getErrorMessage(resetError));
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell>
      <div className="page-container narrow-page">
        <PageHeader eyebrow="Account" title="Set a new password" description="Password reset links are single-use and expire after 60 minutes." />
        {done && <Notice tone="success" title="Password updated">Sign in with your new password.</Notice>}
        {error && <Notice tone="danger" title="Could not reset the password">{error}</Notice>}
        {!token && <Notice tone="warning" title="No reset token">Open the link from your reset email. If it has expired, request a new one from the login page.</Notice>}
        <form className="stack-form" onSubmit={submit} noValidate>
          <label htmlFor="new-password">
            New password
            <input id="new-password" type="password" autoComplete="new-password" minLength={12}
              value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <label htmlFor="confirm-password">
            Confirm password
            <input id="confirm-password" type="password" autoComplete="new-password"
              value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
          </label>
          <p className="form-hint">Use 12 or more characters with uppercase, lowercase, and a number.</p>
          <button className="button button-primary button-wide" type="submit" disabled={pending || !token}>
            {pending ? 'Updating' : 'Update password'}
          </button>
          <p className="auth-switch"><Link to="/login">Back to log in</Link></p>
        </form>
      </div>
    </AppShell>
  );
}
