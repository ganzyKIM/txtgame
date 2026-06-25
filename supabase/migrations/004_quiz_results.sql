-- ============================================================
-- Migration 004: 추리 게임 결과 저장 (txtgame)
-- txtrpg와 같은 Supabase 프로젝트에서 1회 실행한다.
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

create table if not exists public.quiz_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category    text not null,
  theme       text not null default '',
  answer      text not null,
  hints_used  integer not null default 0,
  won         boolean not null default false,
  score       integer not null default 0,
  rank        text not null default 'C',
  created_at  timestamptz not null default now()
);
create index if not exists quiz_results_user_idx
  on public.quiz_results(user_id, created_at desc);

alter table public.quiz_results enable row level security;

-- 본인 결과만 읽고 쓴다
drop policy if exists "quiz_results: self all" on public.quiz_results;
create policy "quiz_results: self all"
  on public.quiz_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
