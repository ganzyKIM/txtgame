-- ============================================================
-- Migration 034: 서버 권위 "최근 10문제 정답 중복 금지" 창
--
--   요구: 출제는 매번 랜덤이되, 같은 정답이 최근 10문제 안에 다시
--   등장해서는 안 된다. 기존에는 localStorage 제외 목록(기기 종속,
--   삭제 가능)에만 의존했다 — 창을 서버 기록으로 옮겨 기기를 바꾸든
--   캐시를 지우든 항상 보장되게 한다. 카테고리 무관 전역 창이라
--   같은 정답이 다른 카테고리로 나오는 것도 막는다.
--
--   구조: 유저당 1행(quiz_serve_history.recent_keys, 최대 10개).
--   픽 RPC가 창을 자동 제외하고, 뽑은 정답을 창에 기록한다.
--   AI 즉석 생성 폴백으로 출제된 정답도 record_quiz_serve로 창에 넣는다.
--
--   quiz_pick_internal(uid 파라미터 분리)은 gomoku_place_internal과
--   같은 패턴 — SQL Editor에서 가짜 세션 없이 창 동작을 검증하기 위함.
-- ============================================================

create table if not exists public.quiz_serve_history (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  recent_keys text[] not null default '{}',
  updated_at  timestamptz not null default now()
);
alter table public.quiz_serve_history enable row level security;
-- 정책 없음 — security definer RPC로만 접근

-- ── 창 기록 (내부 공용): 같은 키는 최신 위치로 이동, 길이 10 유지 ──
create or replace function public.quiz_serve_push(p_user_id uuid, p_answer_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent text[];
  v_new    text[];
begin
  if p_user_id is null or coalesce(p_answer_key, '') = '' then return; end if;
  select h.recent_keys into v_recent from public.quiz_serve_history h where h.user_id = p_user_id;
  v_new := array_remove(coalesce(v_recent, '{}'), p_answer_key) || p_answer_key;
  if array_length(v_new, 1) > 10 then
    v_new := v_new[array_length(v_new, 1) - 9 : array_length(v_new, 1)];
  end if;
  insert into public.quiz_serve_history as h (user_id, recent_keys, updated_at)
  values (p_user_id, v_new, now())
  on conflict (user_id) do update set recent_keys = excluded.recent_keys, updated_at = now();
end;
$$;

-- ── 픽 내부 구현: 최근 10개 + 클라 제외 목록을 빼고 랜덤 픽 + 창 기록 ──
create or replace function public.quiz_pick_internal(
  p_user_id      uuid,
  p_category_key text,
  p_difficulty   text,
  p_exclude_keys text[] default '{}'
)
returns table(
  answer     text,
  acceptable text[],
  hints      text[],
  max_hints  integer,
  answer_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.quiz_bank%rowtype;
  v_recent text[] := '{}';
  v_idx    int;
  v_set    jsonb;
begin
  if p_user_id is not null then
    select h.recent_keys into v_recent from public.quiz_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  select * into v_row
  from public.quiz_bank b
  where b.category_key = p_category_key
    and b.status = 'active'
    and jsonb_array_length(b.hint_sets) > 0
    and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty
    and not (b.answer_key = any(v_recent))
    and not (b.answer_key = any(coalesce(p_exclude_keys, '{}')))
  order by random()
  limit 1;

  if v_row.id is null then return; end if;

  perform public.quiz_serve_push(p_user_id, v_row.answer_key);

  v_idx := floor(random() * jsonb_array_length(v_row.hint_sets))::int;
  v_set := v_row.hint_sets -> v_idx;

  return query select
    v_row.answer, v_row.acceptable,
    array(select jsonb_array_elements_text(v_set)),
    v_row.max_hints, v_row.answer_key;
end;
$$;

-- 내부 함수는 클라이언트 직접 호출 차단 (Postgres 기본이 PUBLIC EXECUTE라 명시 회수)
revoke execute on function public.quiz_serve_push(uuid, text) from public, anon, authenticated;
revoke execute on function public.quiz_pick_internal(uuid, text, text, text[]) from public, anon, authenticated;

-- ── 공개 RPC: 기존 시그니처 유지 (클라 변경 없이 창이 적용됨) ──
create or replace function public.pick_quiz_bank_puzzle(
  p_category_key text,
  p_difficulty   text,
  p_exclude_keys text[] default '{}'
)
returns table(
  answer     text,
  acceptable text[],
  hints      text[],
  max_hints  integer,
  answer_key text
)
language sql
security definer
set search_path = public
as $$
  select * from public.quiz_pick_internal(auth.uid(), p_category_key, p_difficulty, p_exclude_keys);
$$;

grant execute on function public.pick_quiz_bank_puzzle(text, text, text[]) to authenticated;

-- ── AI 즉석 생성 폴백 채택 시에도 창에 기록 ──
create or replace function public.record_quiz_serve(p_answer_key text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.quiz_serve_push(auth.uid(), p_answer_key);
$$;

grant execute on function public.record_quiz_serve(text) to authenticated;
