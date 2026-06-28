import { proxyGenerateText } from '../api/proxy';
import type { TextTier } from '../types';
import { buildJudgePrompt, parseJudge } from './puzzle';
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

  // 1) 로컬 즉시 매칭
  const pool = [puzzle.answer, ...puzzle.acceptable].map(normalize);
  for (const p of pool) {
    if (!p) continue;
    if (g === p || (p.length >= 2 && (g.includes(p) || p.includes(g)))) {
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
    // 판정 호출 실패 시: 로컬 기준으로 오답 처리(게임 진행 보장)
    return { correct: false, reason: '음… 그건 아닌 것 같아.' };
  }
}
