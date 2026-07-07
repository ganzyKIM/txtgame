-- ============================================================
-- Migration 021: quiz_bank 재설계
--
--   기존 문제: candidate→trusted 단계(3판 이상 플레이) 때문에 실제로
--   "이미 검증 통과한 문제"인데도 한동안 재사용 대상에서 빠졌고,
--   강제채택(모든 검증 스킵) 문제까지 wiki_verified=true로 잘못 기록되어
--   로컬 재사용 캐시에 환각 답이 영구히 눌러앉는 문제가 있었음.
--
--   신설계: "제대로 만들어진 문제(위키검증+린트+2차AI검증 셋 다 통과)"만
--   즉시 뱅크에 들어간다. 단계 없음 — 들어간 순간 바로 재사용 가능.
--   유일한 상태 전이는 active → banned (이의제기/신고 누적 시).
--
--   quiz_generations(원본 로그, 실패 포함)는 그대로 유지 — 실패 학습
--   RPC(get_chronic_failures 등)가 rejected=true 행을 필요로 하고,
--   행 카디널리티가 근본적으로 다르므로(같은 답에 성공1+실패N) 병합하지 않음.
-- ============================================================

drop function if exists public.pick_quiz_bank_puzzle(text, text, text[]);
drop function if exists public.record_quiz_appeal(text, text);
drop function if exists public.record_quiz_report(text, text, text);
drop function if exists public.update_quiz_bank_stats(text, text, boolean, integer);
drop function if exists public.record_quiz_generation(
  text,text,text,text,text,text[],text[],integer,text,text,text,text,text,text,
  boolean,boolean,boolean,text
);

alter table if exists public.quiz_generations drop constraint if exists quiz_generations_bank_id_fkey;
drop table if exists public.quiz_bank;

create table public.quiz_bank (
  id                 uuid primary key default gen_random_uuid(),
  answer_key         text not null,
  category_key       text not null,
  answer             text not null,
  category_label     text not null default '',
  acceptable         text[] not null default '{}',
  -- 힌트 세트 누적(최대 10개) — 재사용 시 매번 같은 힌트만 나오지 않도록 다양성 확보
  hint_sets          jsonb not null default '[]',
  max_hints          integer not null default 0,
  difficulty_labeled text not null default 'normal',
  difficulty_actual  text,
  status             text not null default 'active', -- active | banned
  plays              integer not null default 0,
  wins               integer not null default 0,
  total_hints_used   integer not null default 0,
  appeal_count       integer not null default 0,
  appeal_upheld      integer not null default 0,
  report_count       integer not null default 0,
  gen_count          integer not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_played_at     timestamptz,
  updated_at         timestamptz not null default now(),
  unique(answer_key, category_key)
);
create index quiz_bank_pick_idx on public.quiz_bank(category_key, status, difficulty_labeled);

alter table public.quiz_bank enable row level security;

-- ============================================================
-- RPC ①: 생성 1건 기록. "제대로 만들어진" 것만 quiz_bank에도 반영.
-- ============================================================
create or replace function public.record_quiz_generation(
  p_answer_key         text,
  p_category_key       text,
  p_category_label     text,
  p_theme              text,
  p_answer             text,
  p_acceptable         text[],
  p_hints              text[],
  p_max_hints          integer,
  p_difficulty_labeled text,
  p_prompt_version     text,
  p_gen_era            text,
  p_gen_region         text,
  p_gen_angle          text,
  p_source             text,
  p_wiki_verified      boolean,
  p_lint_passed        boolean,
  p_verify_passed      boolean,
  p_verify_problem     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank_id     uuid;
  v_fully_ok    boolean := p_wiki_verified and p_lint_passed and p_verify_passed;
  MAX_HINT_SETS constant int := 10;
begin
  if v_fully_ok then
    insert into public.quiz_bank as b (
      answer_key, category_key, answer, category_label, acceptable,
      hint_sets, max_hints, difficulty_labeled, gen_count, created_by
    )
    values (
      p_answer_key, p_category_key, p_answer, p_category_label,
      coalesce(p_acceptable, '{}'),
      jsonb_build_array(to_jsonb(coalesce(p_hints, '{}'))),
      p_max_hints, p_difficulty_labeled, 1, auth.uid()
    )
    on conflict (answer_key, category_key) do update set
      answer         = excluded.answer,
      category_label = excluded.category_label,
      acceptable     = (select array(select distinct unnest(b.acceptable || excluded.acceptable))),
      hint_sets      = (
        select jsonb_path_query_array(
          excluded.hint_sets || b.hint_sets,
          ('$[0 to ' || (MAX_HINT_SETS - 1) || ']')::jsonpath
        )
      ),
      max_hints          = excluded.max_hints,
      difficulty_labeled = excluded.difficulty_labeled,
      gen_count          = b.gen_count + 1,
      updated_at         = now()
    where b.status <> 'banned'
    returning id into v_bank_id;
  end if;

  insert into public.quiz_generations (
    bank_id, created_by, category_key, category_label, theme, answer, acceptable,
    hints, max_hints, difficulty_labeled, prompt_version, gen_era, gen_region,
    gen_angle, source, wiki_verified, lint_passed, verify_passed, verify_problem
  )
  values (
    v_bank_id, auth.uid(), p_category_key, p_category_label, p_theme, p_answer,
    coalesce(p_acceptable, '{}'), coalesce(p_hints, '{}'), p_max_hints, p_difficulty_labeled,
    p_prompt_version, p_gen_era, p_gen_region, p_gen_angle, p_source,
    p_wiki_verified, p_lint_passed, p_verify_passed, coalesce(p_verify_problem, '')
  );

  return v_bank_id;
end;
$$;

grant execute on function public.record_quiz_generation(
  text,text,text,text,text,text[],text[],integer,text,text,text,text,text,text,
  boolean,boolean,boolean,text
) to authenticated;

-- ============================================================
-- RPC ②: 재사용 픽 — active 상태면 전부 검증 통과분이므로 wiki_verified 필터 불필요
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
  v_row public.quiz_bank%rowtype;
  v_idx int;
  v_set jsonb;
begin
  select * into v_row
  from public.quiz_bank b
  where b.category_key = p_category_key
    and b.status = 'active'
    and jsonb_array_length(b.hint_sets) > 0
    and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty
    and not (b.answer_key = any(coalesce(p_exclude_keys, '{}')))
  order by random()
  limit 1;

  if v_row.id is null then return; end if;

  v_idx := floor(random() * jsonb_array_length(v_row.hint_sets))::int;
  v_set := v_row.hint_sets -> v_idx;

  return query select
    v_row.answer, v_row.acceptable,
    array(select jsonb_array_elements_text(v_set)),
    v_row.max_hints, v_row.answer_key;
end;
$$;

grant execute on function public.pick_quiz_bank_puzzle(text, text, text[]) to authenticated;

-- ============================================================
-- RPC ③: 플레이 결과 반영 (trusted 승격 로직 제거 — 이미 active면 재사용 대상)
-- ============================================================
create or replace function public.update_quiz_bank_stats(
  p_answer_key   text,
  p_category_key text,
  p_won          boolean,
  p_hints_used   integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plays integer;
  v_wins  integer;
  v_hints integer;
begin
  update public.quiz_bank set
    plays            = plays + 1,
    wins             = wins + (case when p_won then 1 else 0 end),
    total_hints_used = total_hints_used + coalesce(p_hints_used, 0),
    last_played_at   = now(),
    updated_at       = now()
  where answer_key = p_answer_key and category_key = p_category_key
    and status <> 'banned'
  returning plays, wins, total_hints_used into v_plays, v_wins, v_hints;

  if v_plays is null then return; end if;

  update public.quiz_bank set
    difficulty_actual = case
      when v_wins::numeric / v_plays >= 0.75 and v_hints::numeric / v_plays <= 2.5 then 'easy'
      when v_wins::numeric / v_plays >= 0.45 and v_hints::numeric / v_plays <= 4.5 then 'normal'
      else 'hard'
    end
  where answer_key = p_answer_key and category_key = p_category_key
    and status <> 'banned';
end;
$$;

grant execute on function public.update_quiz_bank_stats(text,text,boolean,integer) to authenticated;

-- ============================================================
-- RPC ④: 이의제기 인용 2회 이상 → banned
-- ============================================================
create or replace function public.record_quiz_appeal(
  p_answer_key   text,
  p_category_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quiz_bank set
    appeal_count  = appeal_count + 1,
    appeal_upheld = appeal_upheld + 1,
    status        = case when appeal_upheld + 1 >= 2 then 'banned' else status end,
    updated_at    = now()
  where answer_key = p_answer_key and category_key = p_category_key;
end;
$$;

grant execute on function public.record_quiz_appeal(text,text) to authenticated;

-- ============================================================
-- RPC ⑤: 이용자 신고 2회 이상 → banned
-- ============================================================
create or replace function public.record_quiz_report(
  p_answer_key   text,
  p_category_key text,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quiz_bank set
    report_count = report_count + 1,
    status       = case when report_count + 1 >= 2 then 'banned' else status end,
    updated_at   = now()
  where answer_key = p_answer_key and category_key = p_category_key
    and status <> 'banned';
end;
$$;

grant execute on function public.record_quiz_report(text, text, text) to authenticated;

-- 하드코딩 영구 차단: 존재하지 않는 표현인데 반복 출제되어 신고된 것으로 확인된 답
insert into public.quiz_bank (answer_key, category_key, answer, status)
values (lower(regexp_replace('노름마치', '[^가-힣a-z0-9]', '', 'g')), 'proverb', '노름마치', 'banned')
on conflict (answer_key, category_key) do update set status = 'banned';
