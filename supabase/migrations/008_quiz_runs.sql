-- ============================================================
-- Migration 008: 센터시험(10문제 루틴) 총점 기록 (txtgame)
-- txtrpg와 같은 Supabase 프로젝트에서 1회 실행한다.
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

create table if not exists public.quiz_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  total_score integer not null default 0,
  questions   integer not null default 10,
  category    text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists quiz_runs_user_idx
  on public.quiz_runs(user_id, created_at desc);

alter table public.quiz_runs enable row level security;

-- 본인 기록만 읽고 쓴다
drop policy if exists "quiz_runs: self all" on public.quiz_runs;
create policy "quiz_runs: self all"
  on public.quiz_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
