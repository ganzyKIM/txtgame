-- 040: 로컬 판정 모델 주소 공개 + 주제 직접입력 퀴즈의 문제은행 검색
--
-- (1) local_llm — 맥에서 도는 Ollama 판정 서버(tools/local-llm/server.mjs)가 cloudflared 임시
--     터널 주소를 받을 때마다 여기 올린다. 엣지 함수 generate-text 가 tier='quiz_judge' 요청을
--     먼저 이 주소로 보내고(크레딧 0), 실패·타임아웃이면 Gemini 로 폴백한다.
--     config 테이블은 service_role 만 읽으므로 토큰이 클라에 새지 않는다.
--     RPC 인증은 시딩과 같은 seed_token (036) 을 쓴다.
--
-- (2) quiz_pick_theme — 유저가 주제를 직접 입력하면 종전엔 무조건 Gemini 즉석 생성이었다.
--     이제 은행에서 주제 단어가 정답·힌트·별칭에 모두 들어 있는 문제를 먼저 찾는다
--     (크레딧 0). 없을 때만 클라가 즉석 생성으로 넘어간다. seen/최근창 기록은 일반 픽과 같다.

create or replace function public.set_local_llm(
  p_token     text,
  p_url       text,
  p_llm_token text,
  p_model     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.seed_token_ok(p_token) then
    raise exception 'seed token mismatch' using errcode = '28000';
  end if;
  insert into public.config (key, value)
  values ('local_llm', jsonb_build_object(
    'url', p_url, 'token', p_llm_token, 'model', p_model, 'updated_at', now()))
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.set_local_llm(text, text, text, text) from public;
grant execute on function public.set_local_llm(text, text, text, text) to anon, authenticated;

-- ── 주제 검색 픽 ──
create or replace function public.quiz_pick_theme_internal(
  p_user_id      uuid,
  p_category_key text,
  p_difficulty   text,
  p_theme        text,
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
#variable_conflict use_column
declare
  v_row    public.quiz_bank%rowtype;
  v_recent text[] := '{}';
  v_tokens text[];
  v_idx    int;
  v_set    jsonb;
begin
  -- 주제를 2글자 이상 토큰 최대 4개로 쪼갠다 ("조선시대 왕" → {조선시대, 왕}는 '왕'이 1글자라 {조선시대})
  select array_agg(t) into v_tokens
  from (
    select t from unnest(regexp_split_to_array(lower(coalesce(p_theme, '')), '[\s,·/]+')) as t
    where length(t) >= 2 limit 4
  ) x;
  if v_tokens is null or array_length(v_tokens, 1) is null then return; end if;

  if p_user_id is not null then
    select h.recent_keys into v_recent from public.quiz_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  -- 같은 난이도 우선, 없으면 아무 난이도 (주제 적중이 난이도보다 중요하다)
  select * into v_row
  from public.quiz_bank b
  where b.category_key = p_category_key
    and b.status = 'active'
    and jsonb_array_length(b.hint_sets) > 0
    and not (b.answer_key = any(v_recent))
    and not (b.answer_key = any(coalesce(p_exclude_keys, '{}')))
    and (p_user_id is null or not exists (
          select 1 from public.quiz_seen s where s.user_id = p_user_id and s.answer_key = b.answer_key))
    and (select bool_and(lower(b.answer || ' ' || array_to_string(b.acceptable, ' ') || ' ' || b.hint_sets::text) like '%' || tok || '%')
           from unnest(v_tokens) tok)
  order by (coalesce(b.difficulty_actual, b.difficulty_labeled) <> p_difficulty), (b.plays >= 3), random()
  limit 1;

  if v_row.id is null then return; end if;

  perform public.quiz_serve_push(p_user_id, v_row.answer_key);
  if p_user_id is not null then
    insert into public.quiz_seen (user_id, answer_key) values (p_user_id, v_row.answer_key)
    on conflict (user_id, answer_key) do update set seen_at = now();
  end if;

  v_idx := floor(random() * jsonb_array_length(v_row.hint_sets))::int;
  v_set := v_row.hint_sets -> v_idx;

  return query select
    v_row.answer, v_row.acceptable,
    array(select jsonb_array_elements_text(v_set)),
    v_row.max_hints, v_row.answer_key;
end;
$$;
revoke execute on function public.quiz_pick_theme_internal(uuid, text, text, text, text[]) from public, anon, authenticated;

create or replace function public.pick_quiz_bank_puzzle_theme(
  p_category_key text,
  p_difficulty   text,
  p_theme        text,
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
  select * from public.quiz_pick_theme_internal(auth.uid(), p_category_key, p_difficulty, p_theme, p_exclude_keys);
$$;
grant execute on function public.pick_quiz_bank_puzzle_theme(text, text, text, text[]) to authenticated;
