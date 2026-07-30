/* ════════════════════════════════════════════════════════════════════
   오목 AI 탐색 워커

   탐색은 순수 계산인데 동기 실행이라, 메인 스레드에서 돌리면 깊게 파는
   승부처에서 탭이 통째로 얼어버린다(실측: hard 한 수 최악 12초, 그 동안
   리페인트·입력 모두 정지). DOM을 전혀 안 건드리는 코드이므로 워커로
   내보내 UI를 살려둔다 — 생각하는 동안에도 말풍선·스피너가 계속 움직인다.

   전송량을 줄이려고 board 2차원 배열이 아니라 착수 목록만 주고받고,
   워커가 applyMove로 판을 재구성한다.
   ════════════════════════════════════════════════════════════════════ */

import { initGame, applyMove, chooseAiMove, type Difficulty, type Move } from './engine';

export interface AiRequest {
  id: number;
  moves: Move[];
  difficulty: Difficulty;
}

export interface AiResponse {
  id: number;
  move: { r: number; c: number } | null;
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, moves, difficulty } = e.data;

  let state = initGame();
  for (const m of moves) {
    const res = applyMove(state, m.r, m.c);
    if (!res.ok) break;
    state = res.state;
  }

  const move = chooseAiMove(state, difficulty);
  const response: AiResponse = { id, move };
  self.postMessage(response);
};
