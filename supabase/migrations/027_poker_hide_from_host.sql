-- ============================================================
-- Migration 027: 홀덤 멀티 — 호스트도 devtools로 못 보게 카드 은닉 강화 + 재구매
--
--   [배경] 026은 "딜 시점에 호스트에게 손패+보드 5장을 전부 내려주고,
--   호스트가 다른 사람에게 보낼 때만 걸러낸다"는 방식이었다 — 이러면
--   호스트가 React DevTools로 자기 브라우저의 컴포넌트 상태(ref)를
--   열어보면 다른 사람 손패까지 다 보인다. 이번 마이그레이션은 그 구멍을
--   막는다: 026은 이 파일이 아래에서 create or replace로 다시 정의하므로
--   026을 이미 실행했든 안 했든 이 파일 하나만 실행해도 안전하다.
--
--   [새 방식] 딜 시점엔 좌석/블라인드 같은 "공개 정보"만 호스트에게
--   내려주고, 손패·보드는 서버에 넣어만 둔다(호스트도 못 받음). 호스트
--   브라우저는 실제 카드값을 전혀 모르는 채로 더미 카드로 베팅 엔진을
--   돌리다가, "이 액션을 적용하면 카드가 몇 장 더 공개돼야 하는지"를
--   더미 카드로 미리 시뮬레이션(dry-run)해서 알아낸 뒤, 딱 그만큼만
--   poker_reveal_next로 그 순간에 받아 진짜 액션에 꽂아 넣는다. 쇼다운도
--   마찬가지로 필요한 순간에만 poker_reveal_showdown으로 받는다.
--   즉 호스트 메모리에는 "지금 막 공개된" 카드만 잠깐 존재하고, 아직
--   공개 안 된 카드는 애초에 브라우저에 도달하지 않는다.
-- ============================================================

alter table public.poker_hands add column if not exists revealed_count int not null default 0;

-- ============================================================
-- RPC ①: 새 핸드 딜링 (호스트 전용) — 손패/보드는 저장만 하고 반환하지 않는다
-- ============================================================
create or replace function public.poker_deal_hand(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_small_blind  int;
  v_big_blind    int;
  v_active       int[];
  v_n            int;
  v_hand_no      int;
  v_prev_dealer  int;
  v_dpos         int;
  v_sb_pos       int;
  v_new_dealer   int;
  v_sb_seat      int;
  v_bb_seat      int;
  v_deck         text[];
  v_board        text[];
  v_hole_cards   jsonb := '{}'::jsonb;
  v_seat         int;
  v_idx          int;
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', '호스트만 딜을 시작할 수 있음');
  end if;

  select small_blind, big_blind, dealer_index into v_small_blind, v_big_blind, v_prev_dealer
  from public.poker_rooms where id = p_room_id;

  select array_agg(seat_index order by seat_index) into v_active
  from public.poker_members where room_id = p_room_id and left_at is null and stack >= v_big_blind;
  v_n := coalesce(array_length(v_active, 1), 0);
  if v_n < 2 then return json_build_object('ok', false, 'error', '칩이 남은 인원이 2명 미만이라 딜할 수 없음'); end if;

  select coalesce(max(hand_no), 0) + 1 into v_hand_no from public.poker_hands where room_id = p_room_id;

  if v_hand_no = 1 then
    v_new_dealer := v_active[1];
  else
    select array_position(v_active, v_prev_dealer) into v_dpos;
    if v_dpos is null then
      v_new_dealer := v_active[1];
    else
      v_new_dealer := v_active[(v_dpos % v_n) + 1];
    end if;
  end if;
  select array_position(v_active, v_new_dealer) into v_dpos;

  if v_n = 2 then
    v_sb_seat := v_new_dealer;
    v_bb_seat := v_active[(v_dpos % v_n) + 1];
  else
    v_sb_pos  := (v_dpos % v_n) + 1;
    v_sb_seat := v_active[v_sb_pos];
    v_bb_seat := v_active[(v_sb_pos % v_n) + 1];
  end if;

  with ranks as (select unnest(array['2','3','4','5','6','7','8','9','10','J','Q','K','A']) as r),
       suits as (select unnest(array['s','h','d','c']) as s)
  select array_agg(r || s order by random()) into v_deck from ranks, suits;

  v_idx := 1;
  for v_seat in select unnest(v_active) loop
    v_hole_cards := v_hole_cards || jsonb_build_object(v_seat::text, jsonb_build_array(v_deck[v_idx], v_deck[v_idx+1]));
    v_idx := v_idx + 2;
  end loop;
  v_board := v_deck[v_idx : v_idx + 4];

  insert into public.poker_hands (room_id, hand_no, dealer_seat, sb_seat, bb_seat, small_blind, big_blind, seats, hole_cards, board, revealed_count)
  values (p_room_id, v_hand_no, v_new_dealer, v_sb_seat, v_bb_seat, v_small_blind, v_big_blind, v_active, v_hole_cards, v_board, 0);

  update public.poker_rooms set status = 'playing', dealer_index = v_new_dealer, started_at = coalesce(started_at, now())
  where id = p_room_id;

  -- 손패(holeCards)·보드(board)는 절대 포함하지 않는다 — 공개 정보만 반환
  return json_build_object(
    'ok', true, 'handNo', v_hand_no, 'dealerSeat', v_new_dealer,
    'sbSeat', v_sb_seat, 'bbSeat', v_bb_seat, 'smallBlind', v_small_blind, 'bigBlind', v_big_blind,
    'seats', v_active
  );
end; $$;
grant execute on function public.poker_deal_hand(uuid) to authenticated;

-- ============================================================
-- RPC ②: 다음 보드 카드 N장 공개 (호스트 전용) — 필요한 순간에만, 딱 필요한
--   장수만 내준다. revealed_count를 넘어서거나 5장을 넘게는 절대 못 받는다.
-- ============================================================
create or replace function public.poker_reveal_next(
  p_room_id uuid, p_hand_no int, p_count int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_revealed int; v_board text[]; v_new int;
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'not host');
  end if;
  if p_count is null or p_count <= 0 then return json_build_object('ok', false, 'error', 'bad count'); end if;

  select revealed_count, board into v_revealed, v_board
  from public.poker_hands where room_id = p_room_id and hand_no = p_hand_no;
  if v_revealed is null then return json_build_object('ok', false, 'error', 'no such hand'); end if;

  v_new := v_revealed + p_count;
  if v_new > 5 then return json_build_object('ok', false, 'error', 'too many cards requested'); end if;

  update public.poker_hands set revealed_count = v_new where room_id = p_room_id and hand_no = p_hand_no;

  return json_build_object('ok', true, 'cards', to_jsonb(v_board[v_revealed + 1 : v_new]));
end; $$;
grant execute on function public.poker_reveal_next(uuid,int,int) to authenticated;

-- ============================================================
-- RPC ③: 쇼다운 공개 (호스트 전용) — 보드 5장이 다 공개된 뒤에만 허용
-- ============================================================
create or replace function public.poker_reveal_showdown(
  p_room_id uuid, p_hand_no int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int; v_hole jsonb;
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'not host');
  end if;
  select revealed_count, hole_cards into v_count, v_hole
  from public.poker_hands where room_id = p_room_id and hand_no = p_hand_no;
  if v_count is null then return json_build_object('ok', false, 'error', 'no such hand'); end if;
  if v_count < 5 then return json_build_object('ok', false, 'error', '아직 쇼다운 시점이 아님'); end if;
  return json_build_object('ok', true, 'holeCards', v_hole);
end; $$;
grant execute on function public.poker_reveal_showdown(uuid,int) to authenticated;

-- ============================================================
-- RPC ④: 봇 손패 조회(좌석 1개, 호스트 전용) — 봇 턴이 왔을 때만 그때그때 받는다
-- ============================================================
create or replace function public.poker_get_bot_cards(
  p_room_id uuid, p_hand_no int, p_seat int
) returns text[] language plpgsql security definer set search_path = public as $$
declare v_cards jsonb;
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid()) then
    return null;
  end if;
  if not exists (select 1 from public.poker_members where room_id = p_room_id and seat_index = p_seat and is_bot = true and left_at is null) then
    return null;
  end if;
  select hole_cards -> p_seat::text into v_cards from public.poker_hands
  where room_id = p_room_id and hand_no = p_hand_no;
  if v_cards is null then return null; end if;
  return array(select jsonb_array_elements_text(v_cards));
end; $$;
grant execute on function public.poker_get_bot_cards(uuid,int,int) to authenticated;

-- ============================================================
-- RPC ⑤: 칩 재구매 (이미 앉아있는 좌석 대상) — poker_buy_in과 동일 교환비율,
--   기존 스택에 더한다(리바이). 칩이 바닥나 관전 중인 사람이 다시 참여할 때 씀.
-- ============================================================
create or replace function public.poker_rebuy(
  p_room_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cost  constant int := 5;
  v_chips constant int := 1000;
  v_current bigint;
  v_seat int;
begin
  select seat_index into v_seat from public.poker_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat is null then return json_build_object('ok', false, 'error', '테이블에 앉아있지 않음'); end if;

  select credits into v_current from public.profiles where id = auth.uid() for update;
  if v_current is null then return json_build_object('ok', false, 'error', '프로필을 찾을 수 없어'); end if;
  if v_current < v_cost then return json_build_object('ok', false, 'error', '크레딧이 부족해'); end if;

  update public.profiles set credits = credits - v_cost where id = auth.uid();
  update public.poker_members set stack = stack + v_chips where room_id = p_room_id and seat_index = v_seat;

  return json_build_object('ok', true, 'chips', v_chips, 'cost', v_cost, 'balance', v_current - v_cost);
end; $$;
grant execute on function public.poker_rebuy(uuid) to authenticated;
