import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import {
  BLACK, DIFFICULTIES,
  initGame, applyMove, forbiddenPoints, aiSeatOf, opponentOf,
  type Difficulty, type Forbidden, type GomokuState, type Player, type Situation,
} from '../game/gomoku/engine';
import { requestAiMove, warmUpAiWorker, terminateAiWorker } from '../game/gomoku/aiClient';
import GomokuBoard from './GomokuBoard';
import type { LineKind, MascotHandle } from './Mascot';

/* ════════════════════════════════════════════════════════════════════
   오목 — 싱글플레이 (상대는 현재 마스코트 형태: 초텐쨩 또는 아메)

   포커와 달리 마스코트를 치우지 않는다. 1대1 보드게임이라 마스코트
   자체가 대국 상대이고, 말풍선이 그대로 상대의 대사가 된다 — 변신
   버튼으로 초텐쨩↔아메를 바꾸면 상대와 말투가 함께 바뀐다.
   ════════════════════════════════════════════════════════════════════ */

interface Props {
  mascot: RefObject<MascotHandle | null>;
  push: (line: string) => void;
  onGoMulti: () => void;
}

export interface GomokuGameHandle {
  /** 진행 중인 대국을 접고 난이도 선택 화면으로 */
  goHome: () => void;
}

/** 엔진이 알려주는 상황을 마스코트 대사 종류로 옮긴다 */
const SITUATION_LINE: Record<Situation, LineKind> = {
  intro:         'omok_intro',
  ai_threat:     'omok_ai_threat',
  ai_block:      'omok_ai_block',
  player_threat: 'omok_player_threat',
  player_block:  'omok_player_block',
  calm:          'omok_calm',
  win:           'omok_win',
  lose:          'omok_lose',
  draw:          'omok_draw',
};

/** 별일 없는 수마다 떠들면 시끄러워서, 평범한 수는 이 확률로만 반응한다 */
const CALM_CHATTER_RATE = 0.28;
/** 사람이 이만큼 안 두면 재촉 대사 */
const LONG_THINK_MS = 20000;

const GomokuGame = forwardRef<GomokuGameHandle, Props>(function GomokuGame({ mascot, push, onGoMulti }, ref) {
  const [phase, setPhase] = useState<'intro' | 'playing'>('intro');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [state, setState] = useState<GomokuState>(() => initGame(BLACK));
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 같은 국면에 대해 AI 요청이 두 번 나가지 않게 하는 표식 (착수 수를 토큰으로 씀)
  const aiRequestedAt = useRef(-1);
  // 판마다 흑백을 번갈아 잡는다 — 흑(선공)이 유리하니 한쪽만 계속 잡으면 불공평하다
  const nextHumanSeat = useRef<Player>(BLACK);

  // 첫 수에서 워커 로딩 지연이 보이지 않도록 미리 띄우고, 화면을 벗어나면 정리
  useEffect(() => {
    warmUpAiWorker();
    return () => terminateAiWorker();
  }, []);

  // 오목 화면에서는 마스코트가 상대이므로, 가만히 있을 때 나오는 대사도
  // 퀴즈용("퀴즈 하자")이 아니라 오목용으로 바꿔둔다.
  // 복장도 오목 전용 기모노로 갈아입힌다.
  useEffect(() => {
    const m = mascot.current;
    m?.setIdleKind('omok_longthink');
    m?.setCostume('kimono');
    return () => { m?.setIdleKind(null); m?.setCostume(null); };
  }, [mascot]);

  const fireSituation = useCallback((situation: Situation | undefined) => {
    if (!situation) return;
    if (situation === 'calm' && Math.random() > CALM_CHATTER_RATE) return;
    mascot.current?.event(SITUATION_LINE[situation]);
  }, [mascot]);

  const startGame = useCallback((diff: Difficulty) => {
    const humanSeat = nextHumanSeat.current;
    nextHumanSeat.current = opponentOf(humanSeat); // 다음 판은 색을 바꿔서
    aiRequestedAt.current = -1;
    setDifficulty(diff);
    setState(initGame(humanSeat));
    setThinking(false);
    setError(null);
    setPhase('playing');
    push(
      `> ⚫ 오목 시작! 난이도 ${DIFFICULTIES[diff].label} · ` +
      `나=${humanSeat === BLACK ? '흑(선공)' : '백(후공)'}`,
    );
    mascot.current?.event('omok_intro');
  }, [mascot, push]);

  const goHome = useCallback(() => {
    aiRequestedAt.current = -1;
    setThinking(false);
    setError(null);
    setState(initGame(nextHumanSeat.current));
    setPhase('intro');
  }, []);

  useImperativeHandle(ref, () => ({ goHome }), [goHome]);

  const humanSeat = state.humanSeat;

  // ── AI 차례 자동 진행 ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || state.toAct !== aiSeatOf(state)) return;

    const token = state.moves.length;
    if (aiRequestedAt.current === token) return; // 이 국면은 이미 요청했음
    aiRequestedAt.current = token;

    let cancelled = false;
    setThinking(true);
    const startedAt = Date.now();
    const ponderMs = DIFFICULTIES[difficulty].ponderMs;

    void (async () => {
      const move = await requestAiMove(state, difficulty);
      // 탐색이 즉시 끝나도 최소 사고시간은 채운다 (착 착 놓는 느낌 방지)
      const elapsed = Date.now() - startedAt;
      if (elapsed < ponderMs) {
        await new Promise((r) => window.setTimeout(r, ponderMs - elapsed));
      }
      if (cancelled) return;
      setThinking(false);

      if (!move) { setError('둘 곳을 찾지 못했어… 새 판으로 시작해줘.'); return; }
      const res = applyMove(state, move.r, move.c);
      if (!res.ok) { setError(res.error ?? '착수 실패'); return; }
      setState(res.state);
      fireSituation(res.situation);
    })();

    return () => { cancelled = true; };
  }, [phase, state, difficulty, fireSituation]);

  // ── 사람이 너무 오래 고민하면 재촉 ───────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || state.toAct !== state.humanSeat) return;
    const t = window.setTimeout(() => mascot.current?.event('omok_longthink'), LONG_THINK_MS);
    return () => window.clearTimeout(t);
  }, [phase, state, mascot]);

  // ── 대국 종료 로그 ───────────────────────────────────────────
  useEffect(() => {
    if (state.winner === null) return;
    const msg = state.winner === 'draw' ? '> ⚫ 오목 무승부 (판이 꽉 찼어)'
      : state.winner === state.humanSeat ? '> ⚫ 오목 승리! 내가 이겼어'
      : '> ⚪ 오목 패배… 다음엔 이기자';
    push(msg);
  }, [state.winner, state.humanSeat, push]);

  // ── 금수 자리 — 판에 ✕로 표시해 미리 알려준다 ────────────────
  // 금수는 흑에게만 걸리므로 사람이 흑일 때만 의미가 있다.
  // 전수 계산이 1ms 수준이라 매 착수마다 다시 구해도 부담이 없다.
  const forbidden = useMemo<Map<string, Forbidden>>(() => {
    if (phase !== 'playing' || state.winner !== null) return new Map();
    if (state.humanSeat !== BLACK || state.toAct !== BLACK) return new Map();
    return forbiddenPoints(state.board);
  }, [phase, state]);

  function handleCellClick(r: number, c: number) {
    if (phase !== 'playing' || thinking) return;
    if (state.toAct !== state.humanSeat) return;
    const res = applyMove(state, r, c);
    if (!res.ok) {
      // 금수는 왜 안 되는지 알려준다. 그 외(이미 돌이 있는 칸 등)는 조용히 무시.
      if (res.forbidden) {
        setError(res.error ?? null);
        mascot.current?.event('omok_forbidden');
      }
      return;
    }
    setError(null);
    setState(res.state);
    fireSituation(res.situation);
  }

  // ── 난이도 선택 화면 ─────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="body">
        <div className="soup-intro">
          <div className="soup-intro-card">
            <h2 className="persuade-title">⚫ 오목</h2>
            <p className="soup-lead">
              지금 마스코트가 그대로 상대야. <b>변신 버튼</b>으로 초텐쨩·아메를 바꾸면 상대도 바뀌어♡
            </p>
            <ul className="soup-rules">
              <li>가로·세로·대각선으로 <b>돌 5개를 먼저 이으면</b> 승리야.</li>
              <li>
                흑(●)이 선공이고, <b>판마다 흑백을 번갈아</b> 잡아 —
                이번 판은 <b>{nextHumanSeat.current === BLACK ? '내가 흑(선공)' : '내가 백(후공)'}</b>이야.
              </li>
              <li>
                <b>렌주 룰</b>이야 — 선공이 유리한 만큼 <b>흑에게만 금수</b>가 있어.
                <b>삼삼(3-3)·사사(4-4)·장목(6목 이상)</b>은 둘 수 없어(흑을 잡은 쪽이 나면 판에 ✕로 표시해줄게).
                흑은 정확히 5목이어야 이기고, 백은 제약이 없어.
              </li>
              <li>AI는 정해진 탐색 로직으로만 둬 — 크레딧이 들지 않아.</li>
            </ul>
            <div className="gomoku-diff-pick">
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map((key) => (
                <button
                  key={key}
                  className={`btn gomoku-diff-btn${difficulty === key ? ' is-picked' : ''}`}
                  onClick={() => setDifficulty(key)}
                >
                  <b>{DIFFICULTIES[key].label}</b>
                  <small>{DIFFICULTIES[key].hint}</small>
                </button>
              ))}
            </div>
            <div className="soup-intro-btns">
              {/* "보통로 시작" 같은 조사 오류를 피하려고 '난이도로'를 끼워 넣었다
                  (살살/보통/진심 모두 받침이 달라 '로/으로'가 갈린다) */}
              <button className="btn btn-primary" onClick={() => startGame(difficulty)}>
                ⚫ {DIFFICULTIES[difficulty].label} 난이도로 시작
              </button>
              <button className="btn" onClick={onGoMulti}>👥 멀티로 하기</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 대국 화면 ────────────────────────────────────────────────
  const finished = state.winner !== null;

  const myStone = humanSeat === BLACK ? '●' : '○';
  const statusText = finished
    ? state.winner === 'draw' ? '무승부야'
      : state.winner === humanSeat ? `내가 이겼어! ${myStone}`
      : '져버렸어…'
    : thinking ? '상대가 생각하는 중…'
    : `내 차례 (${humanSeat === BLACK ? '흑' : '백'} ${myStone})`;

  return (
    <div className="body">
      <section className="panel soup-panel gomoku-panel">
        <div className="gomoku-bar">
          <span className="gomoku-status">{statusText}</span>
          <span className="gomoku-meta">
            난이도 <b>{DIFFICULTIES[difficulty].label}</b> · 나 <b>{myStone}</b> · {state.moves.length}수
          </span>
        </div>

        <GomokuBoard
          board={state.board}
          lastMove={state.lastMove}
          winLine={state.winLine}
          forbidden={forbidden}
          locked={thinking || finished || state.toAct !== state.humanSeat}
          onCellClick={handleCellClick}
        />

        {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}

        {finished ? (
          <div className="soup-result">
            <div className="soup-result-head">
              {state.winner === 'draw' ? '⊙ 무승부 — 둘 곳이 없어졌어'
                : state.winner === humanSeat ? '🎉 승리! 5개를 먼저 이었어'
                : '💧 패배… 상대가 5개를 이었어'}
            </div>
            <div className="restart-btns">
              <button className="btn btn-primary" onClick={() => startGame(difficulty)}>▶ 한 판 더</button>
              <button className="btn" onClick={goHome}>↩ 첫화면으로</button>
            </div>
          </div>
        ) : (
          <div className="gomoku-actions">
            <button className="btn btn-xs" onClick={() => startGame(difficulty)}>↻ 새 판</button>
            <button className="btn btn-xs" onClick={goHome}>↩ 첫화면으로</button>
          </div>
        )}
      </section>
    </div>
  );
});

export default GomokuGame;
