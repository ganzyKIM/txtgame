/**
 * 서버 퀴즈 콘텐츠 DB (quiz_generations / quiz_bank) 저장 래퍼.
 *
 * 두 테이블 모두 정답을 담아 클라 직접 SELECT는 RLS로 차단돼 있다.
 * 쓰기/갱신은 SECURITY DEFINER RPC로만 한다 (migration 010).
 * 모든 호출은 fail-silent — 데이터 적재 실패가 게임 진행을 막으면 안 된다.
 */
import { supabase } from '../lib/supabase';
import { normAnswerKey } from '../game/answerBank';

// RPC는 database.types에 없어 타입 우회 (기존 quiz_run_ranking과 동일 패턴)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

export interface QuizGenMeta {
  categoryKey: string;
  categoryLabel: string;
  theme: string;
  answer: string;
  acceptable: string[];
  hints: string[];
  maxHints: number;
  difficultyLabeled: string;
  /** 생성 출처 */
  promptVersion: string;
  genEra: string | null;
  genRegion: string | null;
  genAngle: string | null;
  source: 'ai_fresh' | 'bank_reuse';
  /** 검증 결과 (4단계 파이프라인) */
  wikiVerified: boolean;
  lintPassed: boolean;
  verifyPassed: boolean;
  verifyProblem: string;
}

/** 생성 1건 기록 + 뱅크 upsert. 출제 확정 직후 1회. */
export async function saveQuizGeneration(m: QuizGenMeta): Promise<void> {
  try {
    const { error } = await rpc.rpc('record_quiz_generation', {
      p_answer_key: normAnswerKey(m.answer),
      p_category_key: m.categoryKey,
      p_category_label: m.categoryLabel,
      p_theme: m.theme,
      p_answer: m.answer,
      p_acceptable: m.acceptable,
      p_hints: m.hints,
      p_max_hints: m.maxHints,
      p_difficulty_labeled: m.difficultyLabeled,
      p_prompt_version: m.promptVersion,
      p_gen_era: m.genEra,
      p_gen_region: m.genRegion,
      p_gen_angle: m.genAngle,
      p_source: m.source,
      p_wiki_verified: m.wikiVerified,
      p_lint_passed: m.lintPassed,
      p_verify_passed: m.verifyPassed,
      p_verify_problem: m.verifyProblem,
    });
    if (error) console.error('[quiz_bank] record_quiz_generation error:', error);
  } catch (e) {
    console.error('[quiz_bank] saveQuizGeneration exception:', e);
  }
}

/** 플레이 결과 누적 (게임 종료 후). 실측 난이도·trusted 승격을 서버가 재계산. */
export async function updateQuizBankStats(
  answer: string,
  categoryKey: string,
  won: boolean,
  hintsUsed: number,
): Promise<void> {
  if (!categoryKey) return;
  try {
    await rpc.rpc('update_quiz_bank_stats', {
      p_answer_key: normAnswerKey(answer),
      p_category_key: categoryKey,
      p_won: won,
      p_hints_used: hintsUsed,
    });
  } catch {
    /* 무시 */
  }
}

/** 이의제기 인용 기록 (2회 이상 → 서버에서 banned). */
export async function recordQuizAppeal(answer: string, categoryKey: string): Promise<void> {
  if (!categoryKey) return;
  try {
    await rpc.rpc('record_quiz_appeal', {
      p_answer_key: normAnswerKey(answer),
      p_category_key: categoryKey,
    });
  } catch {
    /* 무시 */
  }
}

// ── Level 1~3: 실패 기록 + 패턴 학습 ────────────────────────────────────

export interface QuizRejectionMeta {
  categoryKey: string;
  categoryLabel: string;
  answer: string;
  hints: string[];
  maxHints: number;
  /** 'lint' | 'wiki' | 'verify' */
  rejectStage: string;
  rejectReason: string;
}

/** Level 1 — 탈락 후보 기록. retry loop에서 버려지는 후보를 저장. */
export async function saveQuizRejection(m: QuizRejectionMeta): Promise<void> {
  try {
    await rpc.rpc('record_quiz_rejection', {
      p_answer_key: normAnswerKey(m.answer),
      p_category_key: m.categoryKey,
      p_category_label: m.categoryLabel,
      p_answer: m.answer,
      p_hints: m.hints,
      p_max_hints: m.maxHints,
      p_reject_stage: m.rejectStage,
      p_reject_reason: m.rejectReason,
    });
  } catch { /* 무시 */ }
}

/** Level 2 — 만성 실패 정답 목록. 3회+ 탈락 & 채택 이력 없는 answer 텍스트 반환. */
export async function getChronicFailures(categoryKey: string): Promise<string[]> {
  if (!categoryKey) return [];
  try {
    const { data } = await rpc.rpc('get_chronic_failures', {
      p_category_key: categoryKey,
      p_min_rejects: 3,
    }) as { data: { answer: string }[] | null };
    return (data ?? []).map((r: { answer: string }) => r.answer);
  } catch { return []; }
}

/** Level 3 — 탈락 패턴 목록. verify 실패 이유 빈도순 반환. */
export async function getFailurePatterns(categoryKey: string): Promise<string[]> {
  if (!categoryKey) return [];
  try {
    const { data } = await rpc.rpc('get_failure_patterns', {
      p_category_key: categoryKey,
      p_limit: 5,
    }) as { data: { pattern: string }[] | null };
    return (data ?? []).map((r: { pattern: string }) => r.pattern);
  } catch { return []; }
}

// ── 서버 문제은행 재사용 (migration 020) ────────────────────────────────

export interface ServerBankPuzzle {
  answer: string;
  acceptable: string[];
  hints: string[];
  maxHints: number;
}

/**
 * 서버 quiz_bank에서 검증된 문제를 하나 뽑아온다.
 * 적중하면 AI 호출 없이 그대로 출제 가능(0크레딧) — 저장된 힌트 세트는
 * 전부 생성 당시 검증 파이프라인을 통과한 것들이다.
 */
export async function pickServerBankPuzzle(
  categoryKey: string,
  difficulty: string,
  excludeAnswers: string[],
): Promise<ServerBankPuzzle | null> {
  if (!categoryKey) return null;
  try {
    const { data, error } = await rpc.rpc('pick_quiz_bank_puzzle', {
      p_category_key: categoryKey,
      p_difficulty: difficulty,
      p_exclude_keys: excludeAnswers.map(normAnswerKey).filter(Boolean),
    }) as { data: { answer: string; acceptable: string[]; hints: string[]; max_hints: number }[] | null; error: unknown };
    if (error || !data || data.length === 0) return null;
    const r = data[0];
    if (!r.answer || !Array.isArray(r.hints) || r.hints.length === 0) return null;
    return { answer: r.answer, acceptable: r.acceptable ?? [], hints: r.hints, maxHints: r.max_hints || r.hints.length };
  } catch { return null; }
}

/** 이용자 문제 신고 (2회 이상 → 서버에서 banned). */
export async function reportQuizProblem(
  answer: string,
  categoryKey: string,
  reason: 'hallucination' | 'off_topic',
): Promise<void> {
  if (!categoryKey) return;
  try {
    await rpc.rpc('record_quiz_report', {
      p_answer_key: normAnswerKey(answer),
      p_category_key: categoryKey,
      p_reason: reason,
    });
  } catch { /* 무시 */ }
}
