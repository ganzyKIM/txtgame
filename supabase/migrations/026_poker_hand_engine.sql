-- ============================================================
-- Migration 026: 홀덤 멀티 2단계 — 서버 권위 카드 딜링 엔진
--
--   [설계] 베팅 진행(폴드/체크/콜/레이즈, 스트리트 전환, 사이드팟 정산)
--   자체는 이미 검증된 클라이언트 엔진(src/game/poker/engine.ts)을
--   호스트 브라우저가 그대로 재사용해 계산한 뒤, 그 결과(공개 정보만)를
--   방 안에 realtime broadcast로 뿌리는 "호스트 권위 + 서버 비밀분배"
--   구조다. 카드 자체(손패+보드 5장)는 서버가 셔플해서 딜 시점에 한 번에
--   확정하고, 호스트에게는 전부(공개 예정 포함) 내려준다 — engine.ts의
--   applyAction이 스트리트가 넘어갈 때 내부적으로 자동으로 state.deck에서
--   카드를 뽑아 쓰는 동기 함수라, 스트리트마다 서버에 비동기로 다시
--   묻는 구조로 쪼개려면 engine.ts 자체를 뜯어고쳐야 해서(위험도↑) 대신
--   택한 절충안이다.
--
--   [신뢰 모델] 이건 기존 퀴즈 멀티(mp_rounds)와 동일한 선상의 트레이드
--   오프다 — 퀴즈도 호스트가 애초에 정답을 만든 사람이라 호스트 자신이
--   답을 아는 건 막지 않고, "다른 플레이어"가 DB를 직접 SELECT해서
--   훔쳐보는 것만 막는다. 여기서도 호스트가 devtools로 마음만 먹으면
--   전체 패를 볼 수 있지만(실제 딜러가 카드를 아는 것과 동급), 다른
--   사람 클라이언트는 poker_get_my_cards로 "자기 좌석 것만" 받고,
--   테이블 브로드캐스트에는 다른 사람 손패가 아예 실리지 않는다.
--   실제 돈이 아닌 놀이용 칩 게임이라 이 프로젝트 규모에는 충분한 수준.
-- ============================================================

create table if not exists public.poker_hands (
  room_id        uuid not null references public.poker_rooms(id) on delete cascade,
  hand_no        int  not null,
  dealer_seat    int  not null,
  sb_seat        int  not null,
  bb_seat        int  not null,
  small_blind    int  not null,
  big_blind      int  not null,
  seats          int[] not null,        -- 이 핸드 시작 시점의 활성 좌석(딜 순서 참고용)
  hole_cards     jsonb not null,        -- {"0": ["As","Kd"], ...} — seat_index(text) 키
  board          text[] not null,       -- 커뮤니티 카드 5장 전부(공개 진행은 클라 엔진이 관리)
  status         text  not null default 'active',  -- active|settled
  created_at     timestamptz not null default now(),
  primary key (room_id, hand_no)
);

alter table public.poker_hands enable row level security;
-- 정책 없음 → 클라 직접 SELECT 불가, 아래 RPC로만 접근 (mp_rounds와 동일 패턴)

-- ============================================================
-- RPC ①: 새 핸드 딜링 (호스트 전용)
--   활성 좌석을 모아 딜러/블라인드를 정하고, 서버에서 셔플한 카드를
--   손패+보드 5장까지 확정해 저장한다. 호출자(호스트)에게는 전부 반환.
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
  v_short_nick   text;
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid()) then
    return json_build_object('ok', false, 'error', '호스트만 딜을 시작할 수 있음');
  end if;

  select small_blind, big_blind, dealer_index into v_small_blind, v_big_blind, v_prev_dealer
  from public.poker_rooms where id = p_room_id;

  -- 칩이 빅블라인드 미만인 좌석은 이번 핸드에서 제외(관전) — 한 명이 짧은 스택이라고
  -- 테이블 전체가 멈추지 않도록. 리바이는 이 버전 범위 밖(추후 필요시 추가).
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

  -- 52장 셔플 (rank||suit 텍스트 코드 — 클라이언트 parseCard와 동일 표기)
  with ranks as (select unnest(array['2','3','4','5','6','7','8','9','10','J','Q','K','A']) as r),
       suits as (select unnest(array['s','h','d','c']) as s)
  select array_agg(r || s order by random()) into v_deck from ranks, suits;

  v_idx := 1;
  for v_seat in select unnest(v_active) loop
    v_hole_cards := v_hole_cards || jsonb_build_object(v_seat::text, jsonb_build_array(v_deck[v_idx], v_deck[v_idx+1]));
    v_idx := v_idx + 2;
  end loop;
  v_board := v_deck[v_idx : v_idx + 4];

  insert into public.poker_hands (room_id, hand_no, dealer_seat, sb_seat, bb_seat, small_blind, big_blind, seats, hole_cards, board)
  values (p_room_id, v_hand_no, v_new_dealer, v_sb_seat, v_bb_seat, v_small_blind, v_big_blind, v_active, v_hole_cards, v_board);

  update public.poker_rooms set status = 'playing', dealer_index = v_new_dealer, started_at = coalesce(started_at, now())
  where id = p_room_id;

  return json_build_object(
    'ok', true, 'handNo', v_hand_no, 'dealerSeat', v_new_dealer,
    'sbSeat', v_sb_seat, 'bbSeat', v_bb_seat, 'smallBlind', v_small_blind, 'bigBlind', v_big_blind,
    'seats', v_active, 'holeCards', v_hole_cards, 'board', to_jsonb(v_board)
  );
end; $$;
grant execute on function public.poker_deal_hand(uuid) to authenticated;

-- ============================================================
-- RPC ②: 내 손패 조회 (사람 좌석 전용 — auth.uid()로 좌석 매칭).
--   호스트 본인도 자기 좌석 카드를 이 경로로 받아써서, "호스트 눈에
--   보이는 자기 패"와 "다른 사람에게 보내는 데이터"가 코드상 분리된다.
-- ============================================================
create or replace function public.poker_get_my_cards(
  p_room_id uuid, p_hand_no int
) returns text[] language plpgsql security definer set search_path = public as $$
declare v_seat int; v_cards jsonb;
begin
  select seat_index into v_seat from public.poker_members
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat is null then return null; end if;

  select hole_cards -> v_seat::text into v_cards from public.poker_hands
  where room_id = p_room_id and hand_no = p_hand_no;
  if v_cards is null then return null; end if;

  return array(select jsonb_array_elements_text(v_cards));
end; $$;
grant execute on function public.poker_get_my_cards(uuid,int) to authenticated;

-- ============================================================
-- RPC ③: 핸드 정산 (호스트 전용) — 최종 스택을 좌석에 영속화
-- ============================================================
create or replace function public.poker_settle_hand(
  p_room_id uuid, p_hand_no int, p_stacks jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_key text; v_val int;
begin
  if not exists (select 1 from public.poker_rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not host';
  end if;

  for v_key, v_val in select key, value::int from jsonb_each_text(p_stacks) loop
    update public.poker_members set stack = v_val
    where room_id = p_room_id and seat_index = v_key::int and left_at is null;
  end loop;

  update public.poker_hands set status = 'settled'
  where room_id = p_room_id and hand_no = p_hand_no;
end; $$;
grant execute on function public.poker_settle_hand(uuid,int,jsonb) to authenticated;
