import { useEffect, useRef, useSyncExternalStore } from 'react';
import { subscribeDialog, getDialogSnapshot } from '../lib/dialog';

/** 루트에 1회 마운트 — showAlert/showConfirm 호출 시 이 컴포넌트가 그려준다. */
export default function DialogHost() {
  const state = useSyncExternalStore(subscribeDialog, getDialogSnapshot);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!state) return;
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      if (e.key === 'Escape') {
        if (state.kind === 'alert') state.resolve();
        else state.resolve(false);
      } else if (e.key === 'Enter') {
        if (state.kind === 'alert') state.resolve();
        else state.resolve(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (!state) return null;

  return (
    <div className="modal-overlay" onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      if (state.kind === 'alert') state.resolve();
      else state.resolve(false);
    }}>
      <div className="modal dialog-modal">
        <div className="modal-titlebar">
          <span className="modal-title">◆ {state.opts.title}</span>
        </div>
        <div className="modal-body dialog-body">
          <div className="dialog-message">{state.opts.message}</div>
          <div className="dialog-actions">
            {state.kind === 'confirm' && (
              <button className="btn" onClick={() => state.resolve(false)}>{state.opts.cancelLabel}</button>
            )}
            <button
              ref={confirmBtnRef}
              className={`btn ${state.kind === 'confirm' && state.opts.danger ? 'btn-warn' : 'btn-lav'}`}
              onClick={() => (state.kind === 'alert' ? state.resolve() : state.resolve(true))}
            >
              {state.kind === 'alert' ? state.opts.okLabel : state.opts.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
