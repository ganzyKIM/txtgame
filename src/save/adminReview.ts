/**
 * 관리자 검토 큐 (migration 041) — 신고·이의제기로 숨겨진 문제를 운영자가 앱 안에서 처리한다.
 *
 * 서버가 JWT 의 이메일로 관리자 여부를 판정하므로(admin_emails), 여기선 호출만 한다.
 * 관리자가 아니면 pending 은 0, list 는 빈 배열, resolve 는 42501 로 거절된다.
 */
import { supabase } from '../lib/supabase';
import { normAnswerKey } from '../game/answerBank';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

export type ReviewKind = 'quiz' | 'soup';
export type ReviewAction = 'restore' | 'fix' | 'delete';

export interface QuizReviewItem {
  id: string;
  answer: string;
  answer_key: string;
  category_key: string;
  category_label: string;
  acceptable: string[];
  hint_sets: string[][];
  max_hints: number;
  difficulty_labeled: string;
  plays: number;
  wins: number;
  appeal_count: number;
  status: string;
}

export interface SoupReviewItem {
  id: string;
  title: string;
  scenario: string;
  solution: string;
  key_facts: string[];
  mood: string;
  difficulty: string;
  plays: number;
  solved: number;
  status: string;
}

export interface ReviewEntry {
  kind: ReviewKind;
  bankId: string;
  reasons: string[];
  notes: string[];
  reports: number;
  firstAt: string;
  quiz?: QuizReviewItem;
  soup?: SoupReviewItem;
}

export interface ReviewHistoryRow {
  kind: ReviewKind;
  bankId: string;
  reason: string;
  resolution: ReviewAction;
  resolvedAt: string;
  label: string;
}

/** 대기 건수 — 도구 막대 배지용. 실패하면 0 */
export async function getReviewPending(): Promise<number> {
  try {
    const { data, error } = await rpc.rpc('admin_review_pending');
    if (error) return 0;
    return Number(data ?? 0) || 0;
  } catch { return 0; }
}

export async function listReviewQueue(): Promise<ReviewEntry[]> {
  const { data, error } = await rpc.rpc('admin_review_list');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ kind: ReviewKind; bank_id: string; reasons: string[]; notes: string[]; reports: number; first_at: string; item: Record<string, unknown> | null }>;
  return rows.map((r) => {
    const e: ReviewEntry = {
      kind: r.kind, bankId: r.bank_id, reasons: r.reasons ?? [], notes: r.notes ?? [],
      reports: Number(r.reports ?? 0), firstAt: r.first_at,
    };
    const it = r.item ?? {};
    if (r.kind === 'quiz') {
      e.quiz = {
        id: String(it.id ?? r.bank_id),
        answer: String(it.answer ?? ''),
        answer_key: String(it.answer_key ?? ''),
        category_key: String(it.category_key ?? ''),
        category_label: String(it.category_label ?? ''),
        acceptable: Array.isArray(it.acceptable) ? it.acceptable.map(String) : [],
        hint_sets: Array.isArray(it.hint_sets) ? (it.hint_sets as unknown[]).map((s) => (Array.isArray(s) ? s.map(String) : [])) : [],
        max_hints: Number(it.max_hints ?? 0),
        difficulty_labeled: String(it.difficulty_labeled ?? ''),
        plays: Number(it.plays ?? 0), wins: Number(it.wins ?? 0), appeal_count: Number(it.appeal_count ?? 0),
        status: String(it.status ?? ''),
      };
    } else {
      e.soup = {
        id: String(it.id ?? r.bank_id),
        title: String(it.title ?? ''), scenario: String(it.scenario ?? ''), solution: String(it.solution ?? ''),
        key_facts: Array.isArray(it.key_facts) ? it.key_facts.map(String) : [],
        mood: String(it.mood ?? ''), difficulty: String(it.difficulty ?? ''),
        plays: Number(it.plays ?? 0), solved: Number(it.solved ?? 0), status: String(it.status ?? ''),
      };
    }
    return e;
  });
}

export async function listReviewHistory(limit = 30): Promise<ReviewHistoryRow[]> {
  const { data, error } = await rpc.rpc('admin_review_history', { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    kind: r.kind as ReviewKind, bankId: String(r.bank_id), reason: String(r.reason ?? ''),
    resolution: r.resolution as ReviewAction, resolvedAt: String(r.resolved_at ?? ''), label: String(r.label ?? ''),
  }));
}

export interface QuizPatch { answer?: string; acceptable?: string[]; hints?: string[]; max_hints?: number }
export interface SoupPatch { title?: string; scenario?: string; solution?: string; key_facts?: string[] }

export async function resolveReview(kind: ReviewKind, bankId: string, action: ReviewAction, patch: QuizPatch | SoupPatch = {}): Promise<void> {
  const p: Record<string, unknown> = { ...patch };
  // 정답을 고치면 중복 판정 키도 같이 — 서버는 answer_key 를 따로 받는다
  if (kind === 'quiz' && typeof (patch as QuizPatch).answer === 'string') p.answer_key = normAnswerKey((patch as QuizPatch).answer!);
  const { error } = await rpc.rpc('admin_review_resolve', { p_kind: kind, p_bank_id: bankId, p_action: action, p_patch: p });
  if (error) throw new Error(error.message);
}

/** 신고 사유 코드 → 한국어 */
export const REASON_LABEL: Record<string, string> = {
  hallucination: '환각(존재하지 않는 정답)',
  off_topic: '주제 부적합',
  appeal_upheld: '이의제기 인용',
  wrong_answer: '정답 오류',
  broken_logic: '진상이 말이 안 됨',
  spoiler: '문제에 답이 보임',
  inappropriate: '부적절한 소재',
};
