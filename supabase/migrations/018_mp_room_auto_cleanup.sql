-- ============================================================
-- Migration 018: 고스트 대합전 방 자동 정리 (pg_cron)
--
--   호스트가 브라우저를 그냥 닫는 등 mp_leave_room이 호출되지 않으면
--   방이 영구히 waiting 상태로 남는다. 016의 수동 삭제 버튼은 그대로 두고,
--   매시간 자동으로 방치된 방을 청소하는 배치 작업을 추가한다.
-- ============================================================

create extension if not exists pg_cron;

create or replace function public.mp_cleanup_stale_rooms()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 대기실에서 1시간 이상 방치된 방(아무도 시작 안 함 = 고스트 방)
  delete from public.mp_rooms
  where status = 'waiting'
    and created_at < now() - interval '1 hour';

  -- 게임 중 상태로 3시간 이상 멈춘 방(비정상 종료로 finished 처리가 안 된 경우)
  delete from public.mp_rooms
  where status = 'playing'
    and started_at < now() - interval '3 hours';
end;
$$;

-- 재실행 가능하도록 기존 스케줄이 있으면 먼저 해제
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mp-cleanup-stale-rooms') then
    perform cron.unschedule('mp-cleanup-stale-rooms');
  end if;
end $$;

select cron.schedule(
  'mp-cleanup-stale-rooms',
  '0 * * * *', -- 매시 정각
  $$select public.mp_cleanup_stale_rooms();$$
);
