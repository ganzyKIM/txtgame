-- ============================================================
-- Migration 012: answer_key 정규식 수정 + bank_id FK
--
-- [문제] 011에서 추가한 quiz_generations.answer_key generated column이
--        [^가-힣a-z0-9] 패턴을 사용 → 일본어 가나·한자를 전부 제거해
--        일본 타이틀 정답끼리 answer_key = '' 충돌 발생.
-- [수정] 한글·영숫자에 더해 히라가나·가타카나·CJK 한자까지 보존.
-- [추가] quiz_generations.bank_id → quiz_bank(id) FK (스키마 명시)
-- ============================================================

-- generated column은 ALTER로 재정의 불가 → DROP → ADD
alter table public.quiz_generations
  drop column if exists answer_key;

alter table public.quiz_generations
  add column answer_key text generated always as (
    lower(regexp_replace(
      answer,
      '[^가-힣ぁ-んァ-ヶ一-龯a-z0-9]',
      '',
      'g'
    ))
  ) stored;

-- 인덱스 재생성 (DROP 시 자동 삭제되므로)
drop index if exists public.quiz_generations_answer_key_idx;
create index quiz_generations_answer_key_idx
  on public.quiz_generations(category_key, answer_key);

-- bank_id FK 추가 (이미 존재하면 무시)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and constraint_name   = 'quiz_generations_bank_id_fkey'
  ) then
    alter table public.quiz_generations
      add constraint quiz_generations_bank_id_fkey
      foreign key (bank_id)
      references public.quiz_bank(id)
      on delete set null;
  end if;
end;
$$;
