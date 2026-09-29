import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { IndexPage } from './pages/IndexPage';
import { SignupPage } from './pages/SignupPage';
import { LoginPage } from './pages/LoginPage';
import { VerifyPage } from './pages/VerifyPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { PredictPage } from './pages/PredictPage';
import { AiPage } from './pages/AiPage';
import { SettingsPage } from './pages/SettingsPage';
import { HistoryPage } from './pages/HistoryPage';
import { ModelPage } from './pages/ModelPage';
import { ResearcherPage } from './pages/ResearcherPage';
import { DeveloperPage } from './pages/DeveloperPage';
import { GuidePage } from './pages/GuidePage';

function ThemeEffect(): null {
  const { user } = useAuth();
  useEffect(() => {
    const theme = user?.preferences.theme ?? 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = user?.preferences.language ?? 'en';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f4f7fb');
  }, [user]);
  return null;
}

function ProtectedPage({ children, verified = false }: { children: JSX.Element; verified?: boolean }): JSX.Element {
  return <ProtectedRoute verified={verified}>{children}</ProtectedRoute>;
}

function RoleHomePage(): JSX.Element {
  const { user } = useAuth();
  if (user?.role === 'admin') return <DeveloperPage />;
  if (user?.role === 'researcher') return <ResearcherPage />;
  return <HomePage />;
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeEffect />
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/home" element={<ProtectedPage><RoleHomePage /></ProtectedPage>} />
          <Route path="/predict" element={<ProtectedPage verified><PredictPage /></ProtectedPage>} />
          <Route path="/history" element={<ProtectedPage verified><HistoryPage /></ProtectedPage>} />
          <Route path="/model" element={<ProtectedRoute roles={['researcher']} verified><ModelPage /></ProtectedRoute>} />
          <Route path="/researcher" element={<ProtectedRoute roles={['researcher']} verified><ResearcherPage /></ProtectedRoute>} />
          <Route path="/developer" element={<ProtectedRoute roles={['admin']}><DeveloperPage /></ProtectedRoute>} />
          <Route path="/ai" element={<ProtectedPage verified><AiPage /></ProtectedPage>} />
          <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />
          <Route path="/guide" element={<ProtectedPage><GuidePage /></ProtectedPage>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
