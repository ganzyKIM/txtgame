import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Mac 감지: 렌더 전에 동기 실행해서 FOUC 방지
if (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)) {
  document.documentElement.classList.add('is-mac');
}
import { AuthProvider } from './auth/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
