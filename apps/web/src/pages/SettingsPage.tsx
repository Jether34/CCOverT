import { useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_VERSION, SOLVER_DEFAULTS } from '@ccovert/shared';
import { useAuth } from '../context/AuthContext';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';

export function SettingsPage(): JSX.Element {
  const { user, logout } = useAuth();
  return (
    <AppShell>
      <div className="page-container narrow-page settings-page">
        <PageHeader eyebrow="Account and preferences" title="Settings" description="Manage your account, appearance, and research-app information." />

        {!user?.emailVerified && (user?.role === 'client' || user?.role === 'user') && (
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
            <div><dt>Paper location preference</dt><dd>{user?.preferences.paperSite ?? 'Not selected'}</dd></div>
            <div><dt>Member since</dt><dd>{user ? new Date(user.createdAt).toLocaleDateString() : '-'}</dd></div>
          </dl>
        </section>

        {user?.role === 'researcher' && <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Workspace configuration</p><h2>Research tools</h2></div></div>
          <p className="muted">The researcher controls one active model configuration. Parameter changes are applied immediately to every client prediction.</p>
          <div className="system-links">
            <Link className="system-link" to="/model">
              <span className="material-symbols-rounded" aria-hidden="true">tune</span>
              <span><strong>Model parameters</strong><small>Edit the single active configuration shared by all clients</small></span>
              <span className="material-symbols-rounded system-link-arrow" aria-hidden="true">chevron_right</span>
            </Link>
          </div>
        </section>}

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">About</p><h2>Study and application</h2></div></div>
          <p>
            CCOverT: A Coral Cover Over Time Model for Predicting Coral Reef Changes in Puerto Princesa City, Palawan.
            All findings and information in this system are based on the research paper of researchers from Palawan National School.
          </p>
          <dl className="detail-list">
            <div><dt>Application version</dt><dd>{APP_VERSION}</dd></div>
            <div><dt>Solver</dt><dd>{SOLVER_DEFAULTS.method.toUpperCase()}, {SOLVER_DEFAULTS.substepsPerYear} substeps per year</dd></div>
          </dl>
          <div className="system-links">
            <Link className="system-link" to="/guide">
              <span className="material-symbols-rounded" aria-hidden="true">help_outline</span>
              <span><strong>Guide and FAQ</strong><small>Learn how to use CCOverT and understand its outputs</small></span>
              <span className="material-symbols-rounded system-link-arrow" aria-hidden="true">chevron_right</span>
            </Link>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="panel-heading"><div><p className="eyebrow">Privacy and retention</p><h2>Data choices</h2></div></div>
          <p>
            Your email, account preferences, prediction history, uploaded documents, and generated reports are used only to
            provide this workspace, preserve result traceability, and support authorized research operations. Your records are
            isolated from other users and are not publicly served. Uploaded files are treated as untrusted data, validated for
            safety, and never executed.
          </p>
          <p>
            Prediction history and reports are retained while your account is active, subject to the system’s configured
            retention policy and required audit records. You may request deletion of eligible account data from the system
            administrator. Deleting an upload removes its stored file; backups and security logs may remain temporarily under
            the configured retention schedule.
          </p>
          <p className="form-hint">Do not upload passwords, payment details, unnecessary personal data, or executable files.</p>
        </section>

        <section className="settings-logout">
          <button className="button button-danger" type="button" onClick={() => void logout()}>Log out</button>
        </section>
      </div>
    </AppShell>
  );
}
