-- ============================================================
-- Migration 005: 글로벌 랭킹 RPC (txtgame)
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.quiz_ranking(p_score integer)
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
    SELECT user_id, MAX(score) AS best
    FROM quiz_results
    WHERE won = true
    GROUP BY user_id
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.quiz_ranking(integer) TO authenticated;
