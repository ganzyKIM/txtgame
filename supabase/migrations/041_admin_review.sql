-- 041: 관리자 인앱 검토 — 신고·이의제기 큐를 운영자가 게임 화면 안에서 바로 처리한다
--
-- 종전(038)엔 seed_token 을 가진 CLI(tools/review.mjs)와 Claude 주간 루틴만 큐를 볼 수 있었다.
-- 이제 로그인한 관리자(admin_emails 에 등록된 이메일)는 토큰 없이 자기 세션으로
--   admin_review_pending()  대기 건수 — 도구 막대 배지
--   admin_review_list()     대기 목록 + 문제 전문
--   admin_review_history()  최근 처리 이력
--   admin_review_resolve()  복구 | 수정 후 복구 | 삭제
-- 를 부른다. 판정 로직은 review_apply 로 빼서 토큰 경로(review_resolve)와 공유한다.
-- 관리자 판정은 JWT 의 email 로 한다 — 클라의 MASTER_EMAILS(src/game/wardrobe.ts) 와 같은 목록.

create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;
insert into public.admin_emails (email) values ('kimdh12307@gmail.com') on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.admin_emails a
                  where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── 판정 본체 (grant 없음 — 두 래퍼만 부른다) ──
create or replace function public.review_apply(p_kind text, p_bank_id uuid, p_action text, p_patch jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
revoke all on function public.review_apply(text, uuid, text, jsonb) from public, anon, authenticated;

-- 토큰 경로는 본체에 위임
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
  perform public.review_apply(p_kind, p_bank_id, p_action, p_patch);
end;
$$;

-- ── 관리자 경로 ──
create or replace function public.admin_review_pending()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case when public.is_admin()
              then (select count(distinct (r.kind, r.bank_id))::int from public.quiz_review_queue r where r.resolved_at is null)
              else 0 end;
$$;
grant execute on function public.admin_review_pending() to authenticated;

create or replace function public.admin_review_list()
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
     where r.resolved_at is null and public.is_admin()
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
grant execute on function public.admin_review_list() to authenticated;

create or replace function public.admin_review_history(p_limit int default 30)
returns table(kind text, bank_id uuid, reason text, resolution text, resolved_at timestamptz, label text)
language sql
security definer
set search_path = public
as $$
  select r.kind, r.bank_id, r.reason, r.resolution, r.resolved_at,
         case r.kind
           when 'quiz' then (select b.answer from public.quiz_bank b where b.id = r.bank_id)
           when 'soup' then (select s.title from public.soup_bank s where s.id = r.bank_id)
         end
    from public.quiz_review_queue r
   where r.resolved_at is not null and public.is_admin()
   order by r.resolved_at desc
   limit greatest(1, least(p_limit, 200));
$$;
grant execute on function public.admin_review_history(int) to authenticated;

create or replace function public.admin_review_resolve(p_kind text, p_bank_id uuid, p_action text, p_patch jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  perform public.review_apply(p_kind, p_bank_id, p_action, p_patch);
end;
$$;
grant execute on function public.admin_review_resolve(text, uuid, text, jsonb) to authenticated;
