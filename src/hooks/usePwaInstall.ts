import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// sessionStorage — 탭/PWA를 닫았다 다시 열면(재접속) 다시 보여야 하므로
// 브라우저 재시작 후에도 남는 localStorage 대신 세션 한정 저장소를 쓴다.
const DISMISS_KEY = 'txtgame_pwa_install_dismissed';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/** 데스크톱은 설치 자체는 가능해도 PWA 설치를 권할 대상이 아님 — 모바일 기기에서만 띄운다. */
function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * PWA 설치 유도 배너용 훅. 모바일 기기에서만 동작(데스크톱은 항상 canShow=false).
 * 안드로이드/크롬: beforeinstallprompt 이벤트를 가로채 원할 때 직접 띄움.
 * iOS Safari: 네이티브 설치 프롬프트 API가 없어 "공유 → 홈 화면에 추가" 안내만 보여줌.
 * 이미 설치됐으면(standalone) 안 뜨고, 유저가 닫으면 이번 세션 동안만 숨겼다가
 * 다음에 새로 접속하면(탭/앱을 새로 열면) 다시 뜬다(sessionStorage).
 */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
  const [installed, setInstalled] = useState(isStandalone());
  const mobile = isMobileDevice();

  useEffect(() => {
    if (!mobile) return;
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [mobile]);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, '1');
  }, []);

  const iosManual = mobile && isIOS() && !installed;
  const canShow = mobile && !installed && !dismissed && (deferredPrompt !== null || iosManual);

  return { canShow, isIOS: iosManual, promptInstall, dismiss };
}
