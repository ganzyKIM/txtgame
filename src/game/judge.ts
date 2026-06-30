import { proxyGenerateText } from '../api/proxy';
import type { TextTier } from '../types';
import { buildJudgePrompt, buildAppealPrompt, parseJudge, buildVerifyPrompt, parseVerify } from './puzzle';
import type { Puzzle } from './types';

/** 비교용 정규화: 공백/문장부호/대소문자 제거, 흔한 조사 꼬리 제거 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s·~!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`]/g, '')
    .trim();
}

export interface JudgeResult {
  correct: boolean;
  reason: string;
  /** 차감 후 잔액 (AI 판정을 거쳤을 때만) */
  balance?: number;
}

/**
 * 추측 판정. 먼저 로컬 정규화 매칭으로 명백한 정답/근접을 즉시 처리해
 * 크레딧을 아끼고, 애매하면 Gemini 의미 판정으로 폴백한다.
 *
 * 판정용 AI 호출은 출제(quiz_gen)와 분리해 항상 빠르고 싼 티어('quiz_judge')를 쓴다.
 * 예/아니오성 의미 판정엔 저가 모델로 충분하고, 틀린 추측 시 대기 시간이 크게 줄어든다.
 * (세 번째 인자 _tier는 기존 호출부 호환을 위해 남겨두되 사용하지 않는다.)
 */
const JUDGE_TIER: TextTier = 'quiz_judge';

export async function judgeGuess(
  puzzle: Puzzle,
  guess: string,
  _tier: TextTier = 'quiz_judge',
): Promise<JudgeResult> {
  const g = normalize(guess);
  if (!g) return { correct: false, reason: '추측이 비어 있어.' };

  // 1) 로컬 즉시 매칭 — 오탐(false positive) 방지를 위해 보수적으로.
  //    완전 일치이거나, 한쪽이 다른 쪽을 통째로 포함하면서 "짧은 쪽이 충분히 길고(≥4)
  //    길이 비율도 높을(≥0.67) 때"만 정답으로 본다. (예: "반란" 같은 짧은 공통어 통과 차단)
  //    그 외 애매한 경우는 아래 AI 의미 판정으로 넘긴다.
  const pool = [puzzle.answer, ...puzzle.acceptable].map(normalize);
  for (const p of pool) {
    if (!p) continue;
    if (g === p) return { correct: true, reason: '정확해!' };
    const [short, long] = g.length <= p.length ? [g, p] : [p, g];
    if (long.includes(short) && short.length >= 4 && short.length / long.length >= 0.67) {
      return { correct: true, reason: '정확해!' };
    }
  }

  // 2) AI 의미 판정 폴백 (빠른 모델 고정)
  try {
    const { text, balance } = await proxyGenerateText(
      JUDGE_TIER,
      [{ role: 'user', text: buildJudgePrompt(puzzle.answer, guess) }],
      { temperature: 0 },
    );
    const parsed = parseJudge(text);
    return { ...parsed, balance };
  } catch {
    return { correct: false, reason: '음… 그건 아닌 것 같아.' };
  }
}

/**
 * 이의제기 판정.
 * 저장된 정답 대신 공개된 힌트를 기준으로 유저 추측의 타당성을 판정한다.
 * 출제 AI 환각으로 정답이 잘못된 경우를 구제하기 위한 별도 경로.
 */
export async function appealGuess(
  puzzle: Puzzle,
  guess: string,
  revealedHints: string[],
): Promise<JudgeResult> {
  try {
    const { text, balance } = await proxyGenerateText(
      JUDGE_TIER,
      [{ role: 'user', text: buildAppealPrompt(revealedHints, puzzle.answer, guess) }],
      { temperature: 0 },
    );
    const parsed = parseJudge(text);
    return { ...parsed, balance };
  } catch {
    return { correct: false, reason: '이의제기 판정에 실패했어.' };
  }
}

export interface VerifyResult {
  ok: boolean;
  problem: string;
  balance?: number;
}

/**
 * 출제 결과 2차 검증 (싼 모델 전용).
 * 출제 모델과 분리된 두 번째 눈으로 환각·힌트 불일치·스포일러를 잡는다.
 * 검증 호출 자체가 실패하면 fail-open(ok=true) — 검증 때문에 출제가 막히면 안 된다.
 */
export async function verifyPuzzle(puzzle: Puzzle): Promise<VerifyResult> {
  try {
    const { text, balance } = await proxyGenerateText(
      JUDGE_TIER,
      [{ role: 'user', text: buildVerifyPrompt(puzzle) }],
      { temperature: 0 },
    );
    const parsed = parseVerify(text);
    return { ...parsed, balance };
  } catch {
    return { ok: true, problem: '' };
  }
}
