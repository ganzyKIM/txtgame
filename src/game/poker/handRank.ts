/* ════════════════════════════════════════════════════════════════════
   7장 중 최고 5장 족보 평가 — 텍사스 홀덤의 핵심 판정 로직

   순수 함수. 싱글(클라이언트)·멀티(서버 RPC)·봇 시뮬레이션·테스트
   어디서든 그대로 재사용한다.
   ════════════════════════════════════════════════════════════════════ */

import { HAND_CATEGORY, type Card, type HandCategory, type HandValue } from './types';

export const HAND_CATEGORY_LABEL: Record<HandCategory, string> = {
  [HAND_CATEGORY.HIGH_CARD]: '하이카드',
  [HAND_CATEGORY.ONE_PAIR]: '원페어',
  [HAND_CATEGORY.TWO_PAIR]: '투페어',
  [HAND_CATEGORY.THREE_KIND]: '트리플',
  [HAND_CATEGORY.STRAIGHT]: '스트레이트',
  [HAND_CATEGORY.FLUSH]: '플러시',
  [HAND_CATEGORY.FULL_HOUSE]: '풀하우스',
  [HAND_CATEGORY.FOUR_KIND]: '포카드',
  [HAND_CATEGORY.STRAIGHT_FLUSH]: '스트레이트 플러시',
};

/** 유니크 랭크(내림차순 5개)가 스트레이트를 이루면 최고 랭크를, 아니면 null.
 *  A-2-3-4-5(휠)는 예외적으로 5-high 스트레이트로 취급한다. */
function straightHighOf(uniqueRanksDesc: number[]): number | null {
  if (uniqueRanksDesc.length !== 5) return null;
  const r = uniqueRanksDesc;
  let consecutive = true;
  for (let i = 0; i < 4; i++) {
    if (r[i] - r[i + 1] !== 1) { consecutive = false; break; }
  }
  if (consecutive) return r[0];
  if (r[0] === 14 && r[1] === 5 && r[2] === 4 && r[3] === 3 && r[4] === 2) return 5; // 휠
  return null;
}

/** 정확히 5장의 족보를 평가한다 */
export function evaluate5(cards: Card[]): HandValue {
  if (cards.length !== 5) throw new Error('evaluate5: 정확히 5장이어야 함');

  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const uniqueRanksDesc = [...new Set(ranksDesc)];
  const straightHigh = straightHighOf(uniqueRanksDesc);

  if (isFlush && straightHigh !== null) {
    return { category: HAND_CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightHigh], cards };
  }

  const countMap = new Map<number, number>();
  for (const r of ranksDesc) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  // count 내림차순, 동률이면 rank 내림차순 — 이 순서가 곧 킥커 우선순위
  const groups = [...countMap.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const counts = groups.map((g) => g[1]);

  if (counts[0] === 4) {
    return { category: HAND_CATEGORY.FOUR_KIND, tiebreakers: [groups[0][0], groups[1][0]], cards };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    return { category: HAND_CATEGORY.FULL_HOUSE, tiebreakers: [groups[0][0], groups[1][0]], cards };
  }
  if (isFlush) {
    return { category: HAND_CATEGORY.FLUSH, tiebreakers: ranksDesc, cards };
  }
  if (straightHigh !== null) {
    return { category: HAND_CATEGORY.STRAIGHT, tiebreakers: [straightHigh], cards };
  }
  if (counts[0] === 3) {
    return { category: HAND_CATEGORY.THREE_KIND, tiebreakers: groups.map((g) => g[0]), cards };
  }
  if (counts[0] === 2 && counts[1] === 2) {
    return { category: HAND_CATEGORY.TWO_PAIR, tiebreakers: groups.map((g) => g[0]), cards };
  }
  if (counts[0] === 2) {
    return { category: HAND_CATEGORY.ONE_PAIR, tiebreakers: groups.map((g) => g[0]), cards };
  }
  return { category: HAND_CATEGORY.HIGH_CARD, tiebreakers: ranksDesc, cards };
}

/** a>b면 양수, a<b면 음수, 동점이면 0 */
export function compareHandValues(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function combinations5(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++)
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return result;
}

/** 5~7장 중 최고의 5장 조합을 찾는다 (홀덤: 손패2 + 보드5) */
export function evaluate7(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('evaluate7: 최소 5장 필요');
  if (cards.length === 5) return evaluate5(cards);
  let best: HandValue | null = null;
  for (const combo of combinations5(cards)) {
    const v = evaluate5(combo);
    if (!best || compareHandValues(v, best) > 0) best = v;
  }
  return best as HandValue;
}
