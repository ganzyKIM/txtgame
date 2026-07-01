-- ============================================================
-- Migration 011: 퀴즈 실패 학습 레이어 (txtgame)
--   탈락 후보를 기록하고, 만성 실패 정답·패턴을 조회해
--   다음 출제 프롬프트에 피드백하는 RPC 3개.
--
-- 010_quiz_bank.sql 실행 후에 실행.
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

-- 010 실행 시 누락된 실패 기록 컬럼 추가
alter table public.quiz_generations
  add column if not exists rejected      boolean not null default false,
  add column if not exists reject_stage  text    not null default '',
  add column if not exists reject_reason text    not null default '';

-- quiz_generations에 answer_key generated column 추가
alter table public.quiz_generations
  add column if not exists answer_key text
    generated always as (
      lower(regexp_replace(answer, '[^가-힣a-z0-9]', '', 'g'))
    ) stored;

create index if not exists quiz_generations_answer_key_idx
  on public.quiz_generations(category_key, answer_key);

-- ============================================================
-- RPC ④: 탈락 후보 기록 (Level 1)
--   retry loop에서 버려지는 후보를 rejected=true로 quiz_generations에 저장.
--   duplicate(중복)은 세션 내 현상이라 저장하지 않음.
-- ============================================================
create or replace function public.record_quiz_rejection(
  p_answer_key     text,
  p_category_key   text,
  p_category_label text,
  p_answer         text,
  p_hints          text[],
  p_max_hints      integer,
  p_reject_stage   text,
  p_reject_reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.quiz_generations (
    category_key, category_label, answer, hints, max_hints,
    rejected, reject_stage, reject_reason, created_by
  ) values (
    p_category_key, p_category_label, p_answer,
    coalesce(p_hints, '{}'), coalesce(p_max_hints, 0),
    true, p_reject_stage, coalesce(p_reject_reason, ''), auth.uid()
  );
end;
$$;

grant execute on function public.record_quiz_rejection(text,text,text,text,text[],integer,text,text)
  to authenticated;

-- ============================================================
-- RPC ⑤: 만성 실패 정답 조회 (Level 2)
--   reject >= p_min_rejects 이면서 accept 이력이 없는 answer 목록.
--   클라이언트가 exclusion에 추가 → 프롬프트에서 자동 차단.
-- ============================================================
create or replace function public.get_chronic_failures(
  p_category_key text,
  p_min_rejects  int default 3
)
returns table(answer text, reject_count bigint, top_reason text)
language sql
security definer
set search_path = public
as $$
  with rejected_agg as (
    select
      answer_key,
      (array_agg(g.answer order by g.created_at desc))[1] as answer,
      count(*) as rc,
      (array_agg(g.reject_reason order by g.created_at desc))[1] as top_reason
    from public.quiz_generations g
    where g.category_key = p_category_key
      and g.rejected = true
      and g.reject_stage in ('wiki', 'verify', 'lint')
    group by answer_key
    having count(*) >= p_min_rejects
  ),
  accepted_keys as (
    select distinct answer_key
    from public.quiz_generations
    where category_key = p_category_key
      and rejected = false
  )
  select r.answer, r.rc, r.top_reason
  from rejected_agg r
  where r.answer_key not in (select answer_key from accepted_keys)
  order by r.rc desc
  limit 30;
$$;

grant execute on function public.get_chronic_failures(text, int) to authenticated;

-- ============================================================
-- RPC ⑥: 탈락 패턴 조회 (Level 3)
--   verify 실패 이유를 빈도순으로 집계.
--   클라이언트가 buildSetupPrompt 네거티브 예시로 주입.
-- ============================================================
create or replace function public.get_failure_patterns(
  p_category_key text,
  p_limit        int default 5
)
returns table(pattern text, cnt bigint)
language sql
security definer
set search_path = public
as $$
  select reject_reason, count(*) as cnt
  from public.quiz_generations
  where category_key = p_category_key
    and rejected = true
    and reject_stage = 'verify'
    and reject_reason <> ''
  group by reject_reason
  order by cnt desc
  limit p_limit;
$$;

grant execute on function public.get_failure_patterns(text, int) to authenticated;
