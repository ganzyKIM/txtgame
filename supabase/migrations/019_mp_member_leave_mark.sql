-- ============================================================
-- Migration 019: 참여자 이탈 시 삭제 대신 "나감" 마킹
--   - 대기실(waiting)에서 나가면: 기존처럼 즉시 삭제
--   - 게임 중(playing)에 호스트가 나가면: 방 전체 삭제 (기존 동작 유지)
--   - 게임 중에 참여자(비호스트)가 나가면: 삭제 대신 left_at 기록,
--     게임은 계속 진행되고 UI에서 "나감"으로 표시
-- ============================================================

alter table public.mp_members add column if not exists left_at timestamptz;

create or replace function public.mp_leave_room(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_host boolean;
  v_status text;
begin
  select is_host into v_is_host
  from public.mp_members
  where room_id = p_room_id and user_id = auth.uid();

  if v_is_host is null then
    return; -- 이미 나갔거나 멤버가 아님
  end if;

  select status into v_status from public.mp_rooms where id = p_room_id;

  if v_is_host then
    -- 호스트 이탈: 방 전체 삭제 (cascade → mp_members 도 함께 삭제)
    delete from public.mp_rooms where id = p_room_id;
  elsif v_status = 'playing' then
    -- 게임 진행 중 참여자 이탈: 삭제 대신 "나감" 마킹, 게임 계속 진행
    update public.mp_members set left_at = now()
    where room_id = p_room_id and user_id = auth.uid();
  else
    -- 대기실/종료 상태에서 참여자 이탈: 기존처럼 즉시 삭제
    delete from public.mp_members
    where room_id = p_room_id and user_id = auth.uid();

    if not exists (select 1 from public.mp_members where room_id = p_room_id) then
      delete from public.mp_rooms where id = p_room_id;
    end if;
  end if;
end;
$$;

grant execute on function public.mp_leave_room(uuid) to authenticated;
