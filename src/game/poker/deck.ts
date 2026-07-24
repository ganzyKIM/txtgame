import type { Card, Rank, Suit } from './types';

const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 새 52장 덱 (정렬된 상태 — 셔플은 별도 호출) */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Fisher–Yates. rng는 테스트에서 결정적 셔플을 위해 주입 가능(기본은 Math.random) */
export function shuffle(deck: Card[], rng: () => number = Math.random): Card[] {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const RANK_CHAR: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_CHAR: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** UI 표시용 랭크 문자 — 10은 실전 표기 관례("T")가 아니라 그냥 "10"으로 보여준다 */
export function rankLabel(r: Rank): string {
  return RANK_CHAR[r];
}

/** 디버그/표시용: "As", "Td" 스타일 대신 사람이 읽기 쉬운 "A♠" 형태 */
export function cardLabel(c: Card): string {
  return `${RANK_CHAR[c.rank]}${SUIT_CHAR[c.suit]}`;
}

const RANK_FROM_CHAR: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const SUIT_FROM_CHAR: Record<string, Suit> = { s: 's', h: 'h', d: 'd', c: 'c' };

/** 테스트 픽스처용: "As" → {rank:14, suit:'s'} */
export function parseCard(code: string): Card {
  const rankChar = code.slice(0, -1).toUpperCase();
  const suitChar = code.slice(-1).toLowerCase();
  const rank = RANK_FROM_CHAR[rankChar];
  const suit = SUIT_FROM_CHAR[suitChar];
  if (!rank || !suit) throw new Error(`잘못된 카드 코드: ${code}`);
  return { rank, suit };
}

export function parseCards(codes: string): Card[] {
  return codes.trim().split(/\s+/).map(parseCard);
}
