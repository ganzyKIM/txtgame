-- ============================================================
-- Migration 031: 오목 멀티 재대국 시 좌석 스왑 오류 수정
--
--   [버그] gomoku_rematch가 흑/백 좌석을 바꿀 때 기본키(room_id,
--   seat_index) 충돌을 피하려고 seat_index를 0→2→1 순서로 거쳐갔는데,
--   seat_index에는 "0 또는 1만 허용"하는 CHECK 제약이 걸려 있어서
--   임시값 2를 쓰는 순간 그 자리에서 바로 위반이 났다.
--   ("new row ... violates check constraint gomoku_members_seat_index_check")
--
--   [왜 이전 방식이 필요했나] 두 행의 유니크 키를 서로 맞바꾸는 건
--   PostgreSQL에서 흔한 함정이다 — 한 문장으로 스왑해도 유니크 인덱스는
--   행 단위로 즉시 검사되기 때문에 중간에 일시적으로 키가 겹치는 순간이
--   생기면 실패한다. 반대로 CHECK 제약은 PostgreSQL에서 애초에 지연
--   (deferred) 검사를 지원하지 않는다 — 그래서 "값은 항상 0/1 안에만
--   머물게 하고, 대신 기본키 검사를 문장 끝까지 미룬다"는 방향으로
--   고친다: 기본키를 deferrable로 바꾸고, 한 번의 UPDATE로 스왑한다
--   (각 행은 자기 자신의 값만으로 0↔1을 뒤집으므로 2를 거치지 않음).
-- ============================================================

alter table public.gomoku_members drop constraint if exists gomoku_members_pkey;
alter table public.gomoku_members add constraint gomoku_members_pkey
  primary key (room_id, seat_index) deferrable initially immediate;

create or replace function public.gomoku_rematch(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (select 1 from public.gomoku_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', '호스트만 다시 시작할 수 있어');
  end if;
  if not exists (select 1 from public.gomoku_rooms where id = p_room_id and status = 'finished') then
    return json_build_object('ok', false, 'error', '끝난 대국만 다시 시작할 수 있어');
  end if;

  select count(*) into v_count from public.gomoku_members
  where room_id = p_room_id and left_at is null;
  if v_count < 2 then return json_build_object('ok', false, 'error', '상대가 나갔어'); end if;

  delete from public.gomoku_moves where room_id = p_room_id;

  -- 좌석 교체: 0↔1. 기본키 검사를 이 트랜잭션이 끝날 때까지 미뤄서,
  -- 한 번의 UPDATE로 두 행의 seat_index를 동시에 뒤집어도 안전하게 한다.
  -- (seat_index는 절대 0/1 밖으로 나가지 않으므로 CHECK 제약도 항상 통과)
  set constraints public.gomoku_members_pkey deferred;
  update public.gomoku_members
  set seat_index = case seat_index when 0 then 1 else 0 end
  where room_id = p_room_id and seat_index in (0, 1);

  update public.gomoku_rooms
  set status = 'playing', winner_seat = null, result = null, finished_at = null,
      turn_started_at = now(), started_at = now()
  where id = p_room_id;

  return json_build_object('ok', true);
end; $$;
grant execute on function public.gomoku_rematch(uuid) to authenticated;
