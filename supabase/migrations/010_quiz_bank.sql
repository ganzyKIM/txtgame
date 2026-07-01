-- ============================================================
-- Migration 010: 퀴즈 콘텐츠 DB — 테이블 + 핵심 RPC (txtgame)
--   ① quiz_generations : 매 생성을 날것으로 남기는 append-only 원본 로그
--   ② quiz_bank        : 정답 정규화 엔티티 (status·통계 누적)
--
-- 보안: 두 테이블 모두 RLS on + 정책 없음 → 클라 직접 SELECT 차단.
--       쓰기/갱신은 SECURITY DEFINER RPC로만.
-- 004~009 실행 후에 실행. Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

-- ── ① 원본 생성 로그 (append-only) ─────────────────────────────
create table if not exists public.quiz_generations (
  id                uuid primary key default gen_random_uuid(),
  bank_id           uuid,
  created_by        uuid references auth.users(id) on delete set null,
  -- 콘텐츠
  category_key      text not null,
  category_label    text not null default '',
  theme             text not null default '',
  answer            text not null,
  acceptable        text[] not null default '{}',
  hints             text[] not null default '{}',
  max_hints         integer not null default 0,
  difficulty_labeled text not null default 'normal',
  -- 생성 출처
  prompt_version    text not null default 'v1',
  gen_era           text,
  gen_region        text,
  gen_angle         text,
  source            text not null default 'ai_fresh',
  model_tier        text not null default 'quiz_gen',
  -- 검증 결과
  wiki_verified     boolean not null default false,
  lint_passed       boolean not null default true,
  verify_passed     boolean not null default true,
  verify_problem    text not null default '',
  -- 실패 기록 (011_quiz_failure_learning.sql RPC가 사용)
  rejected          boolean not null default false,
  reject_stage      text not null default '',
  reject_reason     text not null default '',
  created_at        timestamptz not null default now()
);
create index if not exists quiz_generations_bank_idx
  on public.quiz_generations(bank_id, created_at desc);
create index if not exists quiz_generations_cat_idx
  on public.quiz_generations(category_key, created_at desc);

-- ── ② 정규화 엔티티 (정답 기준 upsert) ─────────────────────────
create table if not exists public.quiz_bank (
  id                 uuid primary key default gen_random_uuid(),
  answer_key         text not null,
  category_key       text not null,
  answer             text not null,
  category_label     text not null default '',
  acceptable         text[] not null default '{}',
  -- 힌트 세트 누적: [["힌트1","힌트2",...], ...] 최대 10세트
  hint_sets          jsonb not null default '[]',
  max_hints          integer not null default 0,
  difficulty_labeled text not null default 'normal',
  difficulty_actual  text,
  wiki_verified      boolean not null default false,
  status             text not null default 'candidate',
  plays              integer not null default 0,
  wins               integer not null default 0,
  total_hints_used   integer not null default 0,
  appeal_count       integer not null default 0,
  appeal_upheld      integer not null default 0,
  gen_count          integer not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_played_at     timestamptz,
  updated_at         timestamptz not null default now(),
  unique(answer_key, category_key)
);
create index if not exists quiz_bank_pick_idx
  on public.quiz_bank(category_key, status, difficulty_labeled);

alter table public.quiz_generations enable row level security;
alter table public.quiz_bank        enable row level security;

-- ============================================================
-- RPC ①: 생성 1건 기록 + 뱅크 upsert
-- ============================================================
create or replace function public.record_quiz_generation(
  p_answer_key         text,
  p_category_key       text,
  p_category_label     text,
  p_theme              text,
  p_answer             text,
  p_acceptable         text[],
  p_hints              text[],
  p_max_hints          integer,
  p_difficulty_labeled text,
  p_prompt_version     text,
  p_gen_era            text,
  p_gen_region         text,
  p_gen_angle          text,
  p_source             text,
  p_wiki_verified      boolean,
  p_lint_passed        boolean,
  p_verify_passed      boolean,
  p_verify_problem     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank_id     uuid;
  v_status      text;
  MAX_HINT_SETS constant int := 10;
begin
  insert into public.quiz_bank as b (
    answer_key, category_key, answer, category_label, acceptable,
    hint_sets, max_hints, difficulty_labeled, wiki_verified, gen_count, created_by
  )
  values (
    p_answer_key, p_category_key, p_answer, p_category_label,
    coalesce(p_acceptable, '{}'),
    jsonb_build_array(to_jsonb(coalesce(p_hints, '{}'))),
    p_max_hints, p_difficulty_labeled, p_wiki_verified, 1, auth.uid()
  )
  on conflict (answer_key, category_key) do update set
    answer             = excluded.answer,
    category_label     = excluded.category_label,
    acceptable         = (
      select array(select distinct unnest(b.acceptable || excluded.acceptable))
    ),
    hint_sets          = (
      select jsonb_path_query_array(
        excluded.hint_sets || b.hint_sets,
        ('$[0 to ' || (MAX_HINT_SETS - 1) || ']')::jsonpath
      )
    ),
    max_hints          = excluded.max_hints,
    difficulty_labeled = excluded.difficulty_labeled,
    wiki_verified      = b.wiki_verified or excluded.wiki_verified,
    gen_count          = b.gen_count + 1,
    updated_at         = now()
  where b.status <> 'banned'
  returning id, status into v_bank_id, v_status;

  if v_bank_id is null then
    select id into v_bank_id from public.quiz_bank
      where answer_key = p_answer_key and category_key = p_category_key;
  end if;

  insert into public.quiz_generations (
    bank_id, created_by, category_key, category_label, theme, answer, acceptable,
    hints, max_hints, difficulty_labeled, prompt_version, gen_era, gen_region,
    gen_angle, source, wiki_verified, lint_passed, verify_passed, verify_problem
  )
  values (
    v_bank_id, auth.uid(), p_category_key, p_category_label, p_theme, p_answer,
    coalesce(p_acceptable, '{}'), coalesce(p_hints, '{}'), p_max_hints, p_difficulty_labeled,
    p_prompt_version, p_gen_era, p_gen_region, p_gen_angle, p_source,
    p_wiki_verified, p_lint_passed, p_verify_passed, coalesce(p_verify_problem, '')
  );

  return v_bank_id;
end;
$$;

grant execute on function public.record_quiz_generation(
  text,text,text,text,text,text[],text[],integer,text,text,text,text,text,text,
  boolean,boolean,boolean,text
) to authenticated;

-- ============================================================
-- RPC ②: 플레이 결과 반영 (plays/wins 누적 → trusted 승격)
-- ============================================================
create or replace function public.update_quiz_bank_stats(
  p_answer_key   text,
  p_category_key text,
  p_won          boolean,
  p_hints_used   integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plays  integer;
  v_wins   integer;
  v_hints  integer;
  v_actual text;
  v_status text;
begin
  update public.quiz_bank set
    plays            = plays + 1,
    wins             = wins + (case when p_won then 1 else 0 end),
    total_hints_used = total_hints_used + coalesce(p_hints_used, 0),
    last_played_at   = now(),
    updated_at       = now()
  where answer_key = p_answer_key and category_key = p_category_key
    and status <> 'banned'
  returning plays, wins, total_hints_used into v_plays, v_wins, v_hints;

  if v_plays is null then return; end if;

  v_actual := case
    when v_wins::numeric / v_plays >= 0.75 and v_hints::numeric / v_plays <= 2.5 then 'easy'
    when v_wins::numeric / v_plays >= 0.45 and v_hints::numeric / v_plays <= 4.5 then 'normal'
    else 'hard'
  end;

  select status into v_status from public.quiz_bank
    where answer_key = p_answer_key and category_key = p_category_key;
  if v_status <> 'banned' and v_plays >= 3 and v_wins >= 2 then
    v_status := 'trusted';
  end if;

  update public.quiz_bank set
    difficulty_actual = v_actual,
    status            = v_status
  where answer_key = p_answer_key and category_key = p_category_key
    and status <> 'banned';
end;
$$;

grant execute on function public.update_quiz_bank_stats(text,text,boolean,integer)
  to authenticated;

-- ============================================================
-- RPC ③: 이의제기 인용 기록 (2회 이상 → banned)
-- ============================================================
create or replace function public.record_quiz_appeal(
  p_answer_key   text,
  p_category_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quiz_bank set
    appeal_count  = appeal_count + 1,
    appeal_upheld = appeal_upheld + 1,
    status        = case when appeal_upheld + 1 >= 2 then 'banned' else status end,
    updated_at    = now()
  where answer_key = p_answer_key and category_key = p_category_key;
end;
$$;

grant execute on function public.record_quiz_appeal(text,text) to authenticated;
