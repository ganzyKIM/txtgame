-- ============================================================
-- Migration 024: 홀덤 놀이용 칩 구매 (poker_buy_in)
--
--   [설계] holdem-plan.md §6 — 크레딧과 완전히 분리된 "놀이용 칩".
--   교환 비율은 서버가 고정한다(클라이언트가 임의 금액을 요청 못 함).
--   싱글플레이 테이블 자체는 전부 클라이언트에서 도는 순수 상태라
--   칩 잔고를 DB에 영속화하지 않는다 — 이 RPC는 "크레딧을 깎고
--   정해진 칩을 발급"하는 편도 교환만 담당한다. 재구매(리바이)도
--   같은 RPC를 그대로 다시 호출하면 된다.
--
--   V_COST=5, V_CHIPS=1000 은 첫 튜닝값. 가입 시 기본 지급 크레딧이
--   500(007_signup_credits.sql)이니 5크레딧이면 신규가입 잔액의 1%
--   수준 — "아주 적은 크레딧만 소요"라는 방침에 맞춰 잡았다.
--   밸런스 보고 나중에 숫자만 바꾸면 됨(로직 변경 불필요).
-- ============================================================

create or replace function public.poker_buy_in()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cost  constant int := 5;
  v_chips constant int := 1000;
  v_current bigint;
begin
  select credits into v_current from public.profiles where id = auth.uid() for update;
  if v_current is null then
    return json_build_object('ok', false, 'error', '프로필을 찾을 수 없어');
  end if;
  if v_current < v_cost then
    return json_build_object('ok', false, 'error', '크레딧이 부족해');
  end if;

  update public.profiles set credits = credits - v_cost where id = auth.uid();

  return json_build_object('ok', true, 'chips', v_chips, 'cost', v_cost, 'balance', v_current - v_cost);
end; $$;
grant execute on function public.poker_buy_in() to authenticated;
