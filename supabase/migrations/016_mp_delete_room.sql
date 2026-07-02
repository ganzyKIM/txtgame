-- ============================================================
-- Migration 016: 방장이 자기 방 직접 삭제
--   mp_leave_room은 멤버 레코드가 남아있어야 동작하지만
--   이 함수는 host_id만 확인하여 고스트 방도 삭제 가능
-- ============================================================

create or replace function public.mp_delete_room(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.mp_rooms
  where id = p_room_id and host_id = auth.uid();
end;
$$;

grant execute on function public.mp_delete_room(uuid) to authenticated;
