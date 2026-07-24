/* ════════════════════════════════════════════════════════════════════
   텍사스 홀덤 — 핸드 진행 상태머신 (베팅 라운드·블라인드·사이드팟)

   순수 함수. applyAction(state, seat, action) → 새 HandState.
   싱글(클라 구동)·멀티(서버 RPC 구동) 어디서든 그대로 재사용한다 —
   이 파일은 "누가 사람이고 누가 봇인지, 싱글인지 멀티인지" 전혀 모른다.

   ── 이 구현이 의도적으로 단순화한 부분 (커버되지 않는 희귀 규칙) ──
   1. 헤즈업(2인) 포스트플랍 첫 액션 순서는 3인+ 규칙과 다른데(BB가 먼저 액션),
      이 파일은 항상 SB부터 시작하는 3인+ 규칙만 구현했다. 지금 싱글은 항상
      3인 고정이라 해당 없음 — 멀티에서 2인까지 줄어드는 경우가 생기면 보완 필요.
   2. 블라인드를 풀로 포스팅 못 할 만큼 짧은 스택으로 핸드를 시작하는 경우는
      다루지 않는다(호출부가 항상 스택 ≥ 빅블라인드일 때만 initHand를 부르도록
      보장해야 함 — buy-in 최소값으로 UI에서 강제).
   3. "숏 올인 레이즈는 재오픈 안 됨" 같은 정식 카지노 규칙 중 일부는 생략하고,
      모든 레이즈(숏 올인 포함)가 액션을 재오픈하는 쪽으로 단순화했다.
      팟 정산(사이드팟)은 이 단순화와 무관하게 정확하다 — 영향받는 건
      "누가 한 번 더 레이즈할 수 있냐"는 희귀 엣지케이스뿐.
   ════════════════════════════════════════════════════════════════════ */

import { cardLabel, createDeck, shuffle } from './deck';
import { compareHandValues, evaluate7 } from './handRank';
import type { Card, HandValue } from './types';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handEnd';

export interface PlayerState {
  id: string;
  stack: number;         // 이번 스트리트에 아직 걸지 않은, 손에 남은 칩
  betThisStreet: number; // 이번 스트리트에 건 칩
  committed: number;     // 이번 핸드 전체에 걸린 총 칩 (사이드팟 계산용)
  holeCards: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
}

export interface WinnerInfo {
  seat: number;
  amount: number;
  /** 쇼다운 없이(전원 폴드로) 이겼으면 undefined */
  handValue?: HandValue;
}

export interface HandState {
  players: PlayerState[]; // 고정 좌석 순서, index = seat
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  deck: Card[];           // 아직 안 돌린 나머지 카드
  board: Card[];
  street: Street;
  toAct: number | null;   // 지금 액션 차례인 좌석 (handEnd면 null)
  currentBet: number;     // 이번 스트리트에서 맞춰야 하는 최고 베팅액
  minRaise: number;       // 다음 레이즈의 최소 증가폭
  pendingToAct: number[]; // 이번 베팅 라운드가 끝나기 전에 액션해야 하는 좌석들
  winners: WinnerInfo[] | null; // handEnd에서만 채워짐
  log: string[];          // 사람이 읽는 액션 로그(한국어) — UI 피드용
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raiseTo'; amount: number } // "bet"과 "raise"를 통합 — 이번 스트리트 베팅액을 amount로 맞춘다
  | { type: 'allin' };

export interface ApplyResult {
  ok: boolean;
  state: HandState;
  error?: string;
}

function clone(state: HandState): HandState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, holeCards: p.holeCards ? [...p.holeCards] as [Card, Card] : null })),
    deck: [...state.deck],
    board: [...state.board],
    pendingToAct: [...state.pendingToAct],
    winners: state.winners ? state.winners.map((w) => ({ ...w })) : null,
    log: [...state.log],
  };
}

function activeSeats(players: PlayerState[]): number[] {
  return players.map((_, i) => i).filter((i) => !players[i].folded);
}

/** 아직 폴드도 올인도 안 해서 "액션할 수 있는" 좌석 (베팅 라운드 진행 판단용) */
function actableSeats(players: PlayerState[]): number[] {
  return players.map((_, i) => i).filter((i) => !players[i].folded && !players[i].allIn);
}

function nextSeatFrom(players: PlayerState[], from: number, predicate: (i: number) => boolean): number | null {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (predicate(idx)) return idx;
  }
  return null;
}

/** 새 핸드 시작 — 셔플·딜·블라인드 포스팅까지 마친 상태를 반환 */
export function initHand(
  playerInputs: { id: string; stack: number }[],
  dealerIndex: number,
  smallBlind: number,
  bigBlind: number,
  rng: () => number = Math.random,
): HandState {
  return initHandWithDeck(playerInputs, dealerIndex, smallBlind, bigBlind, shuffle(createDeck(), rng));
}

/**
 * initHand과 동일하지만 셔플을 직접 하지 않고 미리 정해진 deck을 그대로 사용한다.
 * 멀티플레이 전용 — 서버(RPC)가 미리 셔플해 손패+보드 5장을 통째로 확정해두고,
 * 그 순서를 그대로 여기 먹여서 initHand과 완전히 동일한 딜링 순서를 재현한다
 * (호스트 브라우저에서만 실행 — usePokerMultiHand 참고).
 */
export function initHandWithDeck(
  playerInputs: { id: string; stack: number }[],
  dealerIndex: number,
  smallBlind: number,
  bigBlind: number,
  initialDeck: Card[],
): HandState {
  const n = playerInputs.length;
  if (n < 2) throw new Error('initHand: 최소 2인 필요');
  if (playerInputs.some((p) => p.stack < bigBlind)) {
    throw new Error('initHand: 모든 플레이어의 스택이 빅블라인드 이상이어야 함(짧은 스택은 리바이 후 시작)');
  }

  let deck = initialDeck;
  const players: PlayerState[] = playerInputs.map((p) => ({
    id: p.id, stack: p.stack, betThisStreet: 0, committed: 0, holeCards: null, folded: false, allIn: false,
  }));

  // 딜러 왼쪽부터 한 장씩, 두 바퀴 (진짜 딜러 방식과 동일한 순서 — 결과는 셔플 덕에 어차피 무작위지만
  // 액션 로그·재현성 측면에서 실제 딜링 순서를 흉내낸다)
  const firstCards: Card[] = [];
  const secondCards: Card[] = [];
  for (let step = 1; step <= n; step++) { firstCards.push(deck[0]); deck = deck.slice(1); }
  for (let step = 1; step <= n; step++) { secondCards.push(deck[0]); deck = deck.slice(1); }
  for (let step = 1; step <= n; step++) {
    const seat = (dealerIndex + step) % n;
    players[seat].holeCards = [firstCards[step - 1], secondCards[step - 1]];
  }

  const n2 = n === 2;
  const sbIndex = n2 ? dealerIndex : (dealerIndex + 1) % n;
  const bbIndex = n2 ? (dealerIndex + 1) % n : (dealerIndex + 2) % n;

  function postBlind(seat: number, amount: number) {
    const p = players[seat];
    const pay = Math.min(amount, p.stack);
    p.stack -= pay;
    p.betThisStreet += pay;
    p.committed += pay;
    if (p.stack === 0) p.allIn = true;
  }
  postBlind(sbIndex, smallBlind);
  postBlind(bbIndex, bigBlind);

  const preflopFirstToAct = (bbIndex + 1) % n; // 3인+: 딜러(버튼)부터. 헤즈업도 이 공식으로 우연히 SB=버튼이 먼저 액션(맞음).
  const pendingToAct = actableSeats(players).length > 1
    ? rotateFrom(actableSeats(players), preflopFirstToAct)
    : [];

  return {
    players,
    dealerIndex,
    smallBlind,
    bigBlind,
    deck,
    board: [],
    street: 'preflop',
    toAct: pendingToAct[0] ?? null,
    currentBet: Math.max(players[sbIndex].betThisStreet, players[bbIndex].betThisStreet),
    minRaise: bigBlind,
    pendingToAct,
    winners: null,
    log: [`◆ 새 핸드 시작 (딜러: ${players[dealerIndex].id})`],
  };
}

/** seats를 from이 맨 앞에 오도록(from이 seats에 없으면 from 이후 첫 항목이 맨 앞) 회전 */
function rotateFrom(seats: number[], from: number): number[] {
  const startIdx = seats.findIndex((s) => s >= from);
  const rotated = startIdx === -1 ? seats : [...seats.slice(startIdx), ...seats.slice(0, startIdx)];
  return rotated;
}

function label(p: PlayerState): string { return p.id; }

/** 액션 하나를 적용한다. 불법 액션이면 ok:false와 함께 원본 state를 그대로 반환. */
export function applyAction(state: HandState, seat: number, action: Action): ApplyResult {
  if (state.street === 'handEnd' || state.street === 'showdown') {
    return { ok: false, state, error: '이미 끝난 핸드' };
  }
  if (state.toAct !== seat) {
    return { ok: false, state, error: '지금은 그 좌석의 차례가 아님' };
  }
  const s = clone(state);
  const p = s.players[seat];
  if (p.folded || p.allIn) {
    return { ok: false, state, error: '이미 폴드/올인한 좌석' };
  }

  const owed = s.currentBet - p.betThisStreet;

  switch (action.type) {
    case 'fold': {
      p.folded = true;
      s.log.push(`${label(p)}: 폴드`);
      break;
    }
    case 'check': {
      if (owed !== 0) return { ok: false, state, error: '베팅액을 맞추지 않고 체크할 수 없음' };
      s.log.push(`${label(p)}: 체크`);
      break;
    }
    case 'call': {
      if (owed <= 0) return { ok: false, state, error: '콜할 게 없음(체크 가능)' };
      const pay = Math.min(owed, p.stack);
      p.stack -= pay; p.betThisStreet += pay; p.committed += pay;
      if (p.stack === 0) p.allIn = true;
      s.log.push(`${label(p)}: 콜 (${pay})${p.allIn ? ' — 올인' : ''}`);
      break;
    }
    case 'raiseTo': {
      const amount = action.amount;
      const maxTotal = p.betThisStreet + p.stack;
      if (amount <= s.currentBet) return { ok: false, state, error: '레이즈는 현재 베팅액보다 커야 함' };
      if (amount > maxTotal) return { ok: false, state, error: '스택보다 많이 베팅할 수 없음' };
      const increment = amount - s.currentBet;
      const isAllIn = amount === maxTotal;
      if (!isAllIn && increment < s.minRaise) {
        return { ok: false, state, error: `최소 레이즈 증가폭(${s.minRaise}) 미만` };
      }
      const pay = amount - p.betThisStreet;
      p.stack -= pay; p.betThisStreet = amount; p.committed += pay;
      if (p.stack === 0) p.allIn = true;
      if (increment >= s.minRaise) s.minRaise = increment; // 숏 올인이면 minRaise 유지(§ 상단 주석 2번 관련 단순화와 별개로, 이 값 자체는 정확히 유지)
      s.currentBet = amount;
      // 레이즈는 액션을 재오픈 — 본인 제외 아직 액션 가능한 전원이 다시 대기열에
      s.pendingToAct = actableSeats(s.players).filter((i) => i !== seat);
      s.log.push(`${label(p)}: ${isAllIn ? '올인' : '레이즈'} (총 ${amount})`);
      break;
    }
    case 'allin': {
      const maxTotal = p.betThisStreet + p.stack;
      if (maxTotal <= s.currentBet) {
        // 콜조차 다 못 채우는 숏 올인
        const pay = p.stack;
        p.stack = 0; p.betThisStreet += pay; p.committed += pay; p.allIn = true;
        s.log.push(`${label(p)}: 올인 (${pay}, 콜에 부족)`);
      } else {
        return applyAction(state, seat, { type: 'raiseTo', amount: maxTotal });
      }
      break;
    }
  }

  // 폴드로 어떤 액션이었든, 방금 액션한 좌석은 더 이상 대기열에 없어야 함
  s.pendingToAct = s.pendingToAct.filter((i) => i !== seat);

  // 한 명만 남았으면 즉시 핸드 종료(쇼다운 없이)
  const remaining = activeSeats(s.players);
  if (remaining.length === 1) {
    return { ok: true, state: settleHand(s, false) };
  }

  if (s.pendingToAct.length === 0) {
    return { ok: true, state: advanceStreet(s) };
  }

  s.toAct = s.pendingToAct[0];
  return { ok: true, state: s };
}

/** 베팅 라운드가 끝났을 때: 다음 스트리트로, 혹은 쇼다운으로 */
function advanceStreet(state: HandState): HandState {
  const s = state;
  for (const p of s.players) { p.betThisStreet = 0; }
  s.currentBet = 0;
  s.minRaise = s.bigBlind;

  const canStillBet = actableSeats(s.players).length > 1;

  function dealBoard(count: number) {
    const drawn = s.deck.slice(0, count);
    s.deck = s.deck.slice(count);
    s.board.push(...drawn);
  }

  if (s.street === 'preflop') { dealBoard(3); s.street = 'flop'; s.log.push(`◆ 플랍: ${s.board.map(cardLabel).join(' ')}`); }
  else if (s.street === 'flop') { dealBoard(1); s.street = 'turn'; s.log.push('◆ 턴'); }
  else if (s.street === 'turn') { dealBoard(1); s.street = 'river'; s.log.push('◆ 리버'); }
  else { return settleHand(s, true); } // river 다음 → 쇼다운

  if (!canStillBet) {
    // 더 베팅할 사람이 1명 이하면(나머지는 올인/폴드) 액션 없이 바로 다음 스트리트로 계속 진행
    return advanceStreet(s);
  }

  const firstToAct = nextSeatFrom(s.players, s.dealerIndex, (i) => actableSeats(s.players).includes(i))
    ?? actableSeats(s.players)[0];
  s.pendingToAct = rotateFrom(actableSeats(s.players), firstToAct);
  s.toAct = s.pendingToAct[0] ?? null;
  return s;
}

/** 사이드팟까지 포함한 팟 레이어 계산 — 폴드한 사람의 커밋도 팟엔 남지만 수령 자격은 없다 */
function buildPots(players: PlayerState[]): { amount: number; eligibleSeats: number[] }[] {
  const commits = players.map((p, seat) => ({ seat, committed: p.committed, folded: p.folded }));
  const levels = [...new Set(commits.filter((c) => c.committed > 0).map((c) => c.committed))].sort((a, b) => a - b);
  const pots: { amount: number; eligibleSeats: number[] }[] = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layerSize = level - prevLevel;
    const contributors = commits.filter((c) => c.committed >= level);
    const amount = layerSize * contributors.length;
    if (amount > 0) {
      const eligibleSeats = contributors.filter((c) => !c.folded).map((c) => c.seat);
      pots.push({ amount, eligibleSeats });
    }
    prevLevel = level;
  }
  return pots;
}

/** 핸드를 종료하고 팟을 분배한다. viaShowdown=false면 전원 폴드로 인한 즉시 종료(패 공개 없이 지급) */
function settleHand(state: HandState, viaShowdown: boolean): HandState {
  const s = state;
  s.street = 'handEnd';
  s.toAct = null;
  s.pendingToAct = [];

  const pots = buildPots(s.players);
  const payouts = new Map<number, number>();
  const winnerHandValues = new Map<number, HandValue>();

  for (const pot of pots) {
    if (pot.eligibleSeats.length === 1) {
      payouts.set(pot.eligibleSeats[0], (payouts.get(pot.eligibleSeats[0]) ?? 0) + pot.amount);
      continue;
    }
    if (!viaShowdown) {
      // 이론상 fold-out은 eligibleSeats가 항상 1명이어야 하지만, 방어적으로 첫 좌석에 지급
      payouts.set(pot.eligibleSeats[0], (payouts.get(pot.eligibleSeats[0]) ?? 0) + pot.amount);
      continue;
    }
    let best: HandValue | null = null;
    let bestSeats: number[] = [];
    for (const seat of pot.eligibleSeats) {
      const hc = s.players[seat].holeCards;
      if (!hc) continue;
      const hv = evaluate7([...hc, ...s.board]);
      winnerHandValues.set(seat, hv);
      if (!best || compareHandValues(hv, best) > 0) { best = hv; bestSeats = [seat]; }
      else if (compareHandValues(hv, best) === 0) { bestSeats.push(seat); }
    }
    const share = Math.floor(pot.amount / bestSeats.length);
    let remainder = pot.amount - share * bestSeats.length;
    for (const seat of bestSeats) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      payouts.set(seat, (payouts.get(seat) ?? 0) + share + extra);
    }
  }

  s.winners = [...payouts.entries()].map(([seat, amount]) => ({
    seat, amount, handValue: viaShowdown ? winnerHandValues.get(seat) : undefined,
  }));

  for (const [seat, amount] of payouts) {
    s.players[seat].stack += amount;
  }
  for (const w of s.winners) {
    s.log.push(`◆ ${label(s.players[w.seat])} +${w.amount}${w.handValue ? '' : ' (상대 전원 폴드)'}`);
  }

  return s;
}

/** 다음 핸드를 위한 딜러 버튼 위치 */
export function nextDealer(playerCount: number, currentDealer: number): number {
  return (currentDealer + 1) % playerCount;
}
