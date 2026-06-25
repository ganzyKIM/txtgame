import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  credits: number | null;
  summoned: boolean;
  showTransform: boolean;
  consoleLines: string[];
  statusText: string;
  onSummonToggle: () => void;
  onTransform: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export default function Window({
  credits, summoned, showTransform, consoleLines, statusText,
  onSummonToggle, onTransform, onLogout, children,
}: Props) {
  const [logOpen, setLogOpen] = useState(true);
  const consoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  return (
    <>
      <div className="desktop">
        <div className="window">
          {/* 타이틀바 */}
          <div className="titlebar">
            <span className="title-text">✞추리극장✞ &nbsp;—&nbsp; 편차치 99 초텐짱의 와쿠와쿠 <span className="blink">♥</span></span>
            <div className="title-btns">
              <button className="tbtn" title="최소화">_</button>
              <button className="tbtn" title="최대화">▢</button>
              <button className="tbtn tbtn-x" title="닫기" onClick={onLogout}>✕</button>
            </div>
          </div>

          {/* 메뉴바 */}
          <div className="menubar">
            <button
              className={`mascot-summon ${summoned ? 'is-summoned' : ''}`}
              onClick={onSummonToggle}
            >
              {summoned ? '†승천†' : '†강림†'}
            </button>
            {showTransform && (
              <button className="mascot-transform" onClick={onTransform} title="변신!">✧ 변신 ✧</button>
            )}
            <span className="menu-spacer" />
            <span className="menu-info">크레딧 <b>{credits ?? '—'}</b></span>
            <button
              className={`menu-btn${logOpen ? ' menu-btn-active' : ''}`}
              onClick={() => setLogOpen((o) => !o)}
              title="진행 로그"
            >
              ▌LOG
            </button>
            <button className="menu-btn" onClick={onLogout}>로그아웃</button>
          </div>

          {/* 본문 */}
          <div id="pane">{children}</div>

          {/* 상태바 */}
          <div className="statusbar">
            <span>{statusText}</span>
            <span>Gemini · Supabase · ✞추리극장✞</span>
          </div>
        </div>
      </div>

      {/* 플로팅 진행 로그 창 */}
      <div className={`console-float${logOpen ? '' : ' is-hidden'}`}>
        <div className="console-float-titlebar">
          <span>▌진행 로그 <span className="cursor">▍</span></span>
          <button className="console-float-close" onClick={() => setLogOpen(false)}>✕</button>
        </div>
        <pre ref={consoleRef} className="console">{consoleLines.join('\n')}</pre>
      </div>
    </>
  );
}
