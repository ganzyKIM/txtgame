-- ============================================================
-- Migration 023: 대합전 방 자동 정리 (pg_cron 없이)
--
--   [문제] 018_mp_room_auto_cleanup.sql이 pg_cron으로 설계됐는데
--   실제 DB에 pg_cron 익스텐션도, mp_cleanup_stale_rooms() 함수도
--   존재하지 않았음(무료 플랜이라 pg_cron 자체가 지원 안 될 가능성 높음).
--   그 결과 대기 중(waiting) 방이 5일 넘게, 게임 중(playing) 방도
--   9일 넘게 방치된 채 하나도 정리되지 않고 있었음.
--
--   [해결] 크론 대신 "누군가 대기실 화면을 열 때 정리"하는 방식으로
--   전환. 대기실은 자주 열리는 화면이라 사실상 크론보다 더 자주,
--   확실하게 정리된다. 클라이언트가 방 목록을 불러올 때마다
--   fire-and-forget으로 이 함수를 호출한다.
--
--   기준: 유저 요청대로 "1시간 이상 무활동"으로 통일.
--     - waiting: 방 생성(created_at) 후 1시간
--     - playing: 마지막 라운드 시작(없으면 게임 시작 시각) 후 1시간
--       — 정상적으로 진행 중인 게임은 라운드가 계속 갱신되므로
--         무활동 기준을 써야 "플레이 오래 하는 방"을 잘못 지우지 않는다.
-- ============================================================

create or replace function public.mp_cleanup_stale_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 대기실에서 1시간 이상 방치된 방(아무도 시작 안 함 = 고스트 방)
  delete from public.mp_rooms
  where status = 'waiting'
    and created_at < now() - interval '1 hour';

  -- 게임 중인데 마지막 라운드로부터 1시간 이상 무활동인 방
  -- (라운드가 하나도 없으면 게임 시작 시각 기준)
  delete from public.mp_rooms r
  where r.status = 'playing'
    and coalesce(
      (select max(rd.created_at) from public.mp_rounds rd where rd.room_id = r.id),
      r.started_at
    ) < now() - interval '1 hour';
end;
$$;

grant execute on function public.mp_cleanup_stale_rooms() to authenticated;

-- pg_cron 기반 스케줄이 혹시 남아있으면 정리(있었어도 애초에 동작 안 했음)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mp-cleanup-stale-rooms') then
      perform cron.unschedule('mp-cleanup-stale-rooms');
    end if;
  end if;
end $$;
