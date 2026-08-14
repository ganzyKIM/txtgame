import { supabase } from '../lib/supabase';
import type { GameResult } from '../game/types';

/* ════════════════════════════════════════════════════════════════════
   기록 저장 — 게임들이 종료 시 호출한다. 실패는 전부 무시(게임 진행이
   전적 저장보다 우선). 조회는 my_stats() RPC 하나로 서버가 집계한다
   (supabase/migrations/033_game_records.sql) — 클라에서 행을 당겨와
   계산하지 않는다.
   ════════════════════════════════════════════════════════════════════ */

export async function saveResult(userId: string, r: GameResult): Promise<void> {
  try {
    await supabase.from('quiz_results').insert({
      user_id: userId,
      category: r.category,
      theme: r.theme,
      answer: r.answer,
      hints_used: r.hintsUsed,
      won: r.won,
      score: r.score,
      rank: r.rank,
    });
  } catch {
    /* 저장 실패는 무시 */
  }
}

// ── 센터시험(10문제 루틴) 총점 기록 ──────────────────────────────────
export interface RunInput {
  totalScore: number;
  questions: number;
  category: string;
}

export async function saveRun(userId: string, r: RunInput): Promise<void> {
  try {
    await supabase.from('quiz_runs').insert({
      user_id: userId,
      total_score: r.totalScore,
      questions: r.questions,
      category: r.category,
    });
  } catch {
    /* 저장 실패는 무시 */
  }
}

export interface SoupResultInput {
  title: string;
  solved: boolean;
  hintsUsed: number;
  questionsAsked: number;
}

export async function saveSoupResult(userId: string, r: SoupResultInput): Promise<void> {
  try {
    await supabase.from('soup_results').insert({
      user_id: userId,
      title: r.title,
      solved: r.solved,
      hints_used: r.hintsUsed,
      questions_asked: r.questionsAsked,
    });
  } catch {
    /* 저장 실패는 무시 */
  }
}

// ── 공용 게임 기록 (홀덤·오목) ──────────────────────────────────────
// 행 하나 = 핸드/대국 하나. userId를 프롭으로 끌고 다니지 않도록
// 세션(로컬 캐시)에서 직접 꺼낸다 — 네트워크 왕복 없음.
export type RecordableGame = 'holdem' | 'gomoku';

export interface GameRecordInput {
  mode: 'single' | 'multi';
  won: boolean;
  draw?: boolean;
  /** 홀덤: 이 핸드에서 딴 팟 크기 */
  score?: number;
  /** 오목 싱글: { difficulty: 'easy'|'normal'|'hard' } */
  meta?: Record<string, string>;
  /**
   * 같은 판을 두 번 기록하지 않기 위한 식별자(방 id·핸드 번호 등).
   * 컴포넌트 안의 ref 가드는 리마운트되면 초기화되지만 이건 모듈 수준이라
   * 세션 내내 유지된다 — 오목 싱글에서 effect가 무한 재실행되며 12,539행이
   * 들어간 사고를 겪고 넣었다.
   */
  key?: string;
}

const recordedKeys = new Set<string>();

export async function recordGameResult(game: RecordableGame, r: GameRecordInput): Promise<void> {
  if (r.key) {
    const k = `${game}:${r.mode}:${r.key}`;
    if (recordedKeys.has(k)) return;
    recordedKeys.add(k);
  }
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    // game_results는 생성된 DB 타입에 없다 — 기존 RPC들과 같은 우회(as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('game_results').insert({
      user_id: uid,
      game,
      mode: r.mode,
      won: r.won,
      draw: r.draw ?? false,
      score: r.score ?? 0,
      meta: r.meta ?? {},
    });
  } catch {
    /* 저장 실패는 무시 */
  }
}

// ── 전적 조회 — my_stats() RPC 하나가 전부 ─────────────────────────
export interface MyStats {
  center: { runs: number; best: number; avg: number };
  /** 센터시험 기준 편차치(서버 계산, 1~99). 기록이 없으면 null */
  hensachi: number | null;
  players: number;
  beaten: number;
  quiz: { plays: number; wins: number };
  soup: { plays: number; solved: number; no_hint: number };
  holdem: { hands: number; wins: number; best_pot: number; multi_wins: number };
  gomoku: {
    plays: number; wins: number; draws: number;
    hard_wins: number; multi_plays: number; multi_wins: number;
  };
}

export async function getMyStats(): Promise<MyStats | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('my_stats');
    if (error) return null;
    return (data as MyStats) ?? null;
  } catch {
    return null;
  }
}
