import type { ReactNode } from 'react';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'unavailable';

export function Notice({ tone = 'info', title, children, action }: { tone?: NoticeTone; title: string; children?: ReactNode; action?: ReactNode }): JSX.Element {
  return <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}><div><strong>{title}</strong>{children && <div className="notice-body">{children}</div>}</div>{action && <div className="notice-action">{action}</div>}</div>;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return <div className="state-panel loading-state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }): JSX.Element {
  return <div className="state-panel empty-state"><span className="state-icon" aria-hidden="true">◌</span><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return <div className="state-panel error-state" role="alert"><span className="state-icon" aria-hidden="true">!</span><p>{message}</p>{onRetry && <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>}</div>;
}
