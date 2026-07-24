-- ============================================================
-- Migration 025: 홀덤 멀티 1단계 — 방/좌석/봇/채팅
--
--   [설계] holdem-plan.md §4 — 최대 4인, 서버 권위 필요(카드 은닉).
--   이 마이그레이션은 카드/베팅 로직 없이 "방을 만들고, 앉고, 봇을
--   채우고, 채팅하는" 부분만 다룬다(사람만으로도 완전히 동작).
--   카드/베팅 서버 엔진은 다음 마이그레이션(poker_hand_state 등)에서.
--
--   [칩] 싱글과 동일하게 poker_buy_in()으로 산 칩을 그대로 좌석에
--   앉을 때 스택으로 들고 온다(join_room에 p_stack으로 넘김 — 클라가
--   poker_buy_in 응답의 chips 값을 그대로 전달). 봇은 크레딧이 없으니
--   고정 스택(1000)을 서버가 바로 부여한다.
-- ============================================================

create table if not exists public.poker_rooms (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid references auth.users(id) on delete cascade,
  host_nickname text not null,
  status        text not null default 'waiting', -- waiting | playing | finished
  max_players   int  not null default 4,
  small_blind   int  not null default 10,
  big_blind     int  not null default 20,
  dealer_index  int  not null default 0,
  created_at    timestamptz not null default now(),
  started_at    timestamptz
);

-- 좌석 — 사람과 봇이 같은 테이블에 섞여 앉는다(is_bot으로 구분)
create table if not exists public.poker_members (
  room_id     uuid not null references public.poker_rooms(id) on delete cascade,
  seat_index  int  not null,
  user_id     uuid references auth.users(id) on delete cascade, -- 봇이면 null
  is_bot      boolean not null default false,
  bot_form    text, -- 'choten' | 'ame' (봇 좌석만)
  nickname    text not null,
  is_host     boolean not null default false,
  stack       int  not null default 0,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  primary key (room_id, seat_index),
  constraint poker_members_bot_shape check (
    (is_bot = true  and user_id is null     and bot_form in ('choten','ame'))
    or
    (is_bot = false and user_id is not null and bot_form is null)
  )
);

create table if not exists public.poker_chat (
  id         bigint generated always as identity primary key,
  room_id    uuid references public.poker_rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  nickname   text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

alter table public.poker_rooms   enable row level security;
alter table public.poker_members enable row level security;
alter table public.poker_chat    enable row level security;

create policy "poker_rooms 조회"   on public.poker_rooms   for select to authenticated using (true);
create policy "poker_members 조회" on public.poker_members for select to authenticated using (true);
create policy "poker_chat 조회"    on public.poker_chat    for select to authenticated using (true);

alter publication supabase_realtime add table public.poker_rooms;
alter publication supabase_realtime add table public.poker_members;
alter publication supabase_realtime add table public.poker_chat;

-- ============================================================
-- RPC ①: 방 생성 (호스트가 곧바로 0번 좌석에 앉는다)
-- ============================================================
create or replace function public.poker_create_room(
  p_nickname text,
  p_stack    int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_room_id uuid;
begin
  if p_stack <= 0 then raise exception '스택은 0보다 커야 함'; end if;

  insert into public.poker_rooms (host_id, host_nickname)
  values (auth.uid(), p_nickname)
  returning id into v_room_id;

  insert into public.poker_members (room_id, seat_index, user_id, is_bot, nickname, is_host, stack)
  values (v_room_id, 0, auth.uid(), false, p_nickname, true, p_stack);

  return v_room_id;
end; $$;
grant execute on function public.poker_create_room(text,int) to authenticated;

-- ============================================================
-- RPC ②: 방 참가 (비어있는 가장 낮은 좌석 번호에 앉는다)
-- ============================================================
create or replace function public.poker_join_room(
  p_room_id uuid,
  p_nickname text,
  p_stack   int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_max int; v_count int; v_seat int;
begin
  if p_stack <= 0 then return json_build_object('ok', false, 'error', '스택은 0보다 커야 함'); end if;

  select status, max_players into v_status, v_max from public.poker_rooms where id = p_room_id;
  if v_status is null then return json_build_object('ok', false, 'error', '방 없음'); end if;
  if v_status <> 'waiting' then return json_build_object('ok', false, 'error', '이미 시작됨'); end if;

  select count(*) into v_count from public.poker_members where room_id = p_room_id and left_at is null;
  if v_count >= v_max then return json_build_object('ok', false, 'error', '만원'); end if;

  if exists (select 1 from public.poker_members where room_id = p_room_id and user_id = auth.uid() and left_at is null) then
    return json_build_object('ok', true); -- 이미 앉아있으면 그냥 성공 처리(중복 클릭 방어)
  end if;

  -- 0..max_players-1 중 비어있는 가장 낮은 번호
  select min(s) into v_seat from generate_series(0, v_max - 1) s
    where not exists (
      select 1 from public.poker_members m
      where m.room_id = p_room_id and m.seat_index = s and m.left_at is null
    );
  if v_seat is null then return json_build_object('ok', false, 'error', '만원'); end if;

  insert into public.poker_members (room_id, seat_index, user_id, is_bot, nickname, is_host, stack)
  values (p_room_id, v_seat, auth.uid(), false, p_nickname, false, p_stack);

  return json_build_object('ok', true, 'seat', v_seat);
end; $$;
grant execute on function public.poker_join_room(uuid,text,int) to authenticated;

-- ============================================================
-- RPC ③: 봇 추가 (호스트 전용) — 빈 좌석에 초텐/아메를 앉힌다
-- ============================================================
create or replace function public.poker_add_bot(
  p_room_id uuid,
  p_form    text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max int; v_count int; v_seat int; v_nickname text;
  v_bot_stack constant int := 1000; -- 싱글 기본 바이인과 동일값(공용 상수는 나중에 정리)
begin
  if p_form not in ('choten','ame') then
    return json_build_object('ok', false, 'error', '알 수 없는 봇');
  end if;
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid() and status = 'waiting') then
    return json_build_object('ok', false, 'error', '호스트만, 대기 중일 때만 가능');
  end if;

  select max_players into v_max from public.poker_rooms where id = p_room_id;
  select count(*) into v_count from public.poker_members where room_id = p_room_id and left_at is null;
  if v_count >= v_max then return json_build_object('ok', false, 'error', '만원'); end if;

  select min(s) into v_seat from generate_series(0, v_max - 1) s
    where not exists (
      select 1 from public.poker_members m
      where m.room_id = p_room_id and m.seat_index = s and m.left_at is null
    );
  if v_seat is null then return json_build_object('ok', false, 'error', '만원'); end if;

  v_nickname := case p_form when 'choten' then '초텐쨩' else '아메' end;

  insert into public.poker_members (room_id, seat_index, user_id, is_bot, bot_form, nickname, is_host, stack)
  values (p_room_id, v_seat, null, true, p_form, v_nickname, false, v_bot_stack);

  return json_build_object('ok', true, 'seat', v_seat);
end; $$;
grant execute on function public.poker_add_bot(uuid,text) to authenticated;

-- ============================================================
-- RPC ④: 봇 제거 (호스트 전용)
-- ============================================================
create or replace function public.poker_remove_bot(
  p_room_id uuid,
  p_seat    int
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid() and status = 'waiting') then
    raise exception 'not host or already started';
  end if;
  delete from public.poker_members
  where room_id = p_room_id and seat_index = p_seat and is_bot = true;
end; $$;
grant execute on function public.poker_remove_bot(uuid,int) to authenticated;

-- ============================================================
-- RPC ⑤: 방 퇴장 — 호스트가 나가면 남은 "사람" 중 가장 먼저 온 사람에게 위임,
--         사람이 아무도 안 남으면(봇만 남거나 전원 이탈) 방을 지운다.
-- ============================================================
create or replace function public.poker_leave_room(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_was_host boolean; v_next_user uuid; v_next_nick text;
begin
  update public.poker_members set left_at = now()
  where room_id = p_room_id and user_id = auth.uid() and left_at is null
  returning is_host into v_was_host;

  if not exists (select 1 from public.poker_members where room_id = p_room_id and is_bot = false and left_at is null) then
    delete from public.poker_rooms where id = p_room_id; -- ON DELETE CASCADE로 members/chat도 정리됨
    return;
  end if;

  if v_was_host then
    select user_id, nickname into v_next_user, v_next_nick
    from public.poker_members
    where room_id = p_room_id and is_bot = false and left_at is null
    order by joined_at limit 1;

    update public.poker_members set is_host = true where room_id = p_room_id and user_id = v_next_user;
    update public.poker_rooms set host_id = v_next_user, host_nickname = v_next_nick where id = p_room_id;
  end if;
end; $$;
grant execute on function public.poker_leave_room(uuid) to authenticated;

-- ============================================================
-- RPC ⑥: 방 채팅
-- ============================================================
create or replace function public.poker_send_chat(
  p_room_id uuid,
  p_message text
) returns void language plpgsql security definer set search_path = public as $$
declare v_nick text;
begin
  select nickname into v_nick from public.poker_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_nick is null then return; end if;
  insert into public.poker_chat (room_id, user_id, nickname, message)
  values (p_room_id, auth.uid(), v_nick, left(p_message, 200));
end; $$;
grant execute on function public.poker_send_chat(uuid,text) to authenticated;
