-- ============================================================
-- Migration 017: quiz_generations.answer_key 정규화 버그 수정
--
--   011에서 만든 generated column은 [^가-힣a-z0-9]만 남기고 나머지를
--   전부 제거한다. 이 때문에 일본어(가나·한자)·중국어로만 이루어진
--   정답(애니·게임·오타쿠 카테고리에 흔함)의 answer_key가 통째로 비거나,
--   서로 다른 정답이 같은 빈 키로 뭉개지는 문제가 있었다.
--   → get_chronic_failures / get_failure_patterns(011) 집계가
--     이런 정답들에서 부정확하게 동작할 수 있었음.
--
--   mp_norm(014)이 이미 검증된 문자 클래스(한글·가나·CJK 한자·영숫자 유지)를
--   쓰고 있으므로 동일한 방식으로 교체한다.
--   generated column의 표현식은 ALTER로 바꿀 수 없어 drop 후 재생성한다.
-- ============================================================

drop index if exists public.quiz_generations_answer_key_idx;

alter table public.quiz_generations
  drop column if exists answer_key;

alter table public.quiz_generations
  add column answer_key text
    generated always as (
      lower(regexp_replace(answer, '[^가-힣ぁ-んァ-ヶ一-龯a-z0-9]', '', 'g'))
    ) stored;

create index if not exists quiz_generations_answer_key_idx
  on public.quiz_generations(category_key, answer_key);

-- 참고: quiz_bank.answer_key(클라이언트가 계산해 저장, 010/answerBank.ts normAnswerKey)는
-- 구두점만 제거하는 블랙리스트 방식이라 이미 CJK를 보존하고 있어 손댈 필요 없음.
-- 두 값이 완전히 동일한 알고리즘은 아니지만(희귀 문자권 처리 차이), 둘 다 CJK 정답을
-- 별개 키로 보존한다는 핵심 목표는 이제 일치한다.
