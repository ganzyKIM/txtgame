import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeDialog, getDialogSnapshot } from '../lib/dialog';

/** 루트에 1회 마운트 — showAlert/showConfirm/showPrompt 호출 시 이 컴포넌트가 그려준다. */
export default function DialogHost() {
  const state = useSyncExternalStore(subscribeDialog, getDialogSnapshot);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    if (!state) return;
    if (state.kind === 'prompt') {
      setPromptValue(state.opts.defaultValue);
      // 렌더 이후 포커스해야 select()가 먹는다
      requestAnimationFrame(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.select();
      });
    } else {
      confirmBtnRef.current?.focus();
    }
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      if (e.key === 'Escape') {
        if (state.kind === 'alert') state.resolve();
        else if (state.kind === 'confirm') state.resolve(false);
        else state.resolve(null);
      } else if (e.key === 'Enter') {
        // prompt는 입력창 자체의 onKeyDown이 처리한다(한글 조합 중 Enter 무시 등을 위해)
        if (state.kind === 'prompt') return;
        if (state.kind === 'alert') state.resolve();
        else state.resolve(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (!state) return null;

  function submitPrompt() {
    if (state?.kind !== 'prompt') return;
    const trimmed = promptValue.trim();
    if (!trimmed) return;
    state.resolve(trimmed);
  }

  return (
    <div className="modal-overlay" onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      if (state.kind === 'alert') state.resolve();
      else if (state.kind === 'confirm') state.resolve(false);
      else state.resolve(null);
    }}>
      <div className="modal dialog-modal">
        <div className="modal-titlebar">
          <span className="modal-title">◆ {state.opts.title}</span>
        </div>
        <div className="modal-body dialog-body">
          <div className="dialog-message">{state.opts.message}</div>

          {state.kind === 'prompt' && (
            <div>
              <input
                ref={promptInputRef}
                className="text-input dialog-prompt-input"
                value={promptValue}
                maxLength={state.opts.maxLength}
                placeholder={state.opts.placeholder}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitPrompt();
                }}
              />
              <div className="dialog-prompt-counter">{promptValue.length}/{state.opts.maxLength}자</div>
            </div>
          )}

          <div className="dialog-actions">
            {(state.kind === 'confirm' || state.kind === 'prompt') && (
              <button
                className="btn"
                onClick={() => (state.kind === 'confirm' ? state.resolve(false) : state.resolve(null))}
              >
                {state.opts.cancelLabel}
              </button>
            )}
            {state.kind === 'prompt' ? (
              <button
                className="btn btn-lav"
                onClick={submitPrompt}
                disabled={!promptValue.trim()}
              >
                {state.opts.confirmLabel}
              </button>
            ) : (
              <button
                ref={confirmBtnRef}
                className={`btn ${state.kind === 'confirm' && state.opts.danger ? 'btn-warn' : 'btn-lav'}`}
                onClick={() => (state.kind === 'alert' ? state.resolve() : state.resolve(true))}
              >
                {state.kind === 'alert' ? state.opts.okLabel : state.opts.confirmLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
