-- ============================================================
-- Migration 007: 신규 가입 시 기본 크레딧 500 설정
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

-- 1. profiles 테이블의 credits 기본값을 500으로 변경
alter table public.profiles
  alter column credits set default 500;

-- 2. 신규 유저 가입 시 profiles 행을 자동 생성하는 트리거 함수
--    (이미 있으면 교체, txtrpg에 동일 트리거가 있어도 or replace로 덮어씀)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, credits)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    500
  )
  on conflict (id) do nothing;  -- 이미 프로필이 있으면 건드리지 않음
  return new;
end;
$$;

-- 3. 트리거 연결 (없으면 생성, 있으면 재생성)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
