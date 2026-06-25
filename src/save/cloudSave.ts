import { supabase } from '../lib/supabase';
import type { GameResult } from '../game/types';

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
  winRate: number;
  bestScore: number;
  avgScore: number;
  bestRank: string;
}

export async function getStats(userId: string): Promise<Stats> {
  const empty: Stats = { plays: 0, wins: 0, winRate: 0, bestScore: 0, avgScore: 0, bestRank: '-' };
  try {
    const { data, error } = await supabase
      .from('quiz_results')
      .select('won, score, rank')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error || !data) return empty;

    const plays = data.length;
    const wonRows = data.filter((d) => d.won);
    const wins = wonRows.length;
    const winRate = plays > 0 ? Math.round((wins / plays) * 100) : 0;
    const bestScore = wonRows.reduce((m, d) => Math.max(m, d.score ?? 0), 0);
    const avgScore = wins > 0 ? Math.round(wonRows.reduce((s, d) => s + (d.score ?? 0), 0) / wins) : 0;

    const RANK_ORDER = ['S', 'A', 'B', 'C'];
    const bestRank = RANK_ORDER.find((r) => wonRows.some((d) => d.rank === r)) ?? '-';

    return { plays, wins, winRate, bestScore, avgScore, bestRank };
  } catch {
    return empty;
  }
}

export interface Ranking {
  totalPlayers: number;
  beaten: number;
  topPercent: number;
  myBestScore: number;
}

export async function getRanking(userId: string): Promise<Ranking | null> {
  try {
    // 내 최고점
    const { data: myData } = await supabase
      .from('quiz_results')
      .select('score')
      .eq('user_id', userId)
      .eq('won', true)
      .order('score', { ascending: false })
      .limit(1);

    const myBestScore = myData?.[0]?.score ?? 0;

    // SECURITY DEFINER RPC로 전체 순위 조회 (RLS 우회)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rankData } = await (supabase as any)
      .rpc('quiz_ranking', { p_score: myBestScore }) as { data: { total_players: number; beaten: number } | null };

    if (!rankData) return null;

    const totalPlayers = Number(rankData.total_players) || 0;
    const beaten = Number(rankData.beaten) || 0;
    const topPercent = totalPlayers > 0
      ? Math.max(1, 100 - Math.round((beaten / totalPlayers) * 100))
      : 100;

    return { totalPlayers, beaten, topPercent, myBestScore };
  } catch {
    return null;
  }
}
