/* ════════════════════════════════════════════════════════════════════
   AI 착수 요청 — 워커가 있으면 워커로, 없으면 메인 스레드로 폴백

   워커 생성이 실패하는 환경(구형 브라우저, 특정 CSP)에서도 게임이 아예
   못 돌아가면 안 되므로, 실패 시 조용히 동기 실행으로 떨어진다. 그 경우
   깊게 파는 수에서 잠깐 멈출 수 있지만 플레이 자체는 가능하다.
   ════════════════════════════════════════════════════════════════════ */

import { chooseAiMove, type Difficulty, type GomokuState } from './engine';
import type { AiRequest, AiResponse } from './aiWorker';

type Resolver = (move: { r: number; c: number } | null) => void;

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Resolver>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AiResponse>) => {
      const { id, move } = e.data;
      const resolve = pending.get(id);
      if (resolve) { pending.delete(id); resolve(move); }
    };
    worker.onerror = () => {
      // 남아있는 요청을 버려두면 UI가 영원히 "생각 중"에 갇힌다 → 폴백으로 즉시 해소
      workerBroken = true;
      worker = null;
      for (const [, resolve] of pending) resolve(undefined as unknown as null);
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/** 미리 띄워두면 첫 수에서 워커 로딩 지연이 안 보인다 */
export function warmUpAiWorker(): void {
  getWorker();
}

export function terminateAiWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}

/**
 * AI의 다음 수를 구한다. 워커 경로에서는 UI가 멈추지 않는다.
 * 폴백(동기) 경로에서도 같은 Promise 인터페이스를 유지한다.
 */
export function requestAiMove(
  state: GomokuState,
  difficulty: Difficulty,
): Promise<{ r: number; c: number } | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(chooseAiMove(state, difficulty));

  const id = ++seq;
  const request: AiRequest = { id, moves: state.moves, difficulty, humanSeat: state.humanSeat };
  return new Promise((resolve) => {
    pending.set(id, (move) => {
      // 워커가 죽어서 undefined로 깨어난 경우 동기 계산으로 만회
      resolve(move === undefined ? chooseAiMove(state, difficulty) : move);
    });
    w.postMessage(request);
  });
}
