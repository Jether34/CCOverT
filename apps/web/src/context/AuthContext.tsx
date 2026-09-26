import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, User, UserPreferences } from '@ccovert/shared';
import { authApi, modelApi, preferencesApi } from '../lib/api';
import type { ModelStatus } from '@ccovert/shared';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string) => Promise<AuthResponse>;
  verify: (token: string) => Promise<User>;
  logout: () => Promise<void>;
  updatePreferences: (preferences: UserPreferences) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ModelContextValue {
  status: ModelStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** True when alpha and g (or another required parameter) have no value. */
  blocked: boolean;
  missingKeys: string[];
}

const ModelContext = createContext<ModelContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { status: next } = await modelApi.status();
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    authApi.me().then(({ user: current }) => setUser(current)).catch(() => setUser(null)).finally(() => setLoading(false));
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 15000);
    const onFocus = (): void => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setUser(result.user);
    return result.user;
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const result = await authApi.signup(email, password);
    setUser(result.user);
    return result as AuthResponse;
  }, []);

  const verify = useCallback(async (token: string) => {
    const result = await authApi.verify(token);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const updatePreferences = useCallback(async (preferences: UserPreferences) => {
    const result = await preferencesApi.update(preferences);
    setUser((current) => (current ? { ...current, preferences: result.preferences } : current));
  }, []);

  const authValue = useMemo<AuthContextValue>(
    () => ({ user, loading, login, signup, verify, logout, updatePreferences }),
    [loading, login, logout, signup, updatePreferences, user, verify]
  );

  const modelValue = useMemo<ModelContextValue>(
    () => ({
      status,
      loading: statusLoading,
      refresh,
      blocked: Boolean(status && !status.configured),
      missingKeys: status?.missingParameters.map((parameter) => parameter.key) ?? []
    }),
    [refresh, status, statusLoading]
  );

  return (
    <AuthContext.Provider value={authValue}>
      <ModelContext.Provider value={modelValue}>{children}</ModelContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function useModelStatus(): ModelContextValue {
  const value = useContext(ModelContext);
  if (!value) throw new Error('useModelStatus must be used inside AuthProvider');
  return value;
}
