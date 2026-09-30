-- ============================================================
-- Migration 035: 바다거북 수프 문제은행
--
--   출제(brew)마다 Gemini 로 시나리오를 새로 만들던 것을, Claude 가 오프라인에서
--   만들어 검수한 문제를 미리 쌓아 두고 뽑아 쓰는 방식으로 바꾼다 (퀴즈 뱅크와
--   같은 이유 — 크레딧 0, 응답 즉시, 품질은 사후 검수로 보장).
--   질문 판정·힌트·정답 판정은 여전히 AI 가 진상을 읽고 한다.
--
--   quiz_serve_history 와 같은 패턴으로 유저당 최근 30문제를 서버가 기억해
--   같은 문제가 다시 나오지 않게 한다. 은행이 비었거나 전부 최근에 풀었으면
--   null 을 돌려주고 클라가 기존 실시간 생성으로 폴백한다.
--   Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

create table if not exists public.soup_bank (
  id             uuid primary key default gen_random_uuid(),
  -- 시나리오 본문의 md5 — 같은 시드를 두 번 적재해도 한 행
  scenario_key   text not null unique,
  title          text not null,
  scenario       text not null,
  solution       text not null,
  -- 진행자가 예/아니오를 판정할 때 기준으로 삼는 핵심 사실
  key_facts      text[] not null default '{}',
  mood           text not null default '',
  difficulty     text not null default 'normal',   -- easy | normal | hard
  status         text not null default 'active',   -- active | banned
  plays          integer not null default 0,
  solved         integer not null default 0,
  source         text not null default 'seed',
  created_at     timestamptz not null default now(),
  last_played_at timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists soup_bank_pick_idx on public.soup_bank(status, difficulty);
alter table public.soup_bank enable row level security;
-- 정책 없음 — 진상이 들어 있어 security definer RPC 로만 읽는다

create table if not exists public.soup_serve_history (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  recent_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.soup_serve_history enable row level security;

-- ── 내부: 뽑기 (uid 를 파라미터로 받아 SQL Editor 에서 검증 가능) ──
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
begin
  if p_user_id is not null then
    select h.recent_ids into v_recent from public.soup_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  select * into v_row
  from public.soup_bank b
  where b.status = 'active'
    and not (b.id = any(v_recent))
    and not (b.id = any(coalesce(p_exclude_ids, '{}')))
  -- 덜 나온 문제부터, 그 안에서는 무작위
  order by b.plays asc, random()
  limit 1;

  if v_row.id is null then return; end if;

  update public.soup_bank b set plays = b.plays + 1, last_played_at = now() where b.id = v_row.id;

  if p_user_id is not null then
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

-- ── 공개 RPC: 세션 유저 기준 ──
create or replace function public.pick_soup_puzzle(p_exclude_ids uuid[] default '{}')
returns table(id uuid, title text, scenario text, solution text, key_facts text[], mood text, difficulty text)
language sql
security definer
set search_path = public
as $$
  select * from public.soup_pick_internal(auth.uid(), p_exclude_ids);
$$;

-- ── 결과 반영: 풀었는지만 센다 (난이도 실측용) ──
create or replace function public.record_soup_bank_result(p_id uuid, p_solved boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.soup_bank b
     set solved = b.solved + (case when p_solved then 1 else 0 end),
         updated_at = now()
   where b.id = p_id;
$$;

revoke all on function public.soup_pick_internal(uuid, uuid[]) from public;
grant execute on function public.pick_soup_puzzle(uuid[]) to anon, authenticated;
grant execute on function public.record_soup_bank_result(uuid, boolean) to anon, authenticated;
