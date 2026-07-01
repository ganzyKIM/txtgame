-- ============================================================
-- Migration 010: 퀴즈 콘텐츠 DB (txtgame)
-- 유저가 고른 주제·난이도로 생성된 퀴즈를 서버에 누적한다.
--   ① quiz_generations : 매 생성을 날것으로 남기는 append-only 원본 로그
--                        (같은 정답의 다른 힌트 변형도 전부 보존 — 분석/파인튜닝용)
--   ② quiz_bank        : 정답 정규화 키로 묶은 정규화 엔티티
--                        (status·통계 누적, 재사용/난이도 보정의 원천)
--
-- 보안: 두 테이블 모두 정답(answer)을 담는다. 클라이언트가 직접 SELECT 하면
--       전체 정답 덤프 → 치트가 가능하다. 따라서 RLS를 켜되 정책을 두지 않아
--       클라 직접 접근은 전면 차단하고, 쓰기/갱신은 SECURITY DEFINER RPC로만 한다.
--
-- 004~009 실행 후에 실행. Supabase Dashboard → SQL Editor 에 붙여넣고 Run.
-- ============================================================

-- ── ① 원본 생성 로그 (append-only) ─────────────────────────────
create table if not exists public.quiz_generations (
  id                uuid primary key default gen_random_uuid(),
  bank_id           uuid,                       -- quiz_bank.id (upsert 후 연결)
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
  -- 생성 출처 (provenance)
  prompt_version    text not null default 'v1',
  gen_era           text,
  gen_region        text,
  gen_angle         text,
  source            text not null default 'ai_fresh',  -- ai_fresh | bank_reuse
  model_tier        text not null default 'quiz_gen',
  -- 검증 결과 (4단계 파이프라인 산출물)
  wiki_verified     boolean not null default false,
  lint_passed       boolean not null default true,
  verify_passed     boolean not null default true,
  verify_problem    text not null default '',
  -- 실패 기록 (Level 1) — rejected=true면 채택되지 않은 탈락 후보
  rejected          boolean not null default false,
  reject_stage      text not null default '',   -- lint | wiki | verify
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
  answer_key         text not null,   -- 정규화 키 (클라 normAnswerKey와 동일 규칙)
  category_key       text not null,
  -- 콘텐츠
  answer             text not null,
  category_label     text not null default '',
  acceptable         text[] not null default '{}',
  -- 힌트는 최신 1세트가 아니라 생성할 때마다 누적.
  -- 재사용 시 랜덤 선택 → 같은 정답도 매번 다른 힌트 경험.
  -- 구조: [["힌트1","힌트2",...], ["힌트1","힌트2",...], ...]
  hint_sets          jsonb not null default '[]',
  max_hints          integer not null default 0,
  difficulty_labeled text not null default 'normal',
  difficulty_actual  text,
  wiki_verified      boolean not null default false,
  -- 라이프사이클
  status             text not null default 'candidate', -- candidate | trusted | banned
  -- 누적 통계
  plays              integer not null default 0,
  wins               integer not null default 0,
  total_hints_used   integer not null default 0,
  appeal_count       integer not null default 0,
  appeal_upheld      integer not null default 0,
  gen_count          integer not null default 0,   -- 몇 번 생성됐나
  -- 메타
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_played_at     timestamptz,
  updated_at         timestamptz not null default now(),
  unique(answer_key, category_key)
);
create index if not exists quiz_bank_pick_idx
  on public.quiz_bank(category_key, status, difficulty_labeled);

-- RLS: 두 테이블 모두 켜고 정책 없음 → 클라 직접 접근 차단, RPC(정의자)만 접근
alter table public.quiz_generations enable row level security;
alter table public.quiz_bank        enable row level security;

-- ============================================================
-- RPC ①: 생성 1건 기록 + 뱅크 upsert
--   반환: 연결된 quiz_bank.id
-- ============================================================
create or replace function public.record_quiz_generation(
  p_answer_key        text,
  p_category_key      text,
  p_category_label    text,
  p_theme             text,
  p_answer            text,
  p_acceptable        text[],
  p_hints             text[],
  p_max_hints         integer,
  p_difficulty_labeled text,
  p_prompt_version    text,
  p_gen_era           text,
  p_gen_region        text,
  p_gen_angle         text,
  p_source            text,
  p_wiki_verified     boolean,
  p_lint_passed       boolean,
  p_verify_passed     boolean,
  p_verify_problem    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank_id  uuid;
  v_status   text;
  -- 힌트 세트 최대 누적 수 — 이 이상은 오래된 것부터 밀어낸다
  MAX_HINT_SETS constant int := 10;
begin
  -- 뱅크 upsert: banned는 건드리지 않고, 힌트 세트를 누적하며 gen_count 증가.
  -- hint_sets: 새 세트를 맨 앞에 추가하고 MAX_HINT_SETS 초과분은 뒤에서 잘라냄.
  insert into public.quiz_bank as b (
    answer_key, category_key, answer, category_label, acceptable,
    hint_sets, max_hints, difficulty_labeled, wiki_verified, gen_count, created_by
  )
  values (
    p_answer_key, p_category_key, p_answer, p_category_label,
    coalesce(p_acceptable,'{}'),
    jsonb_build_array(to_jsonb(coalesce(p_hints,'{}'))),
    p_max_hints, p_difficulty_labeled, p_wiki_verified, 1, auth.uid()
  )
  on conflict (answer_key, category_key) do update set
    answer             = excluded.answer,
    category_label     = excluded.category_label,
    -- acceptable은 합집합으로 누적
    acceptable         = (
      select array(select distinct unnest(b.acceptable || excluded.acceptable))
    ),
    -- 새 힌트 세트를 맨 앞에 prepend, MAX_HINT_SETS 초과분은 뒤에서 제거
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

  -- banned라 update가 걸러진 경우: 기존 id를 읽어와 로그만 남긴다
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
    coalesce(p_acceptable,'{}'), coalesce(p_hints,'{}'), p_max_hints, p_difficulty_labeled,
    p_prompt_version, p_gen_era, p_gen_region, p_gen_angle, p_source,
    p_wiki_verified, p_lint_passed, p_verify_passed, coalesce(p_verify_problem,'')
  );

  return v_bank_id;
end;
$$;

grant execute on function public.record_quiz_generation(
  text,text,text,text,text,text[],text[],integer,text,text,text,text,text,text,
  boolean,boolean,boolean,text
) to authenticated;

-- ============================================================
-- RPC ②: 플레이 결과 반영 (게임 종료 후)
--   plays/wins/hints 누적 → 실측 난이도·trusted 승격 재계산
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
  v_plays integer;
  v_wins  integer;
  v_hints integer;
  v_rate  numeric;
  v_avg   numeric;
  v_actual text;
  v_status text;
begin
  update public.quiz_bank set
    plays            = plays + 1,
    wins             = wins + (case when p_won then 1 else 0 end),
    total_hints_used = total_hints_used + coalesce(p_hints_used,0),
    last_played_at   = now(),
    updated_at       = now()
  where answer_key = p_answer_key and category_key = p_category_key
    and status <> 'banned'
  returning plays, wins, total_hints_used into v_plays, v_wins, v_hints;

  if v_plays is null then return; end if;

  v_rate := v_wins::numeric / v_plays;
  v_avg  := v_hints::numeric / v_plays;
  v_actual := case
    when v_rate >= 0.75 and v_avg <= 2.5 then 'easy'
    when v_rate >= 0.45 and v_avg <= 4.5 then 'normal'
    else 'hard'
  end;
  -- trusted 승격: 3판 이상·2승 이상
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

-- ============================================================
-- RPC ④: 탈락 후보 기록 (Level 1)
--   retry loop에서 버려지는 후보를 rejected=true로 quiz_generations에 저장.
--   duplicate(중복)은 세션 내 현상이라 저장하지 않음.
-- ============================================================
create or replace function public.record_quiz_rejection(
  p_answer_key     text,
  p_category_key   text,
  p_category_label text,
  p_answer         text,
  p_hints          text[],
  p_max_hints      integer,
  p_reject_stage   text,
  p_reject_reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.quiz_generations (
    category_key, category_label, answer, hints, max_hints,
    rejected, reject_stage, reject_reason, created_by
  ) values (
    p_category_key, p_category_label, p_answer,
    coalesce(p_hints, '{}'), coalesce(p_max_hints, 0),
    true, p_reject_stage, coalesce(p_reject_reason, ''), auth.uid()
  );
end;
$$;

grant execute on function public.record_quiz_rejection(text,text,text,text,text[],integer,text,text)
  to authenticated;

-- ============================================================
-- RPC ⑤: 만성 실패 정답 조회 (Level 2)
--   reject >= p_min_rejects 이면서 accept 이력이 없는 answer.
--   클라이언트는 이 목록을 exclusion에 추가 → 프롬프트에서 자동 차단.
-- ============================================================
create or replace function public.get_chronic_failures(
  p_category_key text,
  p_min_rejects  int default 3
)
returns table(answer text, reject_count bigint, top_reason text)
language sql
security definer
set search_path = public
as $$
  with rejected_agg as (
    select
      answer_key,
      -- 가장 최근 answer 텍스트 사용 (같은 key가 조금씩 다를 수 있음)
      (array_agg(answer order by created_at desc))[1] as answer,
      count(*) as rc,
      (array_agg(reject_reason order by created_at desc))[1] as top_reason
    from public.quiz_generations
    where category_key = p_category_key
      and rejected = true
      and reject_stage in ('wiki', 'verify', 'lint')
    group by answer_key
    having count(*) >= p_min_rejects
  ),
  accepted_keys as (
    select distinct answer_key
    from public.quiz_generations
    where category_key = p_category_key
      and rejected = false
  )
  select r.answer, r.rc, r.top_reason
  from rejected_agg r
  where r.answer_key not in (select answer_key from accepted_keys)
  order by r.rc desc
  limit 30;
$$;

grant execute on function public.get_chronic_failures(text, int) to authenticated;

-- ============================================================
-- RPC ⑥: 탈락 패턴 조회 (Level 3)
--   verify_problem / reject_reason 빈도를 집계해 반환.
--   클라이언트가 buildSetupPrompt에 네거티브 예시로 주입한다.
-- ============================================================
create or replace function public.get_failure_patterns(
  p_category_key text,
  p_limit        int default 5
)
returns table(pattern text, cnt bigint)
language sql
security definer
set search_path = public
as $$
  select reject_reason, count(*) as cnt
  from public.quiz_generations
  where category_key = p_category_key
    and rejected = true
    and reject_stage = 'verify'
    and reject_reason <> ''
  group by reject_reason
  order by cnt desc
  limit p_limit;
$$;

grant execute on function public.get_failure_patterns(text, int) to authenticated;
