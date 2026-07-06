import { usePwaInstall } from '../hooks/usePwaInstall';

/** 로그인 화면·홈 화면에 띄우는 PWA 설치 유도 배너 */
export default function PwaInstallBanner() {
  const { canShow, isIOS, promptInstall, dismiss } = usePwaInstall();
  if (!canShow) return null;

  return (
    <div className="pwa-banner">
      <span className="pwa-banner-icon">📲</span>
      <span className="pwa-banner-text">
        {isIOS
          ? <>홈 화면에 추가하면 앱처럼 편하게 써져! <b>공유</b> 버튼 → <b>홈 화면에 추가</b> ♡</>
          : <>홈 화면에 추가하고 앱처럼 편하게 써봐 ♡</>}
      </span>
      {!isIOS && (
        <button className="btn btn-xs" onClick={() => void promptInstall()}>설치</button>
      )}
      <button className="pwa-banner-close" onClick={dismiss} title="닫기">✕</button>
    </div>
  );
}
