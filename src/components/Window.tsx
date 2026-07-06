import { useEffect, useRef, type ReactNode } from 'react';
import { showAlert } from '../lib/dialog';

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
  /**
   * true면 사회인모드(보스키) — 실제 화면(children)은 그대로 유지하되
   * 배경화면·마스코트·귀여운 배색을 전부 업무용 톤으로 갈아입힌다.
   * 별도 위장 화면으로 바꿔치기하지 않는다 — 모든 기능을 그대로 쓸 수 있어야 한다.
   */
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
        {/* 타이틀바 — 사회인모드는 위장 문구만 (게임 정체를 드러내는 유일한 텍스트라 계속 가림) */}
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

        {/* 메뉴바 — 사회인모드에서도 기능은 그대로, 색만 업무 톤으로 바뀜.
            처음으로는 맨 왼쪽, 변신·사회인 버튼은 중앙에 고정.
            모바일에서는 아이콘을 숨기고 긴 라벨은 짧은 라벨로 바꿔 한 줄에 다 들어가게 함 */}
        <div className="menubar">
          {onHome && (
            <button className="menu-btn" onClick={onHome} title="카테고리 선택으로">
              <span className="menu-icon">🏠</span> 처음으로
            </button>
          )}
          <div className="menu-center">
            <button
              className="mascot-transform"
              onClick={onTransform}
              title={officeMode ? '원래대로' : '변신!'}
            >
              {officeMode ? '⚙' : <><span className="menu-icon">✧</span> 변신 <span className="menu-icon">✧</span></>}
            </button>
            {!officeMode && onEnterOffice && (
              <button className="menu-btn" onClick={onEnterOffice} title="사회인모드 (업무용 배색으로 전환)">
                <span className="menu-icon">🗂️</span>
                <span className="menu-label-full">사회인모드</span>
                <span className="menu-label-short">사회인</span>
              </button>
            )}
          </div>
          {onMultiplay && (
            <button className="menu-btn" onClick={onMultiplay} title="멀티플레이 대합전">
              <span className="menu-icon">◆</span> 멀티
            </button>
          )}
          <span className="menu-spacer" />
          <span className="menu-info" style={{cursor:'pointer'}} onClick={() => void showAlert('크레딧 충전은 P에게 요청해야해! kimdh12307@gmail.com')}>크레딧 <b>{credits ?? '—'}</b></span>
          <button className="menu-btn" onClick={onOpenStats} title="나의 전적·랭킹">
            <span className="menu-icon">◆</span> 전적
          </button>
        </div>

        {/* 본문 — 사회인모드여도 실제 화면 그대로, 색만 CSS로 갈아입음 */}
        <div id="pane" className={multiBackground ? 'pane-mp-bg' : undefined}>{children}</div>

        {/* 인라인 진행 로그 — 멀티플레이·사회인모드 중엔 숨김 (정답/게임 티 방지) */}
        {!hideConsole && !officeMode && (
          <div className="console-strip">
            <pre ref={consoleRef} className="console">{consoleLines.join('\n')}</pre>
          </div>
        )}

        {/* 상태바 — 사회인모드는 위장 문구, 로그아웃은 계속 사용 가능 */}
        <div className="statusbar">
          <span className="statusbar-left">
            <button className="statusbar-logout" onClick={onLogout} title="로그아웃">로그아웃</button>
            <span className="statusbar-status">{officeMode ? '자동 저장됨' : statusText}</span>
          </span>
          <span className="statusbar-right">{officeMode ? '100%' : 'Gemini · Supabase · ✞퀴즈대합전✞'}</span>
        </div>
      </div>
    </div>
  );
}
