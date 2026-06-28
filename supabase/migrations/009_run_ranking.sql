-- ============================================================
-- Migration 009: 센터시험(10문제 총점) 글로벌 랭킹 RPC (txtgame)
-- 편차치 랭킹을 센터시험 최고 총점 기준으로 산정한다.
-- 008_quiz_runs.sql 실행 후에 실행한다.
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.quiz_run_ranking(p_score integer)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_players', COUNT(DISTINCT user_id),
    'beaten',        COUNT(DISTINCT user_id) FILTER (WHERE best < p_score)
  )
  FROM (
    SELECT user_id, MAX(total_score) AS best
    FROM quiz_runs
    GROUP BY user_id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.quiz_run_ranking(integer) TO authenticated;
