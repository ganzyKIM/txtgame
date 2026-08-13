-- ============================================================
-- Migration 033: 전적 재구성 (txtgame)
--
-- 1) game_results — 홀덤·오목처럼 자체 결과 테이블이 없던 게임의
--    공용 기록. 행 하나 = 핸드/대국 하나. 새 게임이 생기면 check만 넓힌다.
-- 2) my_stats() — 전 게임 전적 + 편차치를 서버가 한 번에 계산하는 RPC.
--    기존에는 클라가 테이블 4개에서 최대 500행씩 당겨 probit 근사로
--    편차치를 직접 계산했다. 이제 라운드트립 1번, 행 전송 0개.
--    편차치도 근사가 아니라 정의 그대로: 50 + 10 × (내 최고점 - 평균) / 표준편차.
--
-- Supabase Dashboard → SQL Editor에 통째로 붙여넣고 Run.
-- (에디터가 전체를 한 트랜잭션으로 돌린다 — 쪼개지 말 것)
-- ============================================================

create table if not exists public.game_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  game       text not null check (game in ('holdem', 'gomoku')),
  mode       text not null default 'single' check (mode in ('single', 'multi')),
  won        boolean not null,
  draw       boolean not null default false,
  score      integer not null default 0,      -- 홀덤: 딴 팟 크기. 오목: 0
  meta       jsonb not null default '{}'::jsonb, -- 오목 싱글: {"difficulty":"easy|normal|hard"}
  created_at timestamptz not null default now()
);

create index if not exists game_results_user_idx
  on public.game_results(user_id, game, created_at desc);

alter table public.game_results enable row level security;

-- 본인 기록만 쓰고 읽는다 (집계는 security definer RPC가 담당)
drop policy if exists "game_results: self all" on public.game_results;
create policy "game_results: self all"
  on public.game_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- my_stats(): 로그인 유저 자신의 전 게임 전적을 json 하나로
-- ------------------------------------------------------------
create or replace function public.my_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
with uid as (select auth.uid() as u),
-- 편차치 모집단: 유저별 센터시험 최고 총점
bests as (
  select user_id, max(total_score) as best
  from quiz_runs group by user_id
),
run as (
  select count(*)::int                        as runs,
         coalesce(max(total_score), 0)::int   as best,
         coalesce(round(avg(total_score)), 0)::int as avg
  from quiz_runs where user_id = (select u from uid)
),
pop as (
  select count(*)::int                        as players,
         coalesce(avg(best), 0)::float        as mean,
         coalesce(stddev_pop(best), 0)::float as sd
  from bests
),
beat as (
  select count(*)::int as beaten
  from bests where best < (select best from run)
),
quiz as (
  select count(*)::int                        as plays,
         count(*) filter (where won)::int     as wins
  from quiz_results where user_id = (select u from uid)
),
soup as (
  select count(*)::int                                            as plays,
         count(*) filter (where solved)::int                      as solved,
         count(*) filter (where solved and hints_used = 0)::int   as no_hint
  from soup_results where user_id = (select u from uid)
),
holdem as (
  select count(*)::int                                          as hands,
         count(*) filter (where won)::int                       as wins,
         coalesce(max(score) filter (where won), 0)::int        as best_pot,
         count(*) filter (where won and mode = 'multi')::int    as multi_wins
  from game_results where user_id = (select u from uid) and game = 'holdem'
),
gomoku as (
  select count(*)::int                                                     as plays,
         count(*) filter (where won)::int                                  as wins,
         count(*) filter (where draw)::int                                 as draws,
         count(*) filter (where won and meta->>'difficulty' = 'hard')::int as hard_wins,
         count(*) filter (where mode = 'multi')::int                       as multi_plays,
         count(*) filter (where won and mode = 'multi')::int               as multi_wins
  from game_results where user_id = (select u from uid) and game = 'gomoku'
)
select json_build_object(
  'center',   json_build_object('runs', run.runs, 'best', run.best, 'avg', run.avg),
  -- 표본이 1명이거나 전원 동점이면 편차 개념이 없다 → 50
  'hensachi', case
                when run.runs = 0 then null
                when pop.players < 2 or pop.sd = 0 then 50
                else least(99, greatest(1, round(50 + 10 * (run.best - pop.mean) / pop.sd)))::int
              end,
  'players',  pop.players,
  'beaten',   beat.beaten,
  'quiz',     json_build_object('plays', quiz.plays, 'wins', quiz.wins),
  'soup',     json_build_object('plays', soup.plays, 'solved', soup.solved, 'no_hint', soup.no_hint),
  'holdem',   json_build_object('hands', holdem.hands, 'wins', holdem.wins,
                                'best_pot', holdem.best_pot, 'multi_wins', holdem.multi_wins),
  'gomoku',   json_build_object('plays', gomoku.plays, 'wins', gomoku.wins, 'draws', gomoku.draws,
                                'hard_wins', gomoku.hard_wins,
                                'multi_plays', gomoku.multi_plays, 'multi_wins', gomoku.multi_wins)
)
from run, pop, beat, quiz, soup, holdem, gomoku;
$$;

grant execute on function public.my_stats() to authenticated;
