-- ============================================================
-- Migration 038: 신고·이의제기 → 즉시 숨김 → 검토 큐 → Claude 가 복구/수정/삭제
--
--   종전 규칙(신고 2회 또는 이의제기 인용 2회 → banned)은 유명무실했다. 신고 1건은
--   아무 일도 안 일으켜서 같은 엉터리 문제가 계속 나갔고, 2건이 쌓이면 검토 없이
--   영구 삭제됐다. 새 규칙:
--     · 신고 1건 / 이의제기 인용 1건 → status = 'review' (픽은 active 만 뽑으니 즉시 숨김)
--     · quiz_review_queue 에 사유·시각을 남긴다 (퀴즈·수프 공용)
--     · 검토는 사람이 아니라 Claude — review_list 로 큐를 받아 위키 근거로 재검증하고
--       review_resolve 로 restore(멀쩡함) / fix(힌트·정답 교정 후 복구) / delete(banned)
--     · 검토 RPC 는 시드 토큰(036 seed_secrets)으로만 부른다 — 유저 세션 권한이 아니다
--   status 값: active | review | banned
-- ============================================================

create table if not exists public.quiz_review_queue (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                 -- quiz | soup
  bank_id      uuid not null,                 -- quiz_bank.id 또는 soup_bank.id
  reason       text not null default '',      -- hallucination | off_topic | appeal_upheld | wrong_answer | broken_logic ...
  reporter     uuid references auth.users(id) on delete set null,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolution   text                           -- restore | fix | delete
);
create index if not exists quiz_review_queue_open_idx on public.quiz_review_queue(kind, bank_id) where resolved_at is null;
alter table public.quiz_review_queue enable row level security;
-- 정책 없음 — definer RPC 로만

-- ── 신고: 1건이면 숨긴다 ──
create or replace function public.record_quiz_report(
  p_answer_key   text,
  p_category_key text,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  update public.quiz_bank b set
    report_count = b.report_count + 1,
    status       = case when b.status = 'active' then 'review' else b.status end,
    updated_at   = now()
  where b.answer_key = p_answer_key and b.category_key = p_category_key
  returning b.id into v_id;
  if v_id is not null then
    insert into public.quiz_review_queue (kind, bank_id, reason, reporter)
    values ('quiz', v_id, coalesce(p_reason, ''), auth.uid());
  end if;
end;
$$;
grant execute on function public.record_quiz_report(text, text, text) to authenticated;

-- ── 이의제기 인용: 정답이 환각이었을 가능성 — 역시 1건이면 숨긴다 ──
create or replace function public.record_quiz_appeal(
  p_answer_key   text,
  p_category_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  update public.quiz_bank b set
    appeal_count  = b.appeal_count + 1,
    appeal_upheld = b.appeal_upheld + 1,
    status        = case when b.status = 'active' then 'review' else b.status end,
    updated_at    = now()
  where b.answer_key = p_answer_key and b.category_key = p_category_key
  returning b.id into v_id;
  if v_id is not null then
    insert into public.quiz_review_queue (kind, bank_id, reason, reporter)
    values ('quiz', v_id, 'appeal_upheld', auth.uid());
  end if;
end;
$$;
grant execute on function public.record_quiz_appeal(text, text) to authenticated;

-- ── 수프 신고 ──
create or replace function public.record_soup_report(p_bank_id uuid, p_reason text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  update public.soup_bank b set
    status     = case when b.status = 'active' then 'review' else b.status end,
    updated_at = now()
  where b.id = p_bank_id
  returning b.id into v_id;
  if v_id is not null then
    insert into public.quiz_review_queue (kind, bank_id, reason, reporter, note)
    values ('soup', v_id, coalesce(p_reason, ''), auth.uid(), left(coalesce(p_note, ''), 500));
  end if;
end;
$$;
grant execute on function public.record_soup_report(uuid, text, text) to anon, authenticated;

-- ── 검토 큐 조회 (토큰) ──
create or replace function public.review_list(p_token text)
returns table(kind text, bank_id uuid, reasons text[], notes text[], reports bigint, first_at timestamptz, item jsonb)
language sql
security definer
set search_path = public
as $$
  with q as (
    select r.kind, r.bank_id, array_agg(r.reason order by r.created_at) as reasons,
           array_remove(array_agg(nullif(r.note, '') order by r.created_at), null) as notes,
           count(*) as reports, min(r.created_at) as first_at
      from public.quiz_review_queue r
     where r.resolved_at is null and public.seed_token_ok(p_token)
     group by r.kind, r.bank_id
  )
  select q.kind, q.bank_id, q.reasons, q.notes, q.reports, q.first_at,
         case q.kind
           when 'quiz' then (select to_jsonb(b) - 'created_by' from public.quiz_bank b where b.id = q.bank_id)
           when 'soup' then (select to_jsonb(s) from public.soup_bank s where s.id = q.bank_id)
         end
    from q
   order by q.first_at;
$$;
grant execute on function public.review_list(text) to anon, authenticated;

-- ── 검토 결정 (토큰): restore | fix | delete ──
--   p_patch (fix 일 때): quiz {answer?, acceptable?, hints?, max_hints?}  /  soup {title?, scenario?, solution?, key_facts?}
create or replace function public.review_resolve(p_token text, p_kind text, p_bank_id uuid, p_action text, p_patch jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.seed_token_ok(p_token) then
    raise exception 'seed token rejected' using errcode = '28000';
  end if;
  if p_action not in ('restore', 'fix', 'delete') then
    raise exception 'unknown action %', p_action;
  end if;

  if p_kind = 'quiz' then
    if p_action = 'delete' then
      update public.quiz_bank b set status = 'banned', updated_at = now() where b.id = p_bank_id;
    else
      update public.quiz_bank b set
        status     = 'active',
        answer     = coalesce(p_patch->>'answer', b.answer),
        answer_key = coalesce(p_patch->>'answer_key', b.answer_key),
        acceptable = case when p_patch ? 'acceptable'
                          then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'acceptable') x), '{}')
                          else b.acceptable end,
        -- 교정된 힌트 세트 하나로 갈아끼운다 — 신고된 세트를 남겨 둘 이유가 없다
        hint_sets  = case when p_patch ? 'hints' then jsonb_build_array(p_patch->'hints') else b.hint_sets end,
        max_hints  = coalesce((p_patch->>'max_hints')::int, b.max_hints),
        updated_at = now()
      where b.id = p_bank_id;
    end if;
  elsif p_kind = 'soup' then
    if p_action = 'delete' then
      update public.soup_bank s set status = 'banned', updated_at = now() where s.id = p_bank_id;
    else
      update public.soup_bank s set
        status    = 'active',
        title     = coalesce(p_patch->>'title', s.title),
        scenario  = coalesce(p_patch->>'scenario', s.scenario),
        solution  = coalesce(p_patch->>'solution', s.solution),
        key_facts = case when p_patch ? 'key_facts'
                         then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'key_facts') x), '{}')
                         else s.key_facts end,
        updated_at = now()
      where s.id = p_bank_id;
    end if;
  else
    raise exception 'unknown kind %', p_kind;
  end if;

  update public.quiz_review_queue r set resolved_at = now(), resolution = p_action
   where r.kind = p_kind and r.bank_id = p_bank_id and r.resolved_at is null;
end;
$$;
grant execute on function public.review_resolve(text, text, uuid, text, jsonb) to anon, authenticated;

-- 재고 조회에 검토 대기 수도 같이
create or replace function public.seed_inventory(p_token text)
returns table(kind text, category_key text, difficulty text, n bigint)
language sql
security definer
set search_path = public
as $$
  select 'quiz', b.category_key, coalesce(b.difficulty_actual, b.difficulty_labeled), count(*)
    from public.quiz_bank b where b.status = 'active' and public.seed_token_ok(p_token)
   group by 2, 3
  union all
  select 'soup', s.mood, s.difficulty, count(*)
    from public.soup_bank s where s.status = 'active' and public.seed_token_ok(p_token)
   group by 2, 3
  union all
  select 'review', r.kind, 'pending', count(distinct r.bank_id)
    from public.quiz_review_queue r where r.resolved_at is null and public.seed_token_ok(p_token)
   group by 2
  order by 1, 2, 3;
$$;
