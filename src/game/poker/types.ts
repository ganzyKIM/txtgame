/* ════════════════════════════════════════════════════════════════════
   텍사스 홀덤 — 카드/족보 기본 타입

   Rank는 2~14(A=14)로 숫자화해 비교/정렬을 쉽게 한다.
   A-2-3-4-5(휠) 스트레이트만 예외적으로 A를 1로 취급 — handRank.ts에서 처리.
   ════════════════════════════════════════════════════════════════════ */

export type Suit = 's' | 'h' | 'd' | 'c'; // spade, heart, diamond, club
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11=J 12=Q 13=K 14=A

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** 족보 등급 — 숫자가 클수록 강함 (비교 시 그대로 대소비교 가능) */
export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8, // 로열플러시 포함 (tiebreaker 14면 로열)
} as const;

export type HandCategory = typeof HAND_CATEGORY[keyof typeof HAND_CATEGORY];

/** 같은 category끼리 비교할 때 쓰는 타이브레이커 — 중요도 순으로 나열, 사전식 비교 */
export interface HandValue {
  category: HandCategory;
  tiebreakers: number[];
  /** 최종 5장 (표시용) */
  cards: Card[];
}
