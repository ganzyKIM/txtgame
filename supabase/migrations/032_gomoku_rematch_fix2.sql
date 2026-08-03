-- ============================================================
-- Migration 032: 재대국 좌석 교체 — 031의 DEFERRABLE 접근법을 폐기하고 재작성
--
--   [031이 왜 틀렸나] 031은 기본키를 DEFERRABLE로 바꿔서 한 번의 UPDATE로
--   좌석을 맞바꾸려 했다. 그런데 gomoku_members는 029에서 realtime
--   publication에 포함시켰고, PostgreSQL은 "DEFERRABLE 인덱스는 복제
--   아이덴티티로 쓸 수 없다"고 못박고 있다. 그 결과 PK를 deferrable로
--   바꾸는 순간 이 테이블에 대한 모든 UPDATE가 거부된다:
--     "cannot update table ... does not have a replica identity and
--      publishes updates"
--   즉 deferrable은 realtime을 켠 테이블에서는 애초에 못 쓰는 카드였다.
--
--   [이번 방식] PK를 원래(비-deferrable)로 되돌리고, 좌석 교체를 UPDATE가
--   아니라 "두 행을 DELETE한 뒤 seat_index만 바꿔 다시 INSERT"로 한다.
--     · seat_index가 0/1 밖으로 나가지 않는다      → CHECK 제약 통과
--     · 삭제가 먼저 끝난 뒤 삽입한다               → PK 충돌 없음
--     · PK가 다시 비-deferrable이다                → 복제 아이덴티티 정상
--   DELETE와 INSERT를 (data-modifying CTE가 아니라) 별개의 문장으로 두는
--   것이 핵심이다 — CTE 안에 같이 넣으면 두 하위문장이 서로의 결과를 보지
--   못해서 유니크 충돌이 날 수 있다.
-- ============================================================

-- 031이 남긴 deferrable 기본키를 원상복구
alter table public.gomoku_members drop constraint if exists gomoku_members_pkey;
alter table public.gomoku_members add constraint gomoku_members_pkey
  primary key (room_id, seat_index);

create or replace function public.gomoku_rematch(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_rows  public.gomoku_members[];
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

  -- 좌석 교체(0↔1): 지웠다가 다시 넣는다. 세 문장의 순서가 보장돼야 하므로
  -- 일부러 CTE로 합치지 않는다.
  select coalesce(array_agg(m), '{}') into v_rows
  from public.gomoku_members m
  where m.room_id = p_room_id and m.seat_index in (0, 1);

  delete from public.gomoku_members
  where room_id = p_room_id and seat_index in (0, 1);

  insert into public.gomoku_members
    (room_id, seat_index, user_id, nickname, is_host, joined_at, left_at, is_bot, bot_form)
  select m.room_id, 1 - m.seat_index, m.user_id, m.nickname, m.is_host,
         m.joined_at, m.left_at, m.is_bot, m.bot_form
  from unnest(v_rows) as m;

  update public.gomoku_rooms
  set status = 'playing', winner_seat = null, result = null, finished_at = null,
      turn_started_at = now(), started_at = now()
  where id = p_room_id;

  return json_build_object('ok', true);
end; $$;
grant execute on function public.gomoku_rematch(uuid) to authenticated;
