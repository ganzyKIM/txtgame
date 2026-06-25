import { supabase } from '../lib/supabase';
import type { GameResult } from '../game/types';

/**
 * 게임 결과를 quiz_results 테이블에 저장한다.
 * 테이블이 아직 없거나 RLS 오류여도 게임 흐름을 막지 않도록 조용히 무시한다.
 */
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

export interface Stats {
  plays: number;
  wins: number;
  bestScore: number;
}

/** 누적 전적 (총 플레이 / 승리 / 최고점) */
export async function getStats(): Promise<Stats> {
  try {
    const { data, error } = await supabase
      .from('quiz_results')
      .select('won, score')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error || !data) return { plays: 0, wins: 0, bestScore: 0 };
    const plays = data.length;
    const wins = data.filter((d) => d.won).length;
    const bestScore = data.reduce((m, d) => Math.max(m, d.score ?? 0), 0);
    return { plays, wins, bestScore };
  } catch {
    return { plays: 0, wins: 0, bestScore: 0 };
  }
}
