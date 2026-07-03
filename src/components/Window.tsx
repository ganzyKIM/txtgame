import { useEffect, useRef, type ReactNode } from 'react';
import { showAlert } from '../lib/dialog';
import OfficeMode from './OfficeMode';

interface Props {
  credits: number | null;
  consoleLines: string[];
  statusText: string;
  onTransform: () => void;
  onLogout: () => void;
  onOpenStats: () => void;
  onMinimize: () => void;
  onClose: () => void;
  /** 제공되면 메뉴바에 "처음으로"(카테고리 선택 복귀) 버튼 노출 */
  onHome?: () => void;
  /** 멀티플레이 진입 버튼 */
  onMultiplay?: () => void;
  /** true면 하단 로그창 숨김 (멀티플레이: 정답 노출 방지) */
  hideConsole?: boolean;
  /** true면 #pane에 멀티플레이 배경 이미지 적용 */
  multiBackground?: boolean;
  /** true면 사회인모드(보스키) — 평범한 문서 화면으로 위장, 게임 상태는 보존 */
  officeMode?: boolean;
  /** 사회인모드 진입 (일반 모드일 때만 버튼 노출) */
  onEnterOffice?: () => void;
  children: ReactNode;
}

export default function Window({
  credits, consoleLines, statusText,
  onTransform, onLogout, onOpenStats, onMinimize, onClose, onHome, onMultiplay, hideConsole, multiBackground,
  officeMode, onEnterOffice, children,
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
          {officeMode ? (
            <span className="title-text">2026년_1분기_실적현황.xlsx - Excel</span>
          ) : (
            <span className="title-text">초텐짱의 편차치99 ✞퀴즈대합전✞ <span className="blink">♥</span></span>
          )}
          <div className="title-btns">
            <button className="tbtn" title="최소화" onClick={onMinimize}>_</button>
            <button className="tbtn tbtn-x" title="닫기" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* 메뉴바 */}
        <div className="menubar">
          <button
            className="mascot-transform"
            onClick={onTransform}
            title={officeMode ? '설정' : '변신!'}
          >
            {officeMode ? '⚙' : '✧ 변신 ✧'}
          </button>
          {!officeMode && onEnterOffice && (
            <button className="menu-btn" onClick={onEnterOffice} title="사회인모드 (업무용 화면으로 전환)">🗂️ 사회인모드</button>
          )}
          {!officeMode && onHome && (
            <button className="menu-btn" onClick={onHome} title="카테고리 선택으로">🏠 처음으로</button>
          )}
          {!officeMode && onMultiplay && (
            <button className="menu-btn" onClick={onMultiplay} title="멀티플레이 대합전">◆ 멀티</button>
          )}
          <span className="menu-spacer" />
          {!officeMode && (
            <>
              <span className="menu-info" style={{cursor:'pointer'}} onClick={() => void showAlert('크레딧 충전은 P에게 요청해야해! kimdh12307@gmail.com')}>크레딧 <b>{credits ?? '—'}</b></span>
              <button className="menu-btn" onClick={onOpenStats} title="나의 전적·랭킹">◆ 전적</button>
            </>
          )}
        </div>

        {/* 본문 */}
        <div id="pane" className={multiBackground ? 'pane-mp-bg' : undefined}>
          {officeMode ? <OfficeMode /> : children}
        </div>

        {/* 인라인 진행 로그 — 멀티플레이·사회인모드 중엔 숨김 (정답/게임 티 방지) */}
        {!hideConsole && !officeMode && (
          <div className="console-strip">
            <pre ref={consoleRef} className="console">{consoleLines.join('\n')}</pre>
          </div>
        )}

        {/* 상태바 — 사회인모드는 OfficeMode 자체 상태줄이 이미 있으므로 중복 노출 방지 위해 숨김 */}
        {!officeMode && (
          <div className="statusbar">
            <span className="statusbar-left">
              <button className="statusbar-logout" onClick={onLogout} title="로그아웃">로그아웃</button>
              <span className="statusbar-status">{statusText}</span>
            </span>
            <span className="statusbar-right">Gemini · Supabase · ✞퀴즈대합전✞</span>
          </div>
        )}
      </div>
    </div>
  );
}
