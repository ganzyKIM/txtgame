# 퀴즈 콘텐츠 AI 데이터화 로드맵

> 2026-07-03 기획 초안. 지금 당장 구현하지 않고, 이후 착수 시 참고할 설계 메모.
> 전제: `quiz_generations`(원본 로그) / `quiz_bank`(정답 정규화 엔티티)는 이미 매 출제마다
> 채택·탈락 여부, 검증 결과, era/region/angle 축, plays/wins 통계까지 쌓고 있음(migration 010/011/013/017).
> 문제는 "쌓기만 하고 안 읽는다"는 것 — 이 로드맵은 그 데이터를 실제로 활용하는 순서를 정리한다.

## 배경 — 지금 있는데 안 쓰는 것

| 필드/테이블 | 이미 쌓이는 것 | 지금 활용처 |
|---|---|---|
| `quiz_bank.hint_sets` | 정답당 최대 10세트 힌트 누적 | 없음 (읽는 RPC 자체가 없음) |
| `quiz_bank.plays/wins/total_hints_used` | 전체 유저 합산 플레이 통계 | 없음 (클라는 `localStorage` 개인 통계만 봄) |
| `quiz_generations.gen_era/region/angle` | 출제 다양성 축 | 없음 (기록만 함) |
| `quiz_generations.rejected/reject_stage/reject_reason` | 탈락 사유 | Level 2/3 RPC로 부분 활용 중 (011) |
| `quiz_bank.difficulty_actual` | 실측 난이도(승률·힌트소비 기반) | 없음 (클라는 로컬 뱅크로 자체 계산) |

핵심 문제: **모든 학습 신호가 유저 개인의 `localStorage`에 갇혀 있다.** 서버 DB엔 전체 유저 데이터가 쌓이는데, 정작 출제 로직은 그걸 못 본다. 신규 유저는 항상 빈 로컬 뱅크로 시작 → 개인화는 되지만 집단 지성은 전혀 활용 못 함.

---

## 단기 — 스키마 변경 없이 RPC만 추가

### 1. 출제 축 성적표 (era × region × angle 탈락률)
**왜:** `buildSetupPrompt`가 매번 이 세 축을 랜덤 조합해 주입하는데, 어떤 조합이 탈락률이 높은지 전혀 피드백되지 않음. 탈락률 높은 조합은 재시도만 유발 → 속도·비용에 직결.

**설계:**
```sql
create or replace function public.get_axis_failure_rates(p_category_key text)
returns table(era text, region text, angle text, attempts bigint, reject_rate numeric)
-- quiz_generations를 gen_era/gen_region/gen_angle로 그룹핑,
-- rejected 비율이 높은 조합을 반환. 표본 부족(attempts < 5) 조합은 제외.
```
**활용:** `pickGenAxes()`를 완전 랜덤 대신, 탈락률 낮은 조합에 가중치를 주는 방식으로 변경(완전 배제는 다양성을 해치므로 소프트 가중치 권장).

### 2. 글로벌 난이도 보정 (서버 버전)
**왜:** 현재 [`getDifficultyCalibration`](../src/game/answerBank.ts)는 `localStorage` 뱅크 기반 — 신규 유저는 항상 빈 값. plays≥3인 항목 3개 이상이라는 표본 조건을 개인 데이터로는 채우기 어려움.

**설계:**
```sql
create or replace function public.get_difficulty_calibration(p_category_key text, p_difficulty text)
returns table(total_plays bigint, win_rate numeric, avg_hints numeric)
-- quiz_bank에서 category_key + difficulty_labeled 일치하는 행을 합산.
```
**활용:** `getDifficultyCalibration`을 이 RPC 결과 기반으로 재작성. 첫 판부터 전체 유저 데이터 기준 보정이 걸림.

---

## 중기 — RPC 추가 + 클라 로직 일부 이관

### 3. `pick_quiz_from_bank` — 서버 뱅크 재사용 경로
**왜:** 현재 뱅크 재사용(60% 확률)은 `localStorage`만 봐서 신규 유저에겐 죽어있는 경로. 게다가 재사용되더라도 힌트는 매번 AI로 재생성함(나무위키 대기 2.5초 + Pro 호출).

**설계:**
```sql
create or replace function public.pick_quiz_from_bank(
  p_category_key text, p_difficulty text, p_exclude_keys text[]
) returns table(
  answer text, acceptable text[], hint_set jsonb, max_hints int, answer_key text
)
security definer
-- status='trusted', category_key 일치, difficulty_actual(우선) 또는 difficulty_labeled 일치,
-- answer_key가 p_exclude_keys에 없는 행 중 하나를 랜덤 반환.
-- hint_sets(jsonb 배열)에서 세트 하나를 랜덤 선택해 hint_set으로 반환.
```
**활용:** `generatePuzzle`의 뱅크 재사용 분기를 이 RPC로 교체. 히트 시 **AI 호출 0회, 나무위키 대기 0초** — 응답 ~0.3초. 전 유저의 플레이가 공유 자산이 되어 시간이 지날수록 히트율 상승.

**주의점:**
- 크레딧 차감 모델과의 정합: 지금은 "생성=크레딧 차감"인데, 서버 뱅크 재사용은 생성이 아니므로 차감 안 하거나 훨씬 적게 차감해야 함. 정책 결정 필요.
- `hint_sets`가 이미 10세트까지 쌓이므로 "본 적 있는 힌트 세트 재출제" 방지 로직(클라가 최근 본 hint_set 해시를 기억)도 같이 설계해야 반복 체감을 막음.

### 4. Few-shot 예시 주입 (성적 좋은 문제를 모범 예시로)
**왜:** 지금 출제 프롬프트는 규칙만 나열하고 실제 좋은 예시가 없음. "정답률 40~70%(적당한 난이도), 신고 0, plays≥5" 문제를 몇 개 뽑아 프롬프트에 few-shot으로 보여주면 힌트 품질이 올라가고 verify 탈락률이 내려감(간접적으로 속도도 개선).

**설계:**
```sql
create or replace function public.get_exemplar_quizzes(p_category_key text, p_limit int default 3)
returns table(answer text, hints text[])
-- quiz_bank에서 plays>=5, report_count=0, wins/plays between 0.4~0.7 조건으로 샘플링.
```
**활용:** `buildSetupPrompt`에 "아래는 좋은 평가를 받은 예시다(스타일만 참고, 정답 재사용 금지)" 섹션 추가.

---

## 장기 — 구조 변경

### 5. 야간 배치 사전 생성 (nightly pre-generation queue)
**왜:** 지금은 유저가 요청할 때마다 실시간으로 생성 파이프라인 전체(생성→lint→wiki→verify)를 돈다. 카테고리×난이도 조합은 유한하므로, 미리 큐를 채워두면 유저 응답은 순수 DB 읽기가 됨.

**설계 스케치:**
- `pg_cron` + Supabase Edge Function으로 새벽 시간대에 카테고리(13개) × 난이도(3개) = 39개 조합별로 목표 재고(예: trusted 20개 이상)를 채울 때까지 기존 파이프라인을 반복 실행.
- 유저 출제 시: 재고 있으면 즉시 서빙(#3의 `pick_quiz_from_bank`와 동일 경로), 없으면 기존 실시간 생성으로 폴백.
- **막힘 지점:** 크레딧 모델. 지금은 "유저가 쓸 크레딧으로 생성"인데 배치 생성은 누구 크레딧으로 돌리나 — 별도 운영 예산/한도 설계 필요. 이게 정해져야 착수 가능.

### 6. 임베딩 기반 의미적 중복 차단
**왜:** 지금 [`collidesWithRecent`](../src/game/puzzle.ts)는 문자열 정규화 기반이라 "표기가 완전히 다른 같은 대상"(예: 같은 인물의 다른 별칭, 번역 차이)은 못 잡음.

**설계 스케치:**
- `quiz_bank`에 `pgvector` 컬럼 추가, 정답 채택 시 임베딩(예: 저렴한 임베딩 모델) 계산해 저장.
- 신규 후보 생성 시 최근 정답들과 코사인 유사도 검사 → 임계값 이상이면 중복으로 간주.
- 비용/지연 트레이드오프 있음 — 임베딩 호출이 파이프라인에 하나 더 추가되므로, 이건 오히려 **속도 개선(1부)과 상충**할 수 있어 신중히 검토.

---

## 착수 순서 제안 (다시 시작할 때)

1. **3번(`pick_quiz_from_bank`)** — 속도·비용·품질 삼득. 가장 임팩트 큼. 단, 크레딧 정책 먼저 결정.
2. **1·2번(축 성적표 + 글로벌 난이도 보정)** — 스키마 변경 없이 RPC만 추가, 리스크 낮음.
4. **4번(few-shot 예시)** — 3번이 어느 정도 쌓인 뒤 (exemplar 후보가 있어야 의미 있음).
5. **5번(야간 배치)** — 크레딧/운영비 모델이 정리된 후 최종 단계로.
6. **6번(임베딩 중복)** — 필요성이 체감될 때(중복 컴플레인이 실제로 쌓일 때) 착수.
