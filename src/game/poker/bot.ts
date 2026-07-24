/* ════════════════════════════════════════════════════════════════════
   봇 AI — 정해진 로직 (LLM 안 씀)

   1단계: 몬테카를로 승률(equity) 추정 + 성격 파라미터로 fold/call/raise 결정.
   초텐쨩(느슨·블러프 성향) vs 아메(타이트·정직한 베팅)로 캐릭터화해서,
   같은 3인 테이블이라도 상대에 따라 공략법이 달라지게 한다.
   ════════════════════════════════════════════════════════════════════ */

import { createDeck, shuffle } from './deck';
import { compareHandValues, evaluate7 } from './handRank';
import type { Action, HandState } from './engine';

export interface BotPersonality {
  name: string;
  /** 0~1. 높을수록 약한 패로는 잘 안 들어옴(폴드 기준선이 높아짐) */
  tightness: number;
  /** 0~1. 높을수록 베팅 사이즈가 크고 레이즈를 자주 함 */
  aggression: number;
  /** 0~1. 약한 패인데도 레이즈(블러프)할 확률의 상한 */
  bluffFreq: number;
}

export const CHOTEN_PERSONALITY: BotPersonality = { name: '초텐쨩', tightness: 0.35, aggression: 0.65, bluffFreq: 0.25 };
export const AME_PERSONALITY: BotPersonality = { name: '아메', tightness: 0.6, aggression: 0.45, bluffFreq: 0.08 };

/**
 * 몬테카를로 승률 추정 — 남은 카드 풀에서 상대 손패·나머지 보드를 무작위로
 * trials번 뽑아 evaluate7로 승/무/패를 집계한다. 순수 시뮬레이션, LLM 없음.
 */
export function estimateEquity(state: HandState, seat: number, rng: () => number = Math.random, trials = 150): number {
  const me = state.players[seat];
  if (!me.holeCards) return 0.3; // 방어적 기본값(정상 흐름에선 도달 안 함)
  const opponents = state.players.map((_, i) => i).filter((i) => i !== seat && !state.players[i].folded);
  if (opponents.length === 0) return 1;

  const used = new Set([...me.holeCards, ...state.board].map((c) => `${c.rank}${c.suit}`));
  const remainingPool = createDeck().filter((c) => !used.has(`${c.rank}${c.suit}`));

  let wins = 0;
  let ties = 0;
  for (let t = 0; t < trials; t++) {
    const pool = shuffle(remainingPool, rng);
    let idx = 0;
    const oppHoles = opponents.map(() => [pool[idx++], pool[idx++]] as const);
    const boardFill = [];
    for (let i = state.board.length; i < 5; i++) boardFill.push(pool[idx++]);
    const fullBoard = [...state.board, ...boardFill];
    const myVal = evaluate7([...me.holeCards, ...fullBoard]);

    let iWin = true;
    let tie = false;
    for (const oh of oppHoles) {
      const ov = evaluate7([...oh, ...fullBoard]);
      const c = compareHandValues(myVal, ov);
      if (c < 0) { iWin = false; break; }
      if (c === 0) tie = true;
    }
    if (iWin) { if (tie) ties++; else wins++; }
  }
  return (wins + ties * 0.5) / trials;
}

/** 현재 팟 크기 근사치(사이드팟 세부 구분 없이 베팅 사이징 참고용으로만 사용) */
function potEstimate(state: HandState): number {
  return state.players.reduce((sum, p) => sum + p.committed, 0);
}

function computeRaiseAmount(state: HandState, seat: number, personality: BotPersonality, rng: () => number): number | null {
  const p = state.players[seat];
  const maxTotal = p.betThisStreet + p.stack;
  const sizeFactor = 0.4 + personality.aggression * 0.6; // 팟의 40%~100%
  const jitter = 0.85 + rng() * 0.3; // 매번 똑같은 사이즈로만 베팅하지 않도록 약간의 변주
  let target = state.currentBet + Math.max(state.minRaise, Math.round(potEstimate(state) * sizeFactor * jitter));
  target = Math.min(target, maxTotal);
  if (target <= state.currentBet) return null; // 레이즈할 여력이 안 됨 → 콜/체크로 폴백
  // 남은 스택의 대부분을 걸게 되는 상황이면 자잘한 레이즈 대신 깔끔하게 올인
  if (maxTotal - target < p.stack * 0.15) target = maxTotal;
  return target;
}

/**
 * 봇의 한 턴 액션을 결정한다. 순수 함수(rng 주입 가능 → 테스트 결정적).
 * state.toAct === seat이고 그 좌석이 폴드/올인 상태가 아닐 때만 호출할 것
 * (호출 전 검증은 사용부 책임 — engine.applyAction이 어차피 불법 액션을 거부한다).
 */
export function decideBotAction(state: HandState, seat: number, personality: BotPersonality, rng: () => number = Math.random): Action {
  const p = state.players[seat];
  const owed = state.currentBet - p.betThisStreet;
  const equity = estimateEquity(state, seat, rng);

  const foldThreshold = 0.15 + personality.tightness * 0.25; // 대략 0.15~0.4
  const isBluff = owed > 0 && equity < foldThreshold && rng() < personality.bluffFreq;

  if (owed > 0) {
    const pot = potEstimate(state);
    const potOdds = owed / (pot + owed); // 콜에 필요한 최소 승률(팟 오즈)
    if (equity < foldThreshold && !isBluff) {
      // 팟 오즈가 승률보다 후하면(콜이 수학적으로 밑지지 않으면) 그래도 콜
      if (equity >= potOdds) return { type: 'call' };
      return { type: 'fold' };
    }
    if (equity > 0.7 || isBluff) {
      const amount = computeRaiseAmount(state, seat, personality, rng);
      if (amount !== null) return { type: 'raiseTo', amount };
    }
    return { type: 'call' };
  }

  // owed === 0: 체크 또는 선베팅
  if (equity > 0.55 || (rng() < personality.bluffFreq * 0.5)) {
    const amount = computeRaiseAmount(state, seat, personality, rng);
    if (amount !== null) return { type: 'raiseTo', amount };
  }
  return { type: 'check' };
}
