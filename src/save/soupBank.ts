/**
 * 바다거북 수프 문제은행 (soup_bank) 읽기 래퍼.
 *
 * 진상이 들어 있어 클라 직접 SELECT 는 RLS 로 막혀 있고, security definer RPC 로만
 * 뽑는다 (migration 035). 서버가 유저당 최근 30문제를 기억해 중복을 막는다.
 * 모든 호출은 fail-silent — 은행이 비었거나 실패하면 null 을 돌려주고 호출부가
 * 기존 실시간 생성으로 폴백한다.
 */
import { supabase } from '../lib/supabase';
import type { SoupPuzzle } from '../game/soup';

// RPC 는 database.types 에 없어 타입 우회 (quizBank.ts 와 같은 패턴)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

export interface BankSoupPuzzle extends SoupPuzzle {
  /** soup_bank.id — 결과 기록에 쓴다 */
  bankId: string;
}

export async function pickSoupPuzzle(excludeIds: string[] = []): Promise<BankSoupPuzzle | null> {
  try {
    const { data, error } = await rpc.rpc('pick_soup_puzzle', { p_exclude_ids: excludeIds });
    if (error) { console.error('[soup_bank] pick error:', error); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.scenario || !row?.solution) return null;
    return {
      bankId: String(row.id),
      title: String(row.title ?? '수수께끼'),
      scenario: String(row.scenario),
      solution: String(row.solution),
      keyFacts: Array.isArray(row.key_facts) ? row.key_facts.map(String) : [],
    };
  } catch (e) {
    console.error('[soup_bank] pick exception:', e);
    return null;
  }
}

export async function recordSoupBankResult(bankId: string, solved: boolean): Promise<void> {
  try {
    await rpc.rpc('record_soup_bank_result', { p_id: bankId, p_solved: solved });
  } catch (e) {
    console.error('[soup_bank] record exception:', e);
  }
}

/** 수프 문제 신고 — 서버가 즉시 숨기고 검토 큐에 넣는다 (migration 038). fail-silent */
export async function reportSoupProblem(bankId: string, reason: 'broken_logic' | 'spoiler' | 'inappropriate', note = ''): Promise<void> {
  try {
    await rpc.rpc('record_soup_report', { p_bank_id: bankId, p_reason: reason, p_note: note });
  } catch (e) {
    console.error('[soup_bank] report exception:', e);
  }
}
