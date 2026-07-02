-- ============================================================
-- Migration 015: 호스트 이탈 시 방 즉시 삭제
--   기존: 호스트 이탈 → 다음 멤버에게 호스트 이전
--   변경: 호스트 이탈 → 방 삭제 (mp_members cascade)
-- ============================================================

create or replace function public.mp_leave_room(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_host boolean;
begin
  delete from public.mp_members
  where room_id = p_room_id and user_id = auth.uid()
  returning is_host into v_is_host;

  -- 호스트가 나가면 방 삭제 (on delete cascade → mp_members 도 함께 삭제)
  -- 호스트가 아니어도 마지막 멤버였으면 방 삭제
  if v_is_host
     or not exists (select 1 from public.mp_members where room_id = p_room_id)
  then
    delete from public.mp_rooms where id = p_room_id;
  end if;
end;
$$;

grant execute on function public.mp_leave_room(uuid) to authenticated;
