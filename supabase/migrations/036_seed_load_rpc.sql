-- ============================================================
-- Migration 036: 시드 적재 RPC (사람 손 없이 문제은행 채우기)
--
--   지금까지 시드는 SQL Editor 에 붙여넣어 적재했다. 주기 실행(클라우드 루틴)이
--   생기면 그 손이 없다. Management API 토큰(계정 전체 권한)이나 DB 비밀번호를
--   루틴에 주는 대신, **적재만 할 수 있는 좁은 문**을 낸다:
--     seed_load_quiz(p_token, p_rows) / seed_load_soup(p_token, p_rows)
--   토큰은 seed_secrets 테이블(RLS, 정책 없음 — definer 함수만 읽는다)에 두고,
--   함수는 anon 키로도 호출할 수 있지만 토큰이 틀리면 아무것도 하지 않는다.
--   업서트 규칙은 기존 시드 SQL 과 같다: banned 보호, 힌트세트 distinct 병합(최대 10).
--
--   적용 후 토큰을 넣어야 한다 (한 번):
--     insert into public.seed_secrets(key, value) values ('seed_token', '<긴 난수>')
--       on conflict (key) do update set value = excluded.value;
--   같은 값을 tools/seed-load.mjs 의 SEED_TOKEN 환경변수로 준다.
-- ============================================================

create table if not exists public.seed_secrets (
  key   text primary key,
  value text not null
);
alter table public.seed_secrets enable row level security;
revoke all on public.seed_secrets from anon, authenticated;

create or replace function public.seed_token_ok(p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select p_token is not null
     and length(p_token) >= 32
     and exists (select 1 from public.seed_secrets s where s.key = 'seed_token' and s.value = p_token);
$$;
revoke all on function public.seed_token_ok(text) from public;

-- ── 퀴즈: rows = [{answer_key, category_key, answer, category_label, acceptable[], hints[], max_hints, difficulty}] ──
create or replace function public.seed_load_quiz(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r   jsonb;
  v_n integer := 0;
begin
  if not public.seed_token_ok(p_token) then
    raise exception 'seed token rejected' using errcode = '28000';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(r->>'answer_key','') = '' or coalesce(r->>'category_key','') = '' then continue; end if;
    insert into public.quiz_bank as b
      (answer_key, category_key, answer, category_label, acceptable, hint_sets, max_hints, difficulty_labeled)
    values (
      r->>'answer_key', r->>'category_key', r->>'answer', coalesce(r->>'category_label', ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'acceptable', '[]'::jsonb)) x), '{}'),
      jsonb_build_array(coalesce(r->'hints', '[]'::jsonb)),
      coalesce((r->>'max_hints')::int, 0),
      coalesce(r->>'difficulty', 'normal')
    )
    on conflict (answer_key, category_key) do update set
      answer         = excluded.answer,
      category_label = excluded.category_label,
      acceptable     = (select array(select distinct unnest(b.acceptable || excluded.acceptable))),
      hint_sets      = coalesce((
        select jsonb_path_query_array(jsonb_agg(distinct e), '$[0 to 9]'::jsonpath)
        from jsonb_array_elements(excluded.hint_sets || b.hint_sets) e
      ), b.hint_sets),
      max_hints          = excluded.max_hints,
      difficulty_labeled = excluded.difficulty_labeled,
      updated_at         = now()
    where b.status <> 'banned';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── 수프: rows = [{scenario_key, title, scenario, solution, key_facts[], mood, difficulty}] ──
create or replace function public.seed_load_soup(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r   jsonb;
  v_n integer := 0;
begin
  if not public.seed_token_ok(p_token) then
    raise exception 'seed token rejected' using errcode = '28000';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(r->>'scenario_key','') = '' or coalesce(r->>'scenario','') = '' or coalesce(r->>'solution','') = '' then continue; end if;
    insert into public.soup_bank as b
      (scenario_key, title, scenario, solution, key_facts, mood, difficulty)
    values (
      r->>'scenario_key', coalesce(r->>'title', '수수께끼'), r->>'scenario', r->>'solution',
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'key_facts', '[]'::jsonb)) x), '{}'),
      coalesce(r->>'mood', ''), coalesce(r->>'difficulty', 'normal')
    )
    on conflict (scenario_key) do update set
      title = excluded.title, solution = excluded.solution, key_facts = excluded.key_facts,
      mood = excluded.mood, difficulty = excluded.difficulty, updated_at = now()
    where b.status <> 'banned';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 재고 확인용 (토큰 필요) — 루틴이 "어느 칸이 비었나" 를 보고 후보 수량을 정한다
create or replace function public.seed_inventory(p_token text)
returns table(kind text, category_key text, difficulty text, n bigint)
language sql
security definer
set search_path = public
as $$
  select 'quiz', b.category_key, coalesce(b.difficulty_actual, b.difficulty_labeled), count(*)
    from public.quiz_bank b where b.status = 'active' and public.seed_token_ok(p_token)
   group by 2, 3
  union all
  select 'soup', s.mood, s.difficulty, count(*)
    from public.soup_bank s where s.status = 'active' and public.seed_token_ok(p_token)
   group by 2, 3
  order by 1, 2, 3;
$$;

grant execute on function public.seed_load_quiz(text, jsonb) to anon, authenticated;
grant execute on function public.seed_load_soup(text, jsonb) to anon, authenticated;
grant execute on function public.seed_inventory(text) to anon, authenticated;
