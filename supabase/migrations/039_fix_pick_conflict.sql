-- ============================================================
-- Migration 039: 037 핫픽스 — returns table 컬럼명과 테이블 컬럼명 충돌
--
--   quiz_pick_internal 은 returns table(... answer_key ...) 인데 본문의
--   `insert into quiz_seen (user_id, answer_key) ... on conflict (user_id, answer_key)`
--   에서 plpgsql 이 answer_key 를 출력 변수로도 볼 수 있어 42702(ambiguous) 로 죽었다.
--   → 로그인 유저의 은행 픽이 전부 실패해 AI 즉석 생성으로 폴백되던 상태.
--   `#variable_conflict use_column` 으로 본문 안에서는 항상 컬럼을 우선하게 한다.
--   soup_pick_internal 도 같은 지시어를 붙인다(returns table 에 id 가 있다).
-- ============================================================

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
#variable_conflict use_column
declare
  v_row    public.quiz_bank%rowtype;
  v_recent text[] := '{}';
  v_idx    int;
  v_set    jsonb;
  v_pass   int := 0;
begin
  if p_user_id is not null then
    select h.recent_keys into v_recent from public.quiz_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  loop
    v_pass := v_pass + 1;
    select * into v_row
    from public.quiz_bank b
    where b.category_key = p_category_key
      and b.status = 'active'
      and jsonb_array_length(b.hint_sets) > 0
      and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty
      and not (b.answer_key = any(v_recent))
      and not (b.answer_key = any(coalesce(p_exclude_keys, '{}')))
      and (p_user_id is null or not exists (
            select 1 from public.quiz_seen s where s.user_id = p_user_id and s.answer_key = b.answer_key))
    -- 덜 나간 문제부터 (전역 plays), 그 안에서 무작위 — 새 시드가 고르게 소비된다
    order by (b.plays >= 3), random()
    limit 1;

    exit when v_row.id is not null or v_pass >= 2 or p_user_id is null;

    -- 이 칸을 다 봤다: 이 칸의 seen 만 비우고 한 번 더 (최근-10 창·클라 제외는 유지)
    delete from public.quiz_seen s
     where s.user_id = p_user_id
       and s.answer_key in (
         select b.answer_key from public.quiz_bank b
          where b.category_key = p_category_key
            and coalesce(b.difficulty_actual, b.difficulty_labeled) = p_difficulty);
  end loop;

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
revoke execute on function public.quiz_pick_internal(uuid, text, text, text[]) from public, anon, authenticated;

create or replace function public.soup_pick_internal(p_user_id uuid, p_exclude_ids uuid[] default '{}')
returns table(id uuid, title text, scenario text, solution text, key_facts text[], mood text, difficulty text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row    public.soup_bank%rowtype;
  v_recent uuid[] := '{}';
  v_new    uuid[];
  v_pass   int := 0;
begin
  if p_user_id is not null then
    select h.recent_ids into v_recent from public.soup_serve_history h where h.user_id = p_user_id;
    v_recent := coalesce(v_recent, '{}');
  end if;

  loop
    v_pass := v_pass + 1;
    select * into v_row
    from public.soup_bank b
    where b.status = 'active'
      and not (b.id = any(v_recent))
      and not (b.id = any(coalesce(p_exclude_ids, '{}')))
      and (p_user_id is null or not exists (
            select 1 from public.soup_seen s where s.user_id = p_user_id and s.bank_id = b.id))
    order by b.plays asc, random()
    limit 1;

    exit when v_row.id is not null or v_pass >= 2 or p_user_id is null;
    delete from public.soup_seen s where s.user_id = p_user_id;   -- 은행을 다 봤다: 처음부터
  end loop;

  if v_row.id is null then return; end if;

  update public.soup_bank b set plays = b.plays + 1, last_played_at = now() where b.id = v_row.id;

  if p_user_id is not null then
    insert into public.soup_seen (user_id, bank_id) values (p_user_id, v_row.id)
    on conflict (user_id, bank_id) do update set seen_at = now();
    v_new := array_remove(v_recent, v_row.id) || v_row.id;
    if array_length(v_new, 1) > 30 then
      v_new := v_new[array_length(v_new, 1) - 29 : array_length(v_new, 1)];
    end if;
    insert into public.soup_serve_history as h (user_id, recent_ids, updated_at)
    values (p_user_id, v_new, now())
    on conflict (user_id) do update set recent_ids = excluded.recent_ids, updated_at = now();
  end if;

  return query select v_row.id, v_row.title, v_row.scenario, v_row.solution, v_row.key_facts, v_row.mood, v_row.difficulty;
end;
$$;
revoke all on function public.soup_pick_internal(uuid, uuid[]) from public;
