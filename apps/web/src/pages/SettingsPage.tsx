import { useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_VERSION, DEMO_PROFILE_LABEL, SOLVER_DEFAULTS } from '@ccovert/shared';
import { authApi, getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';
import { ModelStatusBanner } from '../components/ModelStatusBanner';

export function SettingsPage(): JSX.Element {
  const { user, updatePreferences, logout } = useAuth();
  const [language, setLanguage] = useState(user?.preferences.language ?? 'en');
  const [saved, setSaved] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetPending, setResetPending] = useState(false);

  const save = async (): Promise<void> => {
    await updatePreferences({ ...user?.preferences, language, theme: user?.preferences.theme ?? 'light' });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const requestReset = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setResetError('');
    setResetNotice('');
    setResetPending(true);
    try {
      await authApi.forgotPassword(resetEmail);
      setResetNotice('If that address has an account, a reset link is on its way. The response is identical either way to avoid revealing account existence.');
    } catch (error) {
      setResetError(getErrorMessage(error));
    } finally {
      setResetPending(false);
    }
  };

  return (
    <AppShell>
      <div className="page-container narrow-page">
        <PageHeader eyebrow="Account and preferences" title="Settings" description="Manage your account, appearance, language, and research-app information." />

        {!user?.emailVerified && (
          <Notice tone="warning" title="Email verification pending">
            <p>Use the development verification link from Signup, or read the message from the local mail catcher. History, data import, and AI features stay locked until verification.</p>
          </Notice>
        )}

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Account</p><h2>Account details</h2></div></div>
          <dl className="detail-list">
            <div><dt>Email</dt><dd>{user?.email}</dd></div>
            <div><dt>Verification</dt><dd>{user?.emailVerified ? 'Verified' : 'Pending'}</dd></div>
            <div><dt>Role</dt><dd>{user?.role === 'admin' ? 'Developer' : user?.role ?? 'user'}</dd></div>
            <div><dt>Member since</dt><dd>{user ? new Date(user.createdAt).toLocaleDateString() : '-'}</dd></div>
          </dl>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Preferences</p><h2>Display and language</h2></div></div>
          <div className="settings-grid">
            <label htmlFor="language">
              Language
              <select id="language" value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'fil')}>
                <option value="en">English</option>
                <option value="fil">Filipino</option>
              </select>
            </label>
          </div>
          <button className="button button-primary" type="button" onClick={() => void save()}>Save preferences</button>
          {saved && <span className="success-text" role="status">Preferences saved.</span>}
        </section>

        {user?.role === 'researcher' && <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Workspace configuration</p><h2>Research tools</h2></div></div>
          <p className="muted">Data and model controls are kept here so the primary navigation stays focused on your daily workflow.</p>
          <ModelStatusBanner />
          <div className="system-links">
            <Link className="system-link" to="/data">
              <span className="material-symbols-rounded" aria-hidden="true">database</span>
              <span><strong>Data sources</strong><small>Review imported datasets and provenance</small></span>
              <span className="material-symbols-rounded system-link-arrow" aria-hidden="true">chevron_right</span>
            </Link>
            <Link className="system-link" to="/model">
              <span className="material-symbols-rounded" aria-hidden="true">tune</span>
              <span><strong>Model configuration</strong><small>Inspect profiles, parameters, and solver settings</small></span>
              <span className="material-symbols-rounded system-link-arrow" aria-hidden="true">chevron_right</span>
            </Link>
          </div>
        </section>}

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Password</p><h2>Reset your password</h2></div></div>
          {resetNotice && <Notice tone="success" title="Request received">{resetNotice}</Notice>}
          {resetError && <Notice tone="danger" title="Request failed">{resetError}</Notice>}
          <form className="stack-form" onSubmit={requestReset} noValidate>
            <label htmlFor="reset-email">
              Account email
              <input id="reset-email" type="email" autoComplete="email" value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)} required />
            </label>
            <button className="button button-secondary" type="submit" disabled={resetPending}>
              {resetPending ? 'Sending' : 'Email me a reset link'}
            </button>
          </form>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">About</p><h2>Study and application</h2></div></div>
          <p>
            CCOverT: A Coral Cover Over Time Model for Predicting Coral Reef Changes in Puerto Princesa City, Palawan.
            The research page lists the authors named in the attachment and the sites it references.
          </p>
          <dl className="detail-list">
            <div><dt>Application version</dt><dd>{APP_VERSION}</dd></div>
            <div><dt>Solver</dt><dd>{SOLVER_DEFAULTS.method.toUpperCase()}, {SOLVER_DEFAULTS.substepsPerYear} substeps per year</dd></div>
            <div><dt>Demo profile</dt><dd>{DEMO_PROFILE_LABEL}</dd></div>
          </dl>
          <p><Link className="text-link" to="/">Read the research information and limitations</Link></p>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Privacy and retention</p><h2>Data choices</h2></div></div>
          <p>
            Your email, preferences, owned prediction snapshots, uploaded documents, and generated reports are used to provide
            this workspace. Uploads are validated as untrusted data and are never executed or served publicly. Deleting an
            upload removes the stored file. Configure a server-side retention job with <code>DATA_RETENTION_DAYS</code> before
            production deployment.
          </p>
          <p className="form-hint">Do not upload credentials, personal data, or executable files.</p>
        </section>

        <section className="settings-logout">
          <button className="button button-danger" type="button" onClick={() => void logout()}>Log out</button>
        </section>
      </div>
    </AppShell>
  );
}
