/* ════════════════════════════════════════════════════════════════════
   끝말잇기 규칙 엔진 — 한글 분해 / 두음법칙 / 검증 / AI 단어 선택
   ════════════════════════════════════════════════════════════════════ */

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const MEDIAL_COUNT = 21;
const FINAL_COUNT = 28;

/** 초성: 0 ㄱ … 5 ㄹ … 11 ㅇ … */
// medial 인덱스 참고:
//  0 ㅏ 1 ㅐ 2 ㅑ 3 ㅒ 4 ㅓ 5 ㅔ 6 ㅕ 7 ㅖ 8 ㅗ 9 ㅘ 10 ㅙ 11 ㅚ
// 12 ㅛ 13 ㅜ 14 ㅝ 15 ㅞ 16 ㅟ 17 ㅠ 18 ㅡ 19 ㅢ 20 ㅣ

const INITIAL_R = 5; // ㄹ
const INITIAL_N = 2; // ㄴ
const INITIAL_O = 11; // ㅇ

/** ㄹ/ㄴ → ㅇ 으로 바뀌는 모음(구개음·이 계열) */
const TO_IEUNG_MEDIALS = new Set([2, 3, 6, 7, 12, 17, 20]); // ㅑㅒㅕㅖㅛㅠㅣ

export function isHangulSyllable(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= HANGUL_BASE && c <= HANGUL_END;
}

interface Jamo { initial: number; medial: number; final: number; }

function decompose(ch: string): Jamo {
  const c = ch.charCodeAt(0) - HANGUL_BASE;
  return {
    initial: Math.floor(c / (MEDIAL_COUNT * FINAL_COUNT)),
    medial: Math.floor((c % (MEDIAL_COUNT * FINAL_COUNT)) / FINAL_COUNT),
    final: c % FINAL_COUNT,
  };
}

function compose(initial: number, medial: number, final: number): string {
  return String.fromCharCode(HANGUL_BASE + (initial * MEDIAL_COUNT + medial) * FINAL_COUNT + final);
}

/**
 * 주어진 음절(이전 단어의 마지막 글자)에 대해, 다음 단어가 시작할 수 있는
 * 허용 음절 집합을 반환한다. 두음법칙으로 변형 가능한 경우 둘 다 인정.
 */
export function allowedStarts(syllable: string): string[] {
  if (!isHangulSyllable(syllable)) return [syllable];
  const { initial, medial, final } = decompose(syllable);
  const out = new Set<string>([syllable]);

  if (initial === INITIAL_R) {
    // ㄹ → ㅇ (려/료/류/리/례…) 또는 ㄹ → ㄴ (라/로/루/르…)
    const next = TO_IEUNG_MEDIALS.has(medial) ? INITIAL_O : INITIAL_N;
    out.add(compose(next, medial, final));
  } else if (initial === INITIAL_N) {
    // ㄴ → ㅇ (녀/뇨/뉴/니…) — ㄴ→ㄴ는 변형 없음
    if (TO_IEUNG_MEDIALS.has(medial)) out.add(compose(INITIAL_O, medial, final));
  }
  return [...out];
}

export function firstChar(word: string): string { return word.charAt(0); }
export function lastChar(word: string): string { return word.charAt(word.length - 1); }

/** 단어가 끝말잇기에 쓸 수 있는 형태인지 (한글 2글자 이상) */
export function isPlayableWord(word: string): boolean {
  const w = word.trim();
  if (w.length < 2) return false;
  return [...w].every(isHangulSyllable);
}

export type RejectReason =
  | 'too-short'      // 2글자 미만 / 한글 아님
  | 'chain'          // 앞 글자가 안 이어짐
  | 'used'           // 이미 사용한 단어
  | 'not-in-dict';   // 사전에 없음

export interface ValidateResult {
  ok: boolean;
  reason?: RejectReason;
  /** chain 거부 시: 허용되던 시작 글자들 */
  expected?: string[];
}

export interface Dict {
  has: (word: string) => boolean;
  /** 시작 글자별 단어 목록 */
  byFirst: (ch: string) => string[];
}

/** 플레이어가 제출한 단어 검증 */
export function validateWord(
  word: string,
  prevWord: string | null,
  used: Set<string>,
  dict: Dict,
): ValidateResult {
  const w = word.trim();
  if (!isPlayableWord(w)) return { ok: false, reason: 'too-short' };

  if (prevWord) {
    const expected = allowedStarts(lastChar(prevWord));
    if (!expected.includes(firstChar(w))) {
      return { ok: false, reason: 'chain', expected };
    }
  }
  if (used.has(w)) return { ok: false, reason: 'used' };
  if (!dict.has(w)) return { ok: false, reason: 'not-in-dict' };
  return { ok: true };
}

export type AiLevel = 'easy' | 'normal' | 'hard';

/**
 * AI(초텐쨩)의 다음 단어를 고른다.
 * - 이전 플레이어 단어의 마지막 글자로 시작하는, 아직 안 쓴 사전 단어 중 선택.
 * - hard일수록 "한방단어"(다음 사람이 이어받기 힘든 끝글자) 경향.
 * - 후보가 없으면 null → AI 패배(플레이어 승).
 */
export function pickAiWord(
  prevWord: string,
  used: Set<string>,
  dict: Dict,
  level: AiLevel = 'normal',
): string | null {
  const starts = allowedStarts(lastChar(prevWord));
  const candidates: string[] = [];
  for (const s of starts) {
    for (const w of dict.byFirst(s)) {
      if (!used.has(w)) candidates.push(w);
    }
  }
  if (candidates.length === 0) return null;

  if (level === 'easy') {
    // 끝글자로 이어갈 단어가 많은(=상대가 받기 쉬운) 단어 선호
    return leastKiller(candidates, used, dict);
  }
  if (level === 'hard') {
    // 상대가 받기 어려운 한방단어 선호
    return mostKiller(candidates, used, dict);
  }
  // normal: 랜덤
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** 끝글자 기준, 다음에 이어받을 수 있는 (안 쓴) 후보 수 */
function continuationCount(word: string, used: Set<string>, dict: Dict): number {
  let n = 0;
  for (const s of allowedStarts(lastChar(word))) {
    for (const w of dict.byFirst(s)) {
      if (w !== word && !used.has(w)) n++;
    }
  }
  return n;
}

/** 후보가 너무 많으면 샘플링해서 비교(성능) */
function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(Math.random() * arr.length)]);
  return out;
}

function mostKiller(cands: string[], used: Set<string>, dict: Dict): string {
  let best = cands[0];
  let bestScore = Infinity;
  for (const w of sample(cands, 60)) {
    const c = continuationCount(w, used, dict);
    if (c < bestScore) { bestScore = c; best = w; }
  }
  return best;
}

function leastKiller(cands: string[], used: Set<string>, dict: Dict): string {
  let best = cands[0];
  let bestScore = -1;
  for (const w of sample(cands, 60)) {
    const c = continuationCount(w, used, dict);
    if (c > bestScore) { bestScore = c; best = w; }
  }
  return best;
}
