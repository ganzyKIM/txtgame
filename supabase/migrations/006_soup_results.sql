-- ============================================================
-- Migration 006: 바다거북 수프 게임 결과 저장 (txtgame)
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

create table if not exists public.soup_results (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null default '',
  solved           boolean not null default false,
  hints_used       integer not null default 0,
  questions_asked  integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists soup_results_user_idx
  on public.soup_results(user_id, created_at desc);

alter table public.soup_results enable row level security;

drop policy if exists "soup_results: self all" on public.soup_results;
create policy "soup_results: self all"
  on public.soup_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
