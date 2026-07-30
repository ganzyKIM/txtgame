-- ============================================================
-- Migration 030: 오목 멀티 — 초텐쨩/아메 봇 상대 추가 (테스트용)
--
--   [설계] 홀덤 멀티의 봇과 같은 패턴: 좌석에 사람 대신 봇이 앉을 수
--   있게 gomoku_members를 확장한다(user_id nullable + is_bot/bot_form).
--   봇의 착수는 여전히 서버가 검증한다 — 다만 "누가 뒀는지"를 auth.uid()로
--   알아낼 수 없으니(봇은 세션이 없다), 호스트 브라우저가 클라이언트
--   엔진(src/game/gomoku/engine.ts, 싱글과 동일)으로 수를 계산해 대신
--   제출하는 gomoku_place_as_bot을 새로 둔다. 차례·빈칸·제한시간·승리
--   검증 로직 자체는 기존 gomoku_place와 완전히 같아야 하므로, 그 로직을
--   gomoku_place_internal로 뽑아 두 진입점이 공유한다.
--
--   [렌주] 봇이 흑을 잡으면 금수를 피해야 하는데, engine.ts의
--   chooseAiMove가 싱글과 동일하게 이미 처리한다(호스트가 그대로 재사용).
-- ============================================================

alter table public.gomoku_members alter column user_id drop not null;
alter table public.gomoku_members add column if not exists is_bot   boolean not null default false;
alter table public.gomoku_members add column if not exists bot_form text;

do $$ begin
  alter table public.gomoku_members add constraint gomoku_members_bot_shape check (
    (is_bot = true  and user_id is null     and bot_form in ('choten','ame'))
    or
    (is_bot = false and user_id is not null and bot_form is null)
  );
exception when duplicate_object then null; end $$;

-- ============================================================
-- RPC: 봇 추가 (호스트 전용) — 빈 좌석에 초텐쨩/아메를 앉힌다
-- ============================================================
create or replace function public.gomoku_add_bot(
  p_room_id uuid, p_form text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_seat int; v_nickname text;
begin
  if p_form not in ('choten', 'ame') then
    return json_build_object('ok', false, 'error', '알 수 없는 봇');
  end if;
  if not exists (select 1 from public.gomoku_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', '호스트만 봇을 넣을 수 있어');
  end if;

  select status into v_status from public.gomoku_rooms where id = p_room_id;
  if v_status <> 'waiting' then return json_build_object('ok', false, 'error', '대기 중일 때만 봇을 넣을 수 있어'); end if;

  select min(s) into v_seat from generate_series(0, 1) s
    where not exists (
      select 1 from public.gomoku_members m
      where m.room_id = p_room_id and m.seat_index = s and m.left_at is null
    );
  if v_seat is null then return json_build_object('ok', false, 'error', '자리가 없어'); end if;

  v_nickname := case p_form when 'choten' then '초텐쨩' else '아메' end;

  insert into public.gomoku_members (room_id, seat_index, user_id, nickname, is_host, is_bot, bot_form)
  values (p_room_id, v_seat, null, v_nickname, false, true, p_form);

  return json_build_object('ok', true, 'seat', v_seat);
end; $$;
grant execute on function public.gomoku_add_bot(uuid,text) to authenticated;

-- ============================================================
-- RPC: 봇 제거 (호스트 전용)
-- ============================================================
create or replace function public.gomoku_remove_bot(
  p_room_id uuid, p_seat int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.gomoku_rooms where id = p_room_id and host_id = auth.uid() and status = 'waiting') then
    raise exception 'not host or already started';
  end if;
  delete from public.gomoku_members
  where room_id = p_room_id and seat_index = p_seat and is_bot = true;
end; $$;
grant execute on function public.gomoku_remove_bot(uuid,int) to authenticated;

-- ============================================================
-- 내부 함수: 착수 검증·적용의 실제 로직 (좌석을 파라미터로 받는다)
--   gomoku_place(사람, auth.uid()로 좌석 추론)와
--   gomoku_place_as_bot(호스트가 봇 대신, 좌석을 직접 지정)이 공유한다.
-- ============================================================
create or replace function public.gomoku_place_internal(
  p_room_id uuid, p_seat int, p_r int, p_c int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_turn_seconds int; v_turn_started timestamptz;
  v_move_no int; v_expected int; v_win boolean; v_total int;
begin
  if p_r < 0 or p_r > 14 or p_c < 0 or p_c > 14 then
    return json_build_object('ok', false, 'error', '판 밖');
  end if;

  select status, turn_seconds, turn_started_at
    into v_status, v_turn_seconds, v_turn_started
  from public.gomoku_rooms where id = p_room_id for update;
  if v_status is null then return json_build_object('ok', false, 'error', '방 없음'); end if;
  if v_status <> 'playing' then return json_build_object('ok', false, 'error', '진행 중인 대국이 아니야'); end if;

  select count(*) into v_move_no from public.gomoku_moves where room_id = p_room_id;
  v_expected := v_move_no % 2;
  if p_seat <> v_expected then return json_build_object('ok', false, 'error', '아직 그 좌석의 차례가 아니야'); end if;

  if v_turn_started is not null
     and now() > v_turn_started + ((v_turn_seconds + 2) * interval '1 second') then
    return json_build_object('ok', false, 'error', '시간이 초과됐어');
  end if;

  begin
    insert into public.gomoku_moves (room_id, move_no, seat_index, r, c)
    values (p_room_id, v_move_no, p_seat, p_r, p_c);
  exception when unique_violation then
    return json_build_object('ok', false, 'error', '이미 돌이 있거나 방금 다른 수가 들어왔어');
  end;

  v_win := public.gomoku_is_win(p_room_id, p_seat, p_r, p_c);
  select count(*) into v_total from public.gomoku_moves where room_id = p_room_id;

  if v_win then
    update public.gomoku_rooms
    set status = 'finished', winner_seat = p_seat, result = 'win', finished_at = now(), turn_started_at = null
    where id = p_room_id;
    return json_build_object('ok', true, 'win', true, 'seat', p_seat);
  end if;

  if v_total >= 225 then
    update public.gomoku_rooms
    set status = 'finished', result = 'draw', finished_at = now(), turn_started_at = null
    where id = p_room_id;
    return json_build_object('ok', true, 'draw', true);
  end if;

  update public.gomoku_rooms set turn_started_at = now() where id = p_room_id;
  return json_build_object('ok', true, 'moveNo', v_move_no);
end; $$;

-- gomoku_place: 사람 전용 — 좌석을 auth.uid()로 추론해 내부 함수에 위임
create or replace function public.gomoku_place(
  p_room_id uuid, p_r int, p_c int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seat int;
begin
  select seat_index into v_seat from public.gomoku_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null and is_bot = false;
  if v_seat is null then return json_build_object('ok', false, 'error', '이 방의 대국자가 아니야'); end if;
  return public.gomoku_place_internal(p_room_id, v_seat, p_r, p_c);
end; $$;
grant execute on function public.gomoku_place(uuid,int,int) to authenticated;

-- gomoku_place_as_bot: 호스트가 봇을 대신해 착수 (호스트 브라우저가 engine.ts로 계산한 수)
create or replace function public.gomoku_place_as_bot(
  p_room_id uuid, p_seat int, p_r int, p_c int
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.gomoku_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', '호스트만 봇을 대신 둘 수 있어');
  end if;
  if not exists (
    select 1 from public.gomoku_members
    where room_id = p_room_id and seat_index = p_seat and is_bot = true and left_at is null
  ) then
    return json_build_object('ok', false, 'error', '그 좌석은 봇이 아니야');
  end if;
  return public.gomoku_place_internal(p_room_id, p_seat, p_r, p_c);
end; $$;
grant execute on function public.gomoku_place_as_bot(uuid,int,int) to authenticated;

-- ============================================================
-- gomoku_leave_room 재정의: 봇만 남고 사람이 없으면 방을 정리한다.
--   기존 버전은 "아무도 없으면"을 봇 포함으로 셌기 때문에, 사람이 나가고
--   봇 혼자 남은 방이 목록에 유령처럼 남는 문제가 있었다.
-- ============================================================
create or replace function public.gomoku_leave_room(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_seat int; v_was_host boolean; v_status text; v_next uuid; v_next_nick text;
begin
  select status into v_status from public.gomoku_rooms where id = p_room_id;
  if v_status is null then return; end if;

  update public.gomoku_members set left_at = now()
  where room_id = p_room_id and user_id = auth.uid() and left_at is null
  returning seat_index, is_host into v_seat, v_was_host;
  if v_seat is null then return; end if;

  if v_status = 'playing' then
    update public.gomoku_rooms
    set status = 'finished', winner_seat = 1 - v_seat, result = 'resign',
        finished_at = now(), turn_started_at = null
    where id = p_room_id;
  end if;

  -- 사람이 아무도 안 남았으면(봇만 남았어도) 방을 지운다
  if not exists (
    select 1 from public.gomoku_members
    where room_id = p_room_id and left_at is null and is_bot = false
  ) then
    delete from public.gomoku_rooms where id = p_room_id;  -- CASCADE로 나머지도 정리
    return;
  end if;

  if v_was_host then
    select user_id, nickname into v_next, v_next_nick
    from public.gomoku_members
    where room_id = p_room_id and left_at is null and is_bot = false
    order by joined_at limit 1;

    update public.gomoku_members set is_host = true where room_id = p_room_id and user_id = v_next;
    update public.gomoku_rooms set host_id = v_next, host_nickname = v_next_nick where id = p_room_id;
  end if;
end; $$;
grant execute on function public.gomoku_leave_room(uuid) to authenticated;
