-- ============================================================
-- Migration 013: 이용자 문제 신고
--   환각·주제부적합 신고를 누적해 quiz_bank에 기록.
--   2회 이상 신고 → status = 'banned' (자동 제거).
-- ============================================================

alter table public.quiz_bank
  add column if not exists report_count integer not null default 0;

-- ============================================================
-- RPC ⑦: 문제 신고
-- ============================================================
create or replace function public.record_quiz_report(
  p_answer_key   text,
  p_category_key text,
  p_reason       text   -- 'hallucination' | 'off_topic'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quiz_bank set
    report_count = report_count + 1,
    status       = case
                     when report_count + 1 >= 2 then 'banned'
                     else status
                   end,
    updated_at   = now()
  where answer_key   = p_answer_key
    and category_key = p_category_key
    and status <> 'banned';
end;
$$;

grant execute on function public.record_quiz_report(text, text, text) to authenticated;
