import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/AuthForm';
import { Notice } from '../components/States';
import { authApi, getErrorMessage } from '../lib/api';

/**
 * Public password-reset request. It must not sit behind the authenticated
 * settings page, because a signed-out visitor who forgot their password cannot
 * reach that page. The response is deliberately identical whether or not the
 * address has an account, so this screen never reveals account existence.
 */
export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setPending(true);
    try {
      await authApi.forgotPassword(email);
      setNotice('If that address has an account, a reset link is on its way. The response is identical either way to avoid revealing account existence.');
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter the email address on your account. If it exists, a single-use reset link is emailed to it."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      <form className="stack-form" onSubmit={submit} noValidate>
        {error && <Notice tone="danger" title="Check the form">{error}</Notice>}
        {notice && <Notice tone="success" title="Request received">{notice}</Notice>}
        <label htmlFor="reset-email">
          Account email
          <input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <button className="button button-primary button-wide" type="submit" disabled={pending}>
          {pending ? 'Sending...' : 'Email me a reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
