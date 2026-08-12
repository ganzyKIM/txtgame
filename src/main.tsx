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

// 서비스워커가 skipWaiting+clientsClaim으로 즉시 교체되긴 하지만, 이미 그려진
// 화면은 옛 번들 그대로 남는다 — 배포 직후 방문하면 옛 UI가 보이고 "강력
// 새로고침"을 해야 했던 원인. 제어권이 새 워커로 넘어가는 순간 한 번만
// 새로고침해서 자동으로 최신 화면이 되게 한다.
// (controller가 없던 최초 설치 때는 이미 최신이므로 새로고침하지 않는다)
// 단, 구글 로그인에서 돌아온 OAuth 콜백(#access_token=... 등)을 처리하는
// 중에 새로고침이 끼어들면 세션 저장이 끊겨 로그인 화면으로 되돌아갈 수
// 있으므로, 콜백 URL로 들어온 로드에서는 자동 새로고침을 건너뛴다.
const isOAuthCallback = /access_token=|error_description=|[?&#]code=/.test(
  window.location.hash + window.location.search,
);
if ('serviceWorker' in navigator && navigator.serviceWorker.controller && !isOAuthCallback) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

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
