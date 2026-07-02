-- ============================================================
-- Migration 014: 멀티플레이 대합전
--   방 목록 공개 / 최대 10인 / 10라운드 / 힌트 7초 자동공개 / 채팅
-- ============================================================

-- ── 방 ──────────────────────────────────────────────────────
create table if not exists public.mp_rooms (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid references auth.users(id) on delete cascade,
  host_nickname   text not null,
  status          text not null default 'waiting', -- waiting | playing | finished
  category_key    text not null,
  category_label  text not null,
  category_prompt text not null default '',
  difficulty      text not null default 'normal',
  max_players     int  not null default 10,
  current_round   int  not null default 0,
  total_rounds    int  not null default 10,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

-- ── 참가자 ──────────────────────────────────────────────────
create table if not exists public.mp_members (
  room_id    uuid references public.mp_rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  nickname   text not null,
  is_host    boolean not null default false,
  score      int not null default 0,
  rounds_won int not null default 0,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- ── 라운드 (answer는 SECURITY DEFINER RPC로만 접근) ─────────
create table if not exists public.mp_rounds (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid references public.mp_rooms(id) on delete cascade,
  round_num           int not null,
  hints               text[] not null default '{}',
  max_hints           int not null default 6,
  answer              text not null,
  acceptable          text[] not null default '{}',
  acceptable_keys     text[] not null default '{}', -- 정규화된 acceptable
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  winner_id           uuid references auth.users(id),
  winner_nickname     text,
  winner_hints_used   int,
  unique(room_id, round_num)
);

-- ── 채팅 ────────────────────────────────────────────────────
create table if not exists public.mp_chat (
  id         bigint generated always as identity primary key,
  room_id    uuid references public.mp_rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  nickname   text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

-- RLS: 방/참가자/채팅은 인증 유저 조회 허용, 라운드는 RPC로만
alter table public.mp_rooms    enable row level security;
alter table public.mp_members  enable row level security;
alter table public.mp_rounds   enable row level security;
alter table public.mp_chat     enable row level security;

create policy "mp_rooms 조회" on public.mp_rooms    for select to authenticated using (true);
create policy "mp_members 조회" on public.mp_members for select to authenticated using (true);
create policy "mp_chat 조회" on public.mp_chat      for select to authenticated using (true);
-- mp_rounds: 정책 없음 → 클라 직접 SELECT 불가

-- Realtime 활성화
alter publication supabase_realtime add table public.mp_rooms;
alter publication supabase_realtime add table public.mp_members;
alter publication supabase_realtime add table public.mp_chat;

-- ── 정규화 헬퍼 ─────────────────────────────────────────────
create or replace function public.mp_norm(p_text text)
returns text language sql immutable as $$
  select lower(regexp_replace(p_text, '[^가-힣ぁ-んァ-ヶ一-龯a-z0-9]', '', 'g'))
$$;

-- ============================================================
-- RPC ①: 방 생성
-- ============================================================
create or replace function public.mp_create_room(
  p_category_key    text,
  p_category_label  text,
  p_category_prompt text,
  p_difficulty      text,
  p_nickname        text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_room_id uuid;
begin
  insert into public.mp_rooms (host_id, host_nickname, category_key, category_label, category_prompt, difficulty)
  values (auth.uid(), p_nickname, p_category_key, p_category_label, p_category_prompt, p_difficulty)
  returning id into v_room_id;

  insert into public.mp_members (room_id, user_id, nickname, is_host)
  values (v_room_id, auth.uid(), p_nickname, true);

  return v_room_id;
end; $$;
grant execute on function public.mp_create_room(text,text,text,text,text) to authenticated;

-- ============================================================
-- RPC ②: 방 참가
-- ============================================================
create or replace function public.mp_join_room(
  p_room_id uuid,
  p_nickname text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_count int;
begin
  select status into v_status from public.mp_rooms where id = p_room_id;
  if v_status is null then return json_build_object('ok', false, 'error', '방 없음'); end if;
  if v_status <> 'waiting' then return json_build_object('ok', false, 'error', '이미 시작됨'); end if;

  select count(*) into v_count from public.mp_members where room_id = p_room_id;
  if v_count >= 10 then return json_build_object('ok', false, 'error', '만원'); end if;

  insert into public.mp_members (room_id, user_id, nickname)
  values (p_room_id, auth.uid(), p_nickname)
  on conflict (room_id, user_id) do nothing;

  return json_build_object('ok', true);
end; $$;
grant execute on function public.mp_join_room(uuid,text) to authenticated;

-- ============================================================
-- RPC ③: 방 퇴장
-- ============================================================
create or replace function public.mp_leave_room(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_is_host boolean; v_next_host uuid; v_next_nick text;
begin
  delete from public.mp_members where room_id = p_room_id and user_id = auth.uid()
  returning is_host into v_is_host;

  -- 방에 아무도 없으면 방 삭제
  if not exists (select 1 from public.mp_members where room_id = p_room_id) then
    delete from public.mp_rooms where id = p_room_id;
    return;
  end if;

  -- 호스트가 나가면 가장 오래된 참가자에게 호스트 이전
  if v_is_host then
    select user_id, nickname into v_next_host, v_next_nick
    from public.mp_members where room_id = p_room_id order by joined_at limit 1;

    update public.mp_members set is_host = true where room_id = p_room_id and user_id = v_next_host;
    update public.mp_rooms set host_id = v_next_host, host_nickname = v_next_nick where id = p_room_id;
  end if;
end; $$;
grant execute on function public.mp_leave_room(uuid) to authenticated;

-- ============================================================
-- RPC ④: 게임 시작 (호스트 전용)
-- ============================================================
create or replace function public.mp_start_game(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.mp_rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not host';
  end if;
  update public.mp_rooms set status = 'playing', started_at = now(), current_round = 1
  where id = p_room_id and status = 'waiting';
end; $$;
grant execute on function public.mp_start_game(uuid) to authenticated;

-- ============================================================
-- RPC ⑤: 라운드 퍼즐 제출 (호스트가 생성 후 저장)
-- ============================================================
create or replace function public.mp_submit_round(
  p_room_id    uuid,
  p_round_num  int,
  p_hints      text[],
  p_max_hints  int,
  p_answer     text,
  p_acceptable text[]
) returns void language plpgsql security definer set search_path = public as $$
declare v_keys text[];
begin
  if not exists (select 1 from public.mp_rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not host';
  end if;

  select array_agg(mp_norm(a)) into v_keys from unnest(p_acceptable) a;

  insert into public.mp_rounds (room_id, round_num, hints, max_hints, answer, acceptable, acceptable_keys)
  values (p_room_id, p_round_num, p_hints, p_max_hints, p_answer,
          coalesce(p_acceptable, '{}'), coalesce(v_keys, '{}'))
  on conflict (room_id, round_num) do nothing;

  update public.mp_rooms set current_round = p_round_num where id = p_room_id;
end; $$;
grant execute on function public.mp_submit_round(uuid,int,text[],int,text,text[]) to authenticated;

-- ============================================================
-- RPC ⑥: 정답 제출 (정규화 비교, 원자적 승자 등록)
-- ============================================================
create or replace function public.mp_submit_guess(
  p_room_id    uuid,
  p_round_num  int,
  p_guess      text,
  p_hints_used int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key       text;
  v_answer    text;
  v_nickname  text;
  v_updated   boolean := false;
begin
  v_key := mp_norm(p_guess);

  -- 이미 승자가 있으면 바로 반환
  if exists (select 1 from public.mp_rounds where room_id = p_room_id and round_num = p_round_num and winner_id is not null) then
    return json_build_object('correct', false, 'already_won', true);
  end if;

  -- acceptable_keys 배열에 포함 여부 확인
  if not exists (
    select 1 from public.mp_rounds
    where room_id = p_room_id and round_num = p_round_num
      and v_key = any(acceptable_keys)
  ) then
    return json_build_object('correct', false);
  end if;

  select nickname into v_nickname from public.mp_members where room_id = p_room_id and user_id = auth.uid();

  update public.mp_rounds set
    winner_id         = auth.uid(),
    winner_nickname   = v_nickname,
    winner_hints_used = p_hints_used,
    ended_at          = now()
  where room_id = p_room_id and round_num = p_round_num and winner_id is null
  returning answer into v_answer;

  if v_answer is null then
    return json_build_object('correct', false, 'already_won', true);
  end if;

  -- 점수 반영
  update public.mp_members set
    rounds_won = rounds_won + 1,
    score = score + greatest(0, 1000 - (p_hints_used - 1) * 150)
  where room_id = p_room_id and user_id = auth.uid();

  return json_build_object('correct', true, 'answer', v_answer);
end; $$;
grant execute on function public.mp_submit_guess(uuid,int,text,int) to authenticated;

-- ============================================================
-- RPC ⑦: 라운드 종료 (노위너 — 호스트가 전원 포기/타임아웃 시 호출)
-- ============================================================
create or replace function public.mp_end_round(
  p_room_id   uuid,
  p_round_num int
) returns text language plpgsql security definer set search_path = public as $$
declare v_answer text;
begin
  if not exists (select 1 from public.mp_rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not host';
  end if;

  update public.mp_rounds set ended_at = now()
  where room_id = p_room_id and round_num = p_round_num and ended_at is null
  returning answer into v_answer;

  return coalesce(v_answer, '');
end; $$;
grant execute on function public.mp_end_round(uuid,int) to authenticated;

-- ============================================================
-- RPC ⑧: 게임 종료
-- ============================================================
create or replace function public.mp_finish_game(
  p_room_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.mp_rooms set status = 'finished', finished_at = now()
  where id = p_room_id and host_id = auth.uid();
end; $$;
grant execute on function public.mp_finish_game(uuid) to authenticated;

-- ============================================================
-- RPC ⑨: 채팅 전송
-- ============================================================
create or replace function public.mp_send_chat(
  p_room_id uuid,
  p_message text
) returns void language plpgsql security definer set search_path = public as $$
declare v_nick text;
begin
  select nickname into v_nick from public.mp_members where room_id = p_room_id and user_id = auth.uid();
  if v_nick is null then return; end if;
  insert into public.mp_chat (room_id, user_id, nickname, message)
  values (p_room_id, auth.uid(), v_nick, left(p_message, 200));
end; $$;
grant execute on function public.mp_send_chat(uuid,text) to authenticated;
