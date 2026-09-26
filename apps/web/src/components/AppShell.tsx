import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/home', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/predict', label: 'Predict', icon: 'query_stats' },
  { to: '/history', label: 'History', icon: 'history' },
  { to: '/ai', label: 'Reports', icon: 'auto_awesome' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
];

const linkClass = ({ isActive }: { isActive: boolean }): string => (isActive ? 'nav-link active' : 'nav-link');

export function PublicHeader(): JSX.Element {
  const { user } = useAuth();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="CCOverT home"><span className="brand-mark" aria-hidden="true">~%^</span><span>CCOverT</span></Link>
        <nav className="public-nav" aria-label="Public navigation">
          <Link to="/#research">Research</Link>
          {user ? <Link className="button button-small" to="/home">Open app</Link> : <><Link to="/login">Log in</Link><Link className="button button-small" to="/signup">Create account</Link></>}
        </nav>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { user, updatePreferences } = useAuth();
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const refresh = (): void => {
      fetch('/api/v1/developer/config', { credentials: 'include' })
        .then((response) => response.ok ? response.json() : null)
        .then((body: { config?: { announcement?: string } } | null) => setAnnouncement(body?.config?.announcement ?? ''))
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => window.clearInterval(interval);
  }, []);
  const toggleTheme = (): void => {
    if (user) void updatePreferences({ ...user.preferences, theme: user.preferences.theme === 'dark' ? 'light' : 'dark' });
  };
  return (
    <div className="app-frame">
      <header className="site-header app-header">
        <div className="header-inner">
          <Link className="brand" to="/home"><span className="brand-mark" aria-hidden="true">~%^</span><span>CCOverT</span></Link>
          <div className="header-actions">
            <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${user?.preferences.theme === 'dark' ? 'light' : 'dark'} mode`} title="Toggle theme">
              <span className="material-symbols-rounded" aria-hidden="true">{user?.preferences.theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
            </button>
          </div>
        </div>
      </header>
      {announcement && <div className="system-announcement" role="status">{announcement}</div>}
      <nav className="nav-island" aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} aria-label={item.label}>
            <span className="material-symbols-rounded nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="sr-only">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      {!user?.emailVerified && (
        <div className="verification-banner" role="status">
          Verify your email to unlock saved predictions, data import, and reports. <Link to="/settings">Open settings</Link>
        </div>
      )}
      <main className="app-main">{children}</main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }): JSX.Element {
  return (
    <div className="page-header">
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="lede">{description}</p>}</div>
      {action}
    </div>
  );
}
