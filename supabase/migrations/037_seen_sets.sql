-- ============================================================
-- Migration 037: "한 번 낸 문제는 다시 내지 않는다" — 유저별 seen 집합
--
--   034 의 최근-10 창은 짧은 연속 중복만 막았다. 은행이 3,000문항을 넘고 사이클마다
--   수백 개씩 늘어나는 지금은 유저가 **이미 받은 문제를 은행이 바닥날 때까지 다시
--   받지 않게** 하는 게 맞다. 그래서 유저×정답키 집합(quiz_seen)을 두고 픽에서
--   통째로 제외한다. 카테고리 무관 — 같은 정답이 다른 카테고리로 돌아오는 것도 막는다.
--
--   바닥나면(그 카테고리·난이도에 남은 문제가 0) 그 칸의 seen 만 지우고 한 번 더
--   뽑는다 — 유저는 "다 풀었으니 처음부터" 를 자연스럽게 경험한다. 최근-10 창은
--   그 재시작 직후에도 방금 푼 문제가 바로 나오지 않게 하는 완충으로 그대로 둔다.
--
--   수프도 같은 규칙(soup_seen). 비로그인 유저는 서버가 기억할 수 없으니 클라의
--   제외 목록(p_exclude_keys / p_exclude_ids)이 유일한 방어다 — 클라는 그 목록을
--   localStorage 에 넉넉히(200개) 유지한다.
--   공개 RPC 시그니처는 그대로라 클라 변경 없이 적용된다.
-- ============================================================

create table if not exists public.quiz_seen (
  user_id    uuid not null references auth.users(id) on delete cascade,
  answer_key text not null,
  seen_at    timestamptz not null default now(),
  primary key (user_id, answer_key)
);
alter table public.quiz_seen enable row level security;
-- 정책 없음 — definer RPC 로만 접근

create table if not exists public.soup_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_id uuid not null references public.soup_bank(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, bank_id)
);
alter table public.soup_seen enable row level security;

-- ── 퀴즈 픽 v2 ──────────────────────────────────────────────
create or replace function public.quiz_pick_internal(
  p_user_id      uuid,
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
  v_row    public.quiz_bank%rowtype;
  v_recent text[] := '{}';
  v_idx    int;
  v_set    jsonb;
  v_pass   int := 0;
begin
  if p_user_id is not null then
    select h.recent_keys into v_recent from public.quiz_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  loop
    v_pass := v_pass + 1;
    select * into v_row
    from public.quiz_bank b
    where b.category_key = p_category_key
      and b.status = 'active'
      and jsonb_array_length(b.hint_sets) > 0
      and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty
      and not (b.answer_key = any(v_recent))
      and not (b.answer_key = any(coalesce(p_exclude_keys, '{}')))
      and (p_user_id is null or not exists (
            select 1 from public.quiz_seen s where s.user_id = p_user_id and s.answer_key = b.answer_key))
    -- 덜 나간 문제부터 (전역 plays), 그 안에서 무작위 — 새 시드가 고르게 소비된다
    order by (b.plays >= 3), random()
    limit 1;

    exit when v_row.id is not null or v_pass >= 2 or p_user_id is null;

    -- 이 칸을 다 봤다: 이 칸의 seen 만 비우고 한 번 더 (최근-10 창·클라 제외는 유지)
    delete from public.quiz_seen s
     where s.user_id = p_user_id
       and s.answer_key in (
         select b.answer_key from public.quiz_bank b
          where b.category_key = p_category_key
            and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty);
  end loop;

  if v_row.id is null then return; end if;

  perform public.quiz_serve_push(p_user_id, v_row.answer_key);
  if p_user_id is not null then
    insert into public.quiz_seen (user_id, answer_key) values (p_user_id, v_row.answer_key)
    on conflict (user_id, answer_key) do update set seen_at = now();
  end if;

  v_idx := floor(random() * jsonb_array_length(v_row.hint_sets))::int;
  v_set := v_row.hint_sets -> v_idx;

  return query select
    v_row.answer, v_row.acceptable,
    array(select jsonb_array_elements_text(v_set)),
    v_row.max_hints, v_row.answer_key;
end;
$$;
revoke execute on function public.quiz_pick_internal(uuid, text, text, text[]) from public, anon, authenticated;

-- AI 즉석 생성으로 나간 정답도 seen 에 넣는다
create or replace function public.record_quiz_serve(p_answer_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.quiz_serve_push(auth.uid(), p_answer_key);
  if auth.uid() is not null and coalesce(p_answer_key, '') <> '' then
    insert into public.quiz_seen (user_id, answer_key) values (auth.uid(), p_answer_key)
    on conflict (user_id, answer_key) do update set seen_at = now();
  end if;
end;
$$;
grant execute on function public.record_quiz_serve(text) to authenticated;

-- 내가 이미 받은 문제 수 / 칸별 남은 문제 수 — "이 카테고리 다 풀었어?" 표시용
create or replace function public.quiz_seen_summary(p_category_key text default null, p_difficulty text default null)
returns table(seen bigint, remaining bigint, total bigint)
language sql
security definer
set search_path = public
as $$
  with cell as (
    select b.answer_key from public.quiz_bank b
     where b.status = 'active' and jsonb_array_length(b.hint_sets) > 0
       and (p_category_key is null or b.category_key = p_category_key)
       and (p_difficulty is null or coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty)
  )
  select
    (select count(*) from cell c where exists (select 1 from public.quiz_seen s where s.user_id = auth.uid() and s.answer_key = c.answer_key)),
    (select count(*) from cell c where not exists (select 1 from public.quiz_seen s where s.user_id = auth.uid() and s.answer_key = c.answer_key)),
    (select count(*) from cell);
$$;
grant execute on function public.quiz_seen_summary(text, text) to authenticated;

-- ── 수프 픽 v2 ──────────────────────────────────────────────
create or replace function public.soup_pick_internal(p_user_id uuid, p_exclude_ids uuid[] default '{}')
returns table(id uuid, title text, scenario text, solution text, key_facts text[], mood text, difficulty text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.soup_bank%rowtype;
  v_recent uuid[] := '{}';
  v_new    uuid[];
  v_pass   int := 0;
begin
  if p_user_id is not null then
    select h.recent_ids into v_recent from public.soup_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  loop
    v_pass := v_pass + 1;
    select * into v_row
    from public.soup_bank b
    where b.status = 'active'
      and not (b.id = any(v_recent))
      and not (b.id = any(coalesce(p_exclude_ids, '{}')))
      and (p_user_id is null or not exists (
            select 1 from public.soup_seen s where s.user_id = p_user_id and s.bank_id = b.id))
    order by b.plays asc, random()
    limit 1;

    exit when v_row.id is not null or v_pass >= 2 or p_user_id is null;
    delete from public.soup_seen s where s.user_id = p_user_id;   -- 은행을 다 봤다: 처음부터
  end loop;

  if v_row.id is null then return; end if;

  update public.soup_bank b set plays = b.plays + 1, last_played_at = now() where b.id = v_row.id;

  if p_user_id is not null then
    insert into public.soup_seen (user_id, bank_id) values (p_user_id, v_row.id)
    on conflict (user_id, bank_id) do update set seen_at = now();
    v_new := array_remove(v_recent, v_row.id) || v_row.id;
    if array_length(v_new, 1) > 30 then
      v_new := v_new[array_length(v_new, 1) - 29 : array_length(v_new, 1)];
    end if;
    insert into public.soup_serve_history as h (user_id, recent_ids, updated_at)
    values (p_user_id, v_new, now())
    on conflict (user_id) do update set recent_ids = excluded.recent_ids, updated_at = now();
  end if;

  return query select v_row.id, v_row.title, v_row.scenario, v_row.solution, v_row.key_facts, v_row.mood, v_row.difficulty;
end;
$$;
revoke all on function public.soup_pick_internal(uuid, uuid[]) from public;
