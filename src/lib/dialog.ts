/**
 * 브라우저 기본 alert/confirm 대체 — 디자인 가이드라인에 맞춘 자체 다이얼로그.
 * 별도 권한(Notification 등) 없이 항상 즉시 열리는 인앱 모달.
 *
 * 구독 가능한 미니 스토어 하나만 두고, 어디서든(App.tsx·Window.tsx 등)
 * showAlert/showConfirm을 호출하면 루트에 마운트된 <DialogHost />가 그린다.
 * React context를 쓰지 않는 이유: alert/confirm은 컴포넌트 트리 깊숙한 곳에서도
 * "그냥 함수처럼" 호출할 수 있어야 브라우저 API를 자연스럽게 대체할 수 있다.
 */

export interface AlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true면 확인 버튼을 경고색(btn-warn)으로 표시 */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
}

type DialogState =
  | { kind: 'alert'; opts: Required<AlertOptions>; resolve: () => void }
  | { kind: 'confirm'; opts: Required<ConfirmOptions>; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; opts: Required<PromptOptions>; resolve: (value: string | null) => void }
  | null;

let state: DialogState = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDialogSnapshot(): DialogState {
  return state;
}

export function showAlert(opts: string | AlertOptions): Promise<void> {
  const normalized: Required<AlertOptions> = typeof opts === 'string'
    ? { title: '알림', message: opts, okLabel: '확인' }
    : { title: opts.title ?? '알림', message: opts.message, okLabel: opts.okLabel ?? '확인' };
  return new Promise((resolve) => {
    state = {
      kind: 'alert',
      opts: normalized,
      resolve: () => { state = null; emit(); resolve(); },
    };
    emit();
  });
}

export function showConfirm(opts: string | ConfirmOptions): Promise<boolean> {
  const normalized: Required<ConfirmOptions> = typeof opts === 'string'
    ? { title: '확인', message: opts, confirmLabel: '확인', cancelLabel: '취소', danger: false }
    : {
        title: opts.title ?? '확인',
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? '확인',
        cancelLabel: opts.cancelLabel ?? '취소',
        danger: opts.danger ?? false,
      };
  return new Promise((resolve) => {
    state = {
      kind: 'confirm',
      opts: normalized,
      resolve: (ok: boolean) => { state = null; emit(); resolve(ok); },
    };
    emit();
  });
}

/** 텍스트 입력 다이얼로그. 취소하면 null, 확인하면 trim된 문자열을 반환한다. */
export function showPrompt(opts: PromptOptions): Promise<string | null> {
  const normalized: Required<PromptOptions> = {
    title: opts.title ?? '입력',
    message: opts.message,
    defaultValue: opts.defaultValue ?? '',
    placeholder: opts.placeholder ?? '',
    maxLength: opts.maxLength ?? 200,
    confirmLabel: opts.confirmLabel ?? '확인',
    cancelLabel: opts.cancelLabel ?? '취소',
  };
  return new Promise((resolve) => {
    state = {
      kind: 'prompt',
      opts: normalized,
      resolve: (value: string | null) => { state = null; emit(); resolve(value); },
    };
    emit();
  });
}
