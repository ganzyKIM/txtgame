import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  credits: number | null;
  consoleLines: string[];
  statusText: string;
  onTransform: () => void;
  onLogout: () => void;
  onOpenStats: () => void;
  children: ReactNode;
}

export default function Window({
  credits, consoleLines, statusText,
  onTransform, onLogout, onOpenStats, children,
}: Props) {
  const consoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  return (
    <div className="desktop">
      <div className="window">
        {/* 타이틀바 */}
        <div className="titlebar">
          <span className="title-text">초텐짱의 편차치99 ✞퀴즈대합전✞ <span className="blink">♥</span></span>
          <div className="title-btns">
            <button className="tbtn" title="최소화">_</button>
            <button className="tbtn" title="최대화">▢</button>
            <button className="tbtn tbtn-x" title="닫기" onClick={onLogout}>✕</button>
          </div>
        </div>

        {/* 메뉴바 */}
        <div className="menubar">
          <button className="mascot-transform" onClick={onTransform} title="변신!">✧ 변신 ✧</button>
          <span className="menu-spacer" />
          <span className="menu-info">크레딧 <b>{credits ?? '—'}</b></span>
          <button className="menu-btn" onClick={onOpenStats} title="나의 전적·랭킹">◆ 전적</button>
          <button className="menu-btn" onClick={onLogout}>로그아웃</button>
        </div>

        {/* 본문 */}
        <div id="pane">{children}</div>

        {/* 인라인 진행 로그 */}
        <div className="console-strip">
          <pre ref={consoleRef} className="console">{consoleLines.join('\n')}</pre>
        </div>

        {/* 상태바 */}
        <div className="statusbar">
          <span>{statusText}</span>
          <span>Gemini · Supabase · ✞퀴즈대합전✞</span>
        </div>
      </div>
    </div>
  );
}
