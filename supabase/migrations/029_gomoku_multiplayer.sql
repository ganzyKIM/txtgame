-- ============================================================
-- Migration 029: 오목 멀티플레이 (렌주 룰)
--
--   [홀덤 멀티와 다른 점] 오목은 숨길 정보가 없다. 판이 양쪽에 다 보이므로
--   홀덤처럼 "손패를 서버에만 두는" 구조가 필요 없다. 그래서 착수 기록을
--   그대로 공개 테이블에 넣고 realtime으로 동기화한다 — 훨씬 단순하다.
--
--   [서버가 검증하는 것] 차례(착수 수의 홀짝), 빈 칸인지, 방 상태, 제한시간,
--   그리고 5목 승리 판정까지 서버가 한다. 이러면 클라이언트가 임의로
--   "내가 이겼다"고 주장할 수 없다.
--
--   [서버가 검증하지 않는 것] 렌주 금수(삼삼·사사·장목)는 클라이언트가
--   막는다. SQL로 금수 판정을 다시 구현하는 비용이 크고, 양쪽 클라이언트가
--   같은 엔진(src/game/gomoku/engine.ts)으로 같은 금수 표시를 보기 때문에
--   정상 플레이에서는 문제가 없다. 다만 개조한 클라이언트는 금수를 둘 수
--   있다 — 지인끼리 두는 캐주얼 게임 수준에서 감수하는 트레이드오프다.
--   (흑의 장목은 서버 승리 판정에서 5목으로 인정하지 않으므로 부분적으로는
--    서버도 렌주를 반영한다.)
--
--   [제한시간] 방마다 turn_seconds(10초 단위)를 정한다. 한 수를 둘 때마다
--   turn_started_at을 now()로 갱신하고, 시간이 지나면 상대가
--   gomoku_claim_timeout으로 승리를 주장할 수 있다. 판정은 서버 시계로만
--   하므로 클라이언트 시계를 조작해 미리 이길 수는 없다.
-- ============================================================

create table if not exists public.gomoku_rooms (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid references auth.users(id) on delete cascade,
  host_nickname   text not null,
  status          text not null default 'waiting',   -- waiting | playing | finished
  -- 한 수 제한시간(초). 10초 단위로만 받는다.
  turn_seconds    int  not null default 30,
  -- 현재 차례가 시작된 시각. 남은 시간 = turn_seconds - (now() - turn_started_at)
  turn_started_at timestamptz,
  -- 0=흑, 1=백. 승부가 나면 채워진다. 무승부는 'draw'
  winner_seat     int,
  result          text,                              -- win | draw | resign | timeout
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  constraint gomoku_turn_seconds_step check (turn_seconds between 10 and 300 and turn_seconds % 10 = 0)
);

-- 좌석: 0=흑(선공), 1=백. 오목은 2인 고정.
create table if not exists public.gomoku_members (
  room_id    uuid not null references public.gomoku_rooms(id) on delete cascade,
  seat_index int  not null check (seat_index in (0, 1)),
  user_id    uuid not null references auth.users(id) on delete cascade,
  nickname   text not null,
  is_host    boolean not null default false,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  primary key (room_id, seat_index)
);
-- 한 사람이 같은 방에 두 자리를 잡지 못하게
create unique index if not exists gomoku_members_one_seat_per_user
  on public.gomoku_members (room_id, user_id) where left_at is null;

create table if not exists public.gomoku_moves (
  room_id    uuid not null references public.gomoku_rooms(id) on delete cascade,
  move_no    int  not null,          -- 0부터. 짝수=흑, 홀수=백
  seat_index int  not null check (seat_index in (0, 1)),
  r          int  not null check (r between 0 and 14),
  c          int  not null check (c between 0 and 14),
  created_at timestamptz not null default now(),
  primary key (room_id, move_no),
  unique (room_id, r, c)             -- 같은 칸에 두 번 못 둔다 (경합도 여기서 막힌다)
);

create table if not exists public.gomoku_chat (
  id         bigint generated always as identity primary key,
  room_id    uuid references public.gomoku_rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  nickname   text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

alter table public.gomoku_rooms   enable row level security;
alter table public.gomoku_members enable row level security;
alter table public.gomoku_moves   enable row level security;
alter table public.gomoku_chat    enable row level security;

-- 오목은 비밀 정보가 없으므로 전부 조회 허용 (쓰기는 아래 RPC로만)
create policy "gomoku_rooms 조회"   on public.gomoku_rooms   for select to authenticated using (true);
create policy "gomoku_members 조회" on public.gomoku_members for select to authenticated using (true);
create policy "gomoku_moves 조회"   on public.gomoku_moves   for select to authenticated using (true);
create policy "gomoku_chat 조회"    on public.gomoku_chat    for select to authenticated using (true);

alter publication supabase_realtime add table public.gomoku_rooms;
alter publication supabase_realtime add table public.gomoku_members;
alter publication supabase_realtime add table public.gomoku_moves;
alter publication supabase_realtime add table public.gomoku_chat;

-- ============================================================
-- RPC ①: 방 생성 (개설자가 흑=0번 좌석)
-- ============================================================
create or replace function public.gomoku_create_room(
  p_nickname     text,
  p_turn_seconds int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_room_id uuid;
begin
  if p_turn_seconds is null or p_turn_seconds < 10 or p_turn_seconds > 300 or p_turn_seconds % 10 <> 0 then
    raise exception '제한시간은 10초 단위로 10~300초 사이여야 함';
  end if;

  insert into public.gomoku_rooms (host_id, host_nickname, turn_seconds)
  values (auth.uid(), p_nickname, p_turn_seconds)
  returning id into v_room_id;

  insert into public.gomoku_members (room_id, seat_index, user_id, nickname, is_host)
  values (v_room_id, 0, auth.uid(), p_nickname, true);

  return v_room_id;
end; $$;
grant execute on function public.gomoku_create_room(text,int) to authenticated;

-- ============================================================
-- RPC ②: 방 참가 (빈 좌석에 앉는다 — 보통 백=1번)
-- ============================================================
create or replace function public.gomoku_join_room(
  p_room_id  uuid,
  p_nickname text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_seat int;
begin
  select status into v_status from public.gomoku_rooms where id = p_room_id;
  if v_status is null then return json_build_object('ok', false, 'error', '방 없음'); end if;

  -- 이미 앉아있으면 그 좌석으로 재입장 (새로고침 대비)
  select seat_index into v_seat from public.gomoku_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat is not null then
    return json_build_object('ok', true, 'seat', v_seat, 'rejoined', true);
  end if;

  if v_status <> 'waiting' then return json_build_object('ok', false, 'error', '이미 시작된 대국'); end if;

  select min(s) into v_seat from generate_series(0, 1) s
    where not exists (
      select 1 from public.gomoku_members m
      where m.room_id = p_room_id and m.seat_index = s and m.left_at is null
    );
  if v_seat is null then return json_build_object('ok', false, 'error', '자리가 없어'); end if;

  insert into public.gomoku_members (room_id, seat_index, user_id, nickname)
  values (p_room_id, v_seat, auth.uid(), p_nickname);

  return json_build_object('ok', true, 'seat', v_seat);
end; $$;
grant execute on function public.gomoku_join_room(uuid,text) to authenticated;

-- ============================================================
-- RPC ③: 대국 시작 (호스트 전용, 2명 다 앉아야 함)
-- ============================================================
create or replace function public.gomoku_start_game(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (select 1 from public.gomoku_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', '호스트만 시작할 수 있어');
  end if;

  select count(*) into v_count from public.gomoku_members
  where room_id = p_room_id and left_at is null;
  if v_count < 2 then return json_build_object('ok', false, 'error', '2명이 모여야 시작할 수 있어'); end if;

  update public.gomoku_rooms
  set status = 'playing', started_at = coalesce(started_at, now()), turn_started_at = now()
  where id = p_room_id and status = 'waiting';

  return json_build_object('ok', true);
end; $$;
grant execute on function public.gomoku_start_game(uuid) to authenticated;

-- ============================================================
-- 내부 헬퍼: (r,c)에 seat이 방금 둔 뒤 5목이 완성됐는지
--   렌주 — 흑(0)은 정확히 5, 백(1)은 5 이상이면 승리.
-- ============================================================
create or replace function public.gomoku_is_win(
  p_room_id uuid, p_seat int, p_r int, p_c int
) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_dirs int[][] := array[array[0,1], array[1,0], array[1,1], array[1,-1]];
  v_i int; v_sign int; v_k int;
  v_dr int; v_dc int;
  v_count int;
begin
  for v_i in 1..4 loop
    v_dr := v_dirs[v_i][1];
    v_dc := v_dirs[v_i][2];
    v_count := 1;
    foreach v_sign in array array[1, -1] loop
      v_k := 1;
      while exists (
        select 1 from public.gomoku_moves
        where room_id = p_room_id and seat_index = p_seat
          and r = p_r + v_dr * v_k * v_sign
          and c = p_c + v_dc * v_k * v_sign
      ) loop
        v_count := v_count + 1;
        v_k := v_k + 1;
      end loop;
    end loop;

    if p_seat = 0 then
      if v_count = 5 then return true; end if;   -- 흑: 장목은 승리 아님
    else
      if v_count >= 5 then return true; end if;  -- 백: 제약 없음
    end if;
  end loop;
  return false;
end; $$;

-- ============================================================
-- RPC ④: 착수
--   차례·빈칸·제한시간을 서버가 검증하고, 승리 판정까지 서버가 한다.
-- ============================================================
create or replace function public.gomoku_place(
  p_room_id uuid, p_r int, p_c int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_seat int; v_status text; v_turn_seconds int; v_turn_started timestamptz;
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

  select seat_index into v_seat from public.gomoku_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat is null then return json_build_object('ok', false, 'error', '이 방의 대국자가 아니야'); end if;

  select count(*) into v_move_no from public.gomoku_moves where room_id = p_room_id;
  v_expected := v_move_no % 2;   -- 0수=흑, 1수=백, ...
  if v_seat <> v_expected then return json_build_object('ok', false, 'error', '아직 네 차례가 아니야'); end if;

  -- 시간 초과 상태에서 들어온 착수는 거부한다. 네트워크 지연을 감안해 2초 여유.
  if v_turn_started is not null
     and now() > v_turn_started + ((v_turn_seconds + 2) * interval '1 second') then
    return json_build_object('ok', false, 'error', '시간이 초과됐어');
  end if;

  begin
    insert into public.gomoku_moves (room_id, move_no, seat_index, r, c)
    values (p_room_id, v_move_no, v_seat, p_r, p_c);
  exception when unique_violation then
    -- (room_id,r,c) 중복 = 이미 돌이 있는 칸 / (room_id,move_no) 중복 = 동시 착수 경합
    return json_build_object('ok', false, 'error', '이미 돌이 있거나 방금 다른 수가 들어왔어');
  end;

  v_win := public.gomoku_is_win(p_room_id, v_seat, p_r, p_c);
  select count(*) into v_total from public.gomoku_moves where room_id = p_room_id;

  if v_win then
    update public.gomoku_rooms
    set status = 'finished', winner_seat = v_seat, result = 'win', finished_at = now(), turn_started_at = null
    where id = p_room_id;
    return json_build_object('ok', true, 'win', true, 'seat', v_seat);
  end if;

  if v_total >= 225 then
    update public.gomoku_rooms
    set status = 'finished', result = 'draw', finished_at = now(), turn_started_at = null
    where id = p_room_id;
    return json_build_object('ok', true, 'draw', true);
  end if;

  -- 다음 차례 시작 — 제한시간 카운트 리셋
  update public.gomoku_rooms set turn_started_at = now() where id = p_room_id;
  return json_build_object('ok', true, 'moveNo', v_move_no);
end; $$;
grant execute on function public.gomoku_place(uuid,int,int) to authenticated;

-- ============================================================
-- RPC ⑤: 시간 초과 승리 주장
--   서버 시계로만 판정하므로 클라이언트가 앞당길 수 없다.
-- ============================================================
create or replace function public.gomoku_claim_timeout(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_seat int; v_status text; v_turn_seconds int; v_turn_started timestamptz;
  v_move_no int; v_to_act int;
begin
  select status, turn_seconds, turn_started_at
    into v_status, v_turn_seconds, v_turn_started
  from public.gomoku_rooms where id = p_room_id for update;
  if v_status is null then return json_build_object('ok', false, 'error', '방 없음'); end if;
  if v_status <> 'playing' then return json_build_object('ok', false, 'error', '진행 중인 대국이 아니야'); end if;
  if v_turn_started is null then return json_build_object('ok', false, 'error', '차례 시작 시각이 없어'); end if;

  select seat_index into v_seat from public.gomoku_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat is null then return json_build_object('ok', false, 'error', '이 방의 대국자가 아니야'); end if;

  select count(*) into v_move_no from public.gomoku_moves where room_id = p_room_id;
  v_to_act := v_move_no % 2;
  -- 시간을 넘긴 쪽은 "지금 둘 차례인 사람"이다. 그 사람 본인은 주장할 수 없다.
  if v_to_act = v_seat then return json_build_object('ok', false, 'error', '네가 둘 차례야'); end if;

  if now() <= v_turn_started + (v_turn_seconds * interval '1 second') then
    return json_build_object('ok', false, 'error', '아직 시간이 남았어');
  end if;

  update public.gomoku_rooms
  set status = 'finished', winner_seat = v_seat, result = 'timeout', finished_at = now(), turn_started_at = null
  where id = p_room_id and status = 'playing';

  return json_build_object('ok', true, 'winnerSeat', v_seat);
end; $$;
grant execute on function public.gomoku_claim_timeout(uuid) to authenticated;

-- ============================================================
-- RPC ⑥: 기권
-- ============================================================
create or replace function public.gomoku_resign(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seat int; v_other int;
begin
  select seat_index into v_seat from public.gomoku_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat is null then return json_build_object('ok', false, 'error', '이 방의 대국자가 아니야'); end if;
  v_other := 1 - v_seat;

  update public.gomoku_rooms
  set status = 'finished', winner_seat = v_other, result = 'resign', finished_at = now(), turn_started_at = null
  where id = p_room_id and status = 'playing';

  return json_build_object('ok', true, 'winnerSeat', v_other);
end; $$;
grant execute on function public.gomoku_resign(uuid) to authenticated;

-- ============================================================
-- RPC ⑦: 재대국 (같은 방에서 새 판 — 흑백을 서로 바꾼다)
--   선공이 유리하니 한쪽이 계속 흑을 잡으면 불공평하다.
-- ============================================================
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

  -- 좌석 교체: 0↔1. primary key 충돌을 피하려고 임시값(2)을 거친다.
  update public.gomoku_members set seat_index = 2 where room_id = p_room_id and seat_index = 0;
  update public.gomoku_members set seat_index = 0 where room_id = p_room_id and seat_index = 1;
  update public.gomoku_members set seat_index = 1 where room_id = p_room_id and seat_index = 2;

  update public.gomoku_rooms
  set status = 'playing', winner_seat = null, result = null, finished_at = null,
      turn_started_at = now(), started_at = now()
  where id = p_room_id;

  return json_build_object('ok', true);
end; $$;
grant execute on function public.gomoku_rematch(uuid) to authenticated;

-- ============================================================
-- RPC ⑧: 방 퇴장
--   진행 중이면 남은 사람의 승리로 끝낸다. 아무도 없으면 방을 지운다.
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

  -- 대국 중 이탈은 상대 승리 처리
  if v_status = 'playing' then
    update public.gomoku_rooms
    set status = 'finished', winner_seat = 1 - v_seat, result = 'resign',
        finished_at = now(), turn_started_at = null
    where id = p_room_id;
  end if;

  if not exists (select 1 from public.gomoku_members where room_id = p_room_id and left_at is null) then
    delete from public.gomoku_rooms where id = p_room_id;  -- CASCADE로 나머지도 정리
    return;
  end if;

  if v_was_host then
    select user_id, nickname into v_next, v_next_nick
    from public.gomoku_members
    where room_id = p_room_id and left_at is null
    order by joined_at limit 1;

    update public.gomoku_members set is_host = true where room_id = p_room_id and user_id = v_next;
    update public.gomoku_rooms set host_id = v_next, host_nickname = v_next_nick where id = p_room_id;
  end if;
end; $$;
grant execute on function public.gomoku_leave_room(uuid) to authenticated;

-- ============================================================
-- RPC ⑨: 방 채팅
-- ============================================================
create or replace function public.gomoku_send_chat(
  p_room_id uuid,
  p_message text
) returns void language plpgsql security definer set search_path = public as $$
declare v_nick text;
begin
  select nickname into v_nick from public.gomoku_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_nick is null then return; end if;
  insert into public.gomoku_chat (room_id, user_id, nickname, message)
  values (p_room_id, auth.uid(), v_nick, left(p_message, 200));
end; $$;
grant execute on function public.gomoku_send_chat(uuid,text) to authenticated;
