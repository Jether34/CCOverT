import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children, verified = false, roles }: { children: JSX.Element; verified?: boolean; roles?: Array<'client' | 'user' | 'researcher' | 'admin'> }): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-screen" role="status">Loading your workspace…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (verified && !user.emailVerified && (user.role === 'client' || user.role === 'user')) return <Navigate to="/settings" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/home" replace />;
  return children;
}
