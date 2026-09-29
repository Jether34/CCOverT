import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, PageHeader } from '../components/AppShell';
import { Notice } from '../components/States';
import { useModelStatus } from '../context/AuthContext';
import { api, getErrorMessage } from '../lib/api';

type Role = 'client' | 'researcher' | 'admin';
interface DeveloperStatus {
  database: 'memory' | 'mongodb';
  smtp: { enabled: boolean; configured: boolean; host: string | null; port: number; secure: boolean; user: string | null; from: string | null; source: string };
  providers: { sst: string; tourism: string; ai: string };
  counts: { users: number; datasets: number; modelVersions: number };
  backups: string[];
  backupAvailable: boolean;
  config: { announcement: string; updatedBy: string; updatedAt: string };
  users: Array<{ id: string; email: string; role: Role; emailVerified: boolean; disabledAt: string | null }>;
  activity: Array<{ at: string; kind: 'request' | 'change'; action: string; actorId: string | null; status?: number }>;
}

export function DeveloperPage(): JSX.Element {
  const { status: model } = useModelStatus();
  const [status, setStatus] = useState<DeveloperStatus | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [smtp, setSmtp] = useState({ enabled: false, host: '', port: 587, secure: false, user: '', password: '', from: '' });
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'client' as Role });
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const announcementDirty = useRef(false);
  const smtpDirty = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const refresh = useCallback(() => {
    api.get<DeveloperStatus>('/developer/status')
      .then((result) => {
        setStatus(result);
        if (!announcementDirty.current) setAnnouncement(result.config.announcement);
        if (!smtpDirty.current) setSmtp({ enabled: result.smtp.enabled, host: result.smtp.host ?? '', port: result.smtp.port, secure: result.smtp.secure, user: result.smtp.user ?? '', password: '', from: result.smtp.from ?? '' });
      })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)));
  }, []);
  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setPending(true); setError(''); setMessage('');
    try { await action(); setMessage(success); refresh(); }
    catch (actionError) { setError(getErrorMessage(actionError)); }
    finally { setPending(false); }
  };

  return <AppShell><div className="page-container">
    <PageHeader eyebrow="Developer operations" title="Developer dashboard" description="Live service activity, accounts, shared settings, and database operations." />
    {error && <Notice tone="danger" title="Operation failed">{error}</Notice>}
    {message && <Notice tone="success" title="Saved">{message}</Notice>}
    <div className="dashboard-quadrant">
      <section className="panel dashboard-quadrant-card"><p className="eyebrow">Runtime</p><h2>Service and configuration</h2>
        <dl className="detail-list"><div><dt>Database</dt><dd>{status?.database ?? 'Loading'}</dd></div><div><dt>Model service</dt><dd>{model?.service ?? 'Loading'}</dd></div><div><dt>Equation version</dt><dd>{model?.equationVersion ?? 'Unknown'}</dd></div><div><dt>SMTP</dt><dd>{status?.smtp.configured ? `${status.smtp.host}:${status.smtp.port}` : 'Not configured'}</dd></div><div><dt>Mail sender</dt><dd>{status?.smtp.from ?? 'Not configured'}</dd></div><div><dt>SST provider</dt><dd>{status?.providers.sst ?? 'Loading'}</dd></div><div><dt>Tourism provider</dt><dd>{status?.providers.tourism ?? 'Loading'}</dd></div><div><dt>AI provider</dt><dd>{status?.providers.ai ?? 'Loading'}</dd></div></dl>
        <p className="muted">SMTP secrets and provider credentials are managed on the server. This page shows effective non-secret settings.</p>
      </section>
      <section className="panel dashboard-quadrant-card"><p className="eyebrow">Shared setting</p><h2>System announcement</h2>
        <p className="muted">Saved text appears on every signed-in page for users, researchers, and developers within 15 seconds.</p>
        <label htmlFor="announcement">Announcement<textarea id="announcement" maxLength={300} rows={3} value={announcement} onChange={(event) => { announcementDirty.current = true; setAnnouncement(event.target.value); }} /></label>
        <button className="button button-primary" type="button" disabled={pending} onClick={() => void run(async () => { await api.patch('/developer/config', { announcement }); announcementDirty.current = false; }, 'Announcement updated for all roles.')}>Save announcement</button>
        {status?.config.updatedAt && <p className="small-note muted">Last changed by {status.config.updatedBy} on {new Date(status.config.updatedAt).toLocaleString()}.</p>}
      </section>
      <section className="panel dashboard-quadrant-card"><p className="eyebrow">Data safety</p><h2>Database backups</h2>
        {status?.backupAvailable ? <><button className="button button-primary" type="button" disabled={pending} onClick={() => void run(() => api.post('/developer/backups'), 'Database backup created on the server.')}>Create backup</button><p className="muted">Saved backups:</p>{status.backups.length ? <ul>{status.backups.map((name) => <li key={name}>{name}</li>)}</ul> : <p className="muted">No backups recorded.</p>}</> : <p className="muted">Persistent backups require MongoDB. The current database is in memory and resets when the API stops.</p>}
      </section>
      <section className="panel dashboard-quadrant-card"><p className="eyebrow">Usage</p><h2>System totals</h2><dl className="detail-list"><div><dt>Accounts</dt><dd>{status?.counts.users ?? '—'}</dd></div><div><dt>Datasets</dt><dd>{status?.counts.datasets ?? '—'}</dd></div><div><dt>Model versions</dt><dd>{status?.counts.modelVersions ?? '—'}</dd></div></dl></section>
    </div>
    <section className="panel"><p className="eyebrow">Email delivery</p><h2>SMTP configuration</h2><p className="muted">Credentials are encrypted at rest. Leave the password blank to keep the stored password. Saving changes the mail delivery settings for every role.</p>
      <div className="settings-grid"><label>Host<input value={smtp.host} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, host: event.target.value })); }} /></label><label>Port<input type="number" min="1" max="65535" value={smtp.port} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, port: Number(event.target.value) })); }} /></label><label>Username<input value={smtp.user} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, user: event.target.value })); }} /></label><label>From address<input type="email" value={smtp.from} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, from: event.target.value })); }} /></label><label>Password<span className="password-input-wrap"><input type={showSmtpPassword ? 'text' : 'password'} autoComplete="new-password" value={smtp.password} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, password: event.target.value })); }} /><button className="password-visibility-toggle" type="button" aria-label={showSmtpPassword ? 'Hide SMTP password' : 'Show SMTP password'} title={showSmtpPassword ? 'Hide SMTP password' : 'Show SMTP password'} onClick={() => setShowSmtpPassword((visible) => !visible)}><span className="material-symbols-rounded" aria-hidden="true">{showSmtpPassword ? 'visibility_off' : 'visibility'}</span></button></span></label><label>Transport<select value={smtp.secure ? 'tls' : 'starttls'} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, secure: event.target.value === 'tls' })); }}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label></div>
      <label className="checkbox-field"><input type="checkbox" checked={smtp.enabled} onChange={(event) => { smtpDirty.current = true; setSmtp((current) => ({ ...current, enabled: event.target.checked })); }} />Use these SMTP settings for system email</label>
      <button className="button button-primary" type="button" disabled={pending} onClick={() => void run(async () => { await api.patch('/developer/smtp', smtp); smtpDirty.current = false; setSmtp((current) => ({ ...current, password: '' })); }, 'SMTP configuration saved.')}>Save SMTP</button>
    </section>
    <section className="panel"><p className="eyebrow">Access</p><h2>Accounts</h2><p className="muted">Role changes and disabled access take effect on the next authenticated request. Disabled accounts keep their research and prediction records.</p>
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await api.post('/developer/users', newUser); setNewUser({ email: '', password: '', role: 'client' }); }, 'Account created.'); }}><div className="settings-grid"><label>Email<input type="email" autoComplete="off" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} required /></label><label>Initial password<span className="password-input-wrap"><input type={showNewUserPassword ? 'text' : 'password'} autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} required /><button className="password-visibility-toggle" type="button" aria-label={showNewUserPassword ? 'Hide initial password' : 'Show initial password'} title={showNewUserPassword ? 'Hide initial password' : 'Show initial password'} onClick={() => setShowNewUserPassword((visible) => !visible)}><span className="material-symbols-rounded" aria-hidden="true">{showNewUserPassword ? 'visibility_off' : 'visibility'}</span></button></span></label><label>Role<select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as Role }))}><option value="client">Client</option><option value="researcher">Researcher</option><option value="admin">Developer</option></select></label></div><button className="button button-primary" type="submit" disabled={pending}>Create account</button></form>
      <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Verified</th><th>Access</th><th>Actions</th></tr></thead><tbody>{status?.users.map((user) => <tr key={user.id}><td>{user.email}</td><td>{user.role}</td><td>{user.emailVerified ? 'Yes' : 'No'}</td><td>{user.disabledAt ? 'Disabled' : 'Active'}</td><td><div className="button-row"><select aria-label={`Role for ${user.email}`} defaultValue={user.role} id={`role-${user.id}`}><option value="user">User</option><option value="researcher">Researcher</option><option value="admin">Developer</option></select><button className="button button-small button-secondary" type="button" disabled={pending} onClick={() => { const selected = document.getElementById(`role-${user.id}`) as HTMLSelectElement | null; if (selected) void run(() => api.patch(`/developer/users/${user.id}`, { role: selected.value }), `Updated ${user.email}.`); }}>Save role</button><button className="button button-small button-secondary" type="button" disabled={pending} onClick={() => void run(() => api.patch(`/developer/users/${user.id}`, { disabled: !user.disabledAt }), `${user.disabledAt ? 'Enabled' : 'Disabled'} ${user.email}.`)}>{user.disabledAt ? 'Enable' : 'Disable'}</button></div></td></tr>)}</tbody></table></div></section>
    <section className="panel"><p className="eyebrow">Recent activity</p><h2>Requests and changes</h2><p className="muted">Recent events from this API process; request bodies and credentials are excluded.</p><div className="table-wrap"><table><thead><tr><th>Time</th><th>Type</th><th>Action</th><th>Status</th></tr></thead><tbody>{status?.activity.map((entry, index) => <tr key={`${entry.at}-${index}`}><td>{new Date(entry.at).toLocaleString()}</td><td>{entry.kind}</td><td>{entry.action}</td><td>{entry.status ?? '—'}</td></tr>)}</tbody></table></div></section>
  </div></AppShell>;
}
