-- ============================================================
-- Migration 020: 서버 문제은행 재사용 RPC (비용 절감)
--
-- [문제] quiz_bank는 기록(쓰기)만 되고 읽는 경로가 없어 재사용이
--        브라우저별 localStorage에만 의존 → 사실상 매번 새로 생성.
-- [수정] 검증 통과 이력이 있는 뱅크 항목에서 저장된 힌트 세트를
--        그대로 꺼내 쓰는 RPC. 적중 시 AI 호출 없이 출제(0크레딧).
--
-- 저장된 hint_sets는 전부 생성 당시 lint+위키+2차검증을 통과한
-- 세트이므로 trusted 승격을 기다릴 필요 없이 재사용 가능.
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

create or replace function public.pick_quiz_bank_puzzle(
  p_category_key text,
  p_difficulty   text,
  p_exclude_keys text[] default '{}'
)
returns table(
  answer     text,
  acceptable text[],
  hints      text[],
  max_hints  integer,
  answer_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.quiz_bank%rowtype;
  v_idx  int;
  v_set  jsonb;
begin
  select * into v_row
  from public.quiz_bank b
  where b.category_key = p_category_key
    and b.status <> 'banned'
    and b.wiki_verified = true
    and jsonb_array_length(b.hint_sets) > 0
    and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty
    and not (b.answer_key = any(coalesce(p_exclude_keys, '{}')))
  order by random()
  limit 1;

  if v_row.id is null then
    return; -- 적중 없음 — 클라이언트는 기존 생성 경로로 폴백
  end if;

  -- 저장된 힌트 세트(최대 10개) 중 하나를 랜덤 선택
  v_idx := floor(random() * jsonb_array_length(v_row.hint_sets))::int;
  v_set := v_row.hint_sets -> v_idx;

  return query select
    v_row.answer,
    v_row.acceptable,
    array(select jsonb_array_elements_text(v_set)),
    v_row.max_hints,
    v_row.answer_key;
end;
$$;

grant execute on function public.pick_quiz_bank_puzzle(text, text, text[])
  to authenticated;
