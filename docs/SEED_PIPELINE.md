# 문제은행 시드 파이프라인 — 퀴즈·바다거북 수프

퀴즈와 수프 모두 **런타임에 AI 로 문제를 만들지 않는다.** Claude 가 오프라인에서 만들고
검수한 문제를 문제은행(`quiz_bank`, `soup_bank`)에 쌓아 두고, 게임은 거기서 뽑는다.
은행이 비었을 때만 예전 실시간 생성(Gemini)으로 폴백한다. 이 문서는 한 사이클을
사람이든 클라우드 루틴이든 똑같이 돌릴 수 있게 적은 런북이다.

설계 배경은 `ARCHITECTURE.md` 의 "퀴즈 문제은행 사전 시딩 (034)" 과 "바다거북 수프
문제은행 (035·036)" 을 보라.

## 준비물

- Node 22+, 저장소 루트에서 실행.
- 적재에는 환경변수 셋: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SEED_TOKEN`
  (`.env.local` 에서도 읽는다). `SEED_TOKEN` 은 DB 의 `seed_secrets.seed_token` 과 같은
  값이어야 한다 — 없으면 적재 단계에서 멈추고 나머지 산출물은 그대로 남는다.
- 서브에이전트(Agent 도구)를 쓸 수 있는 Claude 세션. 각 단계의 프롬프트는 아래에 있다.

`data/quiz-seed/`, `data/soup-seed/` 는 git 에서 무시된다(정답이 들어 있다). 루틴처럼
로컬이 아닌 곳에서 돌리면 최종 JSON 을 `data/pending/<YYYYMMDD>/` 에 복사해 두고
`seed/<YYYYMMDD>` 브랜치에 커밋해 남긴다 — 적재가 안 됐을 때 사람이 나중에
`node tools/seed-load.mjs quiz|soup <dir>` 로 넣을 수 있게.

## 0. 재고 확인 — 무엇을 얼마나 만들지

```bash
node tools/seed-load.mjs inventory
```

카테고리×난이도 재고가 나온다. **목표는 칸마다 60문항 이상**. 40 미만인 칸부터 채운다.
클라 카테고리 14종: person movie anime game music food animal place history science myth
sport otaku proverb (라벨·설명은 `src/game/puzzle.ts`). `proverb` 는 위키 근거 경로가
달라(위키낱말사전) 후보 프롬프트에 속담·성어 규칙을 넣어야 한다 — 기존 세트에서 복사.

수프는 분위기(mood) 12종 × 난이도 3 을 골고루. 은행 총량 300 을 넘기면 그 사이클은 건너뛴다.

## 1. 퀴즈 — 후보 수집 (Sonnet 서브에이전트, 카테고리×난이도당 1개)

이미 있는 정답을 다시 만들면 낭비라 회피 목록부터 만든다:

```bash
node --input-type=module -e '
import fs from "node:fs"; import path from "node:path";
import { normAnswerKey } from "./tools/quiz-seed/fetch-wiki.mjs";
const dirs=fs.readdirSync("data/quiz-seed").filter(d=>/^(final|loaded|p\d+)/.test(d)).map(d=>"data/quiz-seed/"+d);
const byCat={};
function walk(d){ for(const f of fs.readdirSync(d)){ const p=path.join(d,f); if(fs.statSync(p).isDirectory()) walk(p); else if(/^[a-z]+\.json$/.test(f)){ try{ for(const q of JSON.parse(fs.readFileSync(p,"utf8"))) if(q.categoryKey&&q.hints) (byCat[q.categoryKey]??=new Map()).set(normAnswerKey(q.answer),q.answer);}catch{} } } }
dirs.forEach(walk);
fs.mkdirSync("data/quiz-seed/avoid",{recursive:true});
for(const [c,m] of Object.entries(byCat)) fs.writeFileSync(`data/quiz-seed/avoid/${c}.txt`,[...m.values()].join(", "));
console.log(Object.fromEntries(Object.entries(byCat).map(([c,m])=>[c,m.size])));'
```

서브에이전트 프롬프트(카테고리 라벨·설명·슬라이스·난이도·수량·출력 파일만 바꾼다):

```
너는 추리 퀴즈 문제은행의 "정답 후보 수집가"다. 힌트는 만들지 않는다 — 정답 목록만.
이후 단계에서 모든 후보를 위키백과 API로 실존 검증하고, 위키 본문을 근거로 힌트를 만든다.
실존하지 않는 후보를 내면 검증에서 전부 탈락해 낭비가 된다.

[카테고리] <라벨> — <src/game/puzzle.ts 의 prompt>
[슬라이스] <시대·장르·지역 등 이번 배치가 집중할 범위> 위주 (20%는 벗어나도 됨)
[난이도] easy|normal|hard — easy: 그 분야에 관심 없는 일반인도 아는 대중적 대상 / normal: 어느 정도
  관심 있는 사람이면 아는 대상, 상위 10개는 제외 / hard: 팬·전공자 수준. 먼저 떠오르는 5개는 제외하고
  그 다음 층에서. 단 위키백과에 독립 문서가 있을 만큼은 알려진 것.
[이미 출제된 정답] data/quiz-seed/avoid/<cat>.txt 를 Read 해서 거기 있는 정답은 전부 제외 (없으면 무시)
[수량] 최대 N개. 확실성이 수량보다 우선 — 실존이 100% 확실한 것만.

[규칙]
1. 한국어/영어/일본어 위키백과 중 하나에 그 대상만 다루는 독립 문서가 확실히 있어야 한다.
2. answer는 한국어에서 통용되는 공식 표기(일본 작품·캐릭터는 한국 정식 번역명). 약칭·성만 금지.
3. acceptable: 확실한 표기 변형 2~5개. 4. note: 대상을 특정하는 한 줄 설명(15단어 내).
5. wikiTitle: 한국어 위키 문서 제목이 answer와 다르면 기입. 없으면 wikiTitleEn/wikiTitleJa.
6. 시대·세부장르·성별·지역을 골고루. 성인물·실존인물 비하·범죄 관련 제외.

[작업] Write 로 data/quiz-seed/<cycle>/candidates/<cat>_<diff>_<slice>.json 에
[{"answer","acceptable":[],"note","wikiTitle?","wikiTitleEn?","wikiTitleJa?"}] 저장 후 Bash 로 파싱 확인,
마지막 보고는 "count: N" 한 줄만.
```

파일 이름은 반드시 `<cat>_<easy|normal|hard>_<영숫자>.json` — 다음 단계가 이름에서 난이도를 읽는다.

## 2. 위키 근거 확보 → 기적재 제외 → 청크

```bash
node tools/quiz-seed/fetch-wiki.mjs --in data/quiz-seed/<cycle>/candidates --out data/quiz-seed/<cycle>/grounded
# 이미 적재된 정답 제거 (final 디렉터리들을 한 곳에 모아 넘긴다; _stats.json 은 빼라)
node data/quiz-seed/filter-new.mjs data/quiz-seed/<cycle>/grounded <all_final_dir> data/quiz-seed/<cycle>/grounded_new
node tools/quiz-seed/pipeline.mjs chunk --grounded data/quiz-seed/<cycle>/grounded_new --tasks data/quiz-seed/<cycle>/tasks --n 12
```

## 3. 힌트 작성 (Sonnet 서브에이전트, 청크 2개당 1개)

```
너는 추리 퀴즈 힌트 작성자다. 작업 파일의 각 항목(정답 + 위키 근거 발췌)에 힌트를 만든다.
[작업 파일 → 출력 파일] tasks/<f>.json → drafts/<f>.json (필드: answer, difficulty, note, acceptable, extract, sourceTitle)
카테고리 키: <cat>

[사실성 — 최우선]
· 힌트의 구체적 사실은 extract 내용을 우선 사용. extract에 없는 사실은 100% 확실한 것만.
· extract가 note와 다른 대상 같으면(동명이인 오매칭) 그 항목은 빼고 skipped에 세라.
· extract가 영어/일본어면 이해해서 한국어로 재구성.
· (anime/otaku/game) 연도·제작사·작가·성우·플랫폼은 근거 발췌 기준으로만. 팬덤 밈·비공식 통설 금지.

[힌트 규칙]
· 6~8개. 넓고 모호 → 구체적. 마지막 1~2개가 결정적. 각 힌트는 새 사실 하나.
· 전부 존댓말 평서문(~입니다/~습니다). 반말·의문형 금지.
· 카테고리만으로 자명한 서술 금지. 정답 이름(일부 음절·외국어 표기·제목 속 인명·지명) 노출 금지.
· maxHints: easy 6~8 / normal 5~7 / hard 3~4 (hints 개수 이하).

[작업] 1. Read 작업 파일 2. Write 출력 — [{"answer":"(그대로)","difficulty","hints":[],"maxHints":n,"acceptable":[]}]
3. Bash: node tools/quiz-seed/lint-run.mjs <출력> <cat> → CLEAN 아니면 고쳐 재검사(최대 3회), 계속 실패하면 항목 제거.
마지막 보고는 "count: N, skipped: M" 한 줄만.
```

## 4. 적대적 검수 (Sonnet 서브에이전트, 청크 2개당 1개 — 전 청크)

```
너는 추리 퀴즈의 적대적 검수관이다. 임무는 잘못된 문제를 탈락시키는 것이지 통과시키는 것이 아니다.
[근거] tasks/<f>.json · [검사 대상] drafts/<f>.json · [출력] verify/<f>.json

[항목별 검사]
1. 대상 일치: extract가 note·answer와 같은 대상인가? 오매칭이면 즉시 drop.
2. 힌트 사실: 각 힌트를 extract와 대조. 뒷받침되거나 100% 확신하면 OK. 오류·모순·확인 불가면 PROBLEM.
3. 품질: 정답 음절/표기 노출, 모호→구체 순서 위반, 반말·의문형, 정답을 못 좁히는 힌트.

[판정] 문제 없음 → "pass" / 고칠 수 있는 문제 1~2개 → "fix" + fixedHints(전체 배열, 5개 이상)
/ 문제 3개 이상·근거 부실·대상 불일치 → "drop" + reason. 불확실하면 drop.
[작업] Read 둘 → Write 출력: [{"answer","verdict":"pass|fix|drop","reason","fixedHints":[],"fixedMaxHints":n}]
한 번의 Write. JSON 을 응답에 옮겨 적지 마라. 보고는 "pass: N, fix: N, drop: N" 한 줄만.
```

## 5. 조립 → 적재

```bash
node tools/quiz-seed/pipeline.mjs assemble --tasks .../tasks --drafts .../drafts --verify .../verify --final .../final
node tools/seed-load.mjs quiz data/quiz-seed/<cycle>/final      # SEED_TOKEN 필요
```

`assemble` 은 fail-closed 다: 검수 파일이 없거나 verdict 가 없으면 버린다. 린트(정답 음절 노출·
존댓말·개수)도 다시 돈다. `_stats.json` 에 카테고리별 탈락 사유가 남는다.

## 6. 수프 — 출제 (Opus 서브에이전트, 분위기 2종 × 24문항당 1개)

분위기 12종: 오싹한 호러 / 뭉클한 감동 / 소름 돋는 반전 / 일상 속 기묘함 / 죽음에 얽힌 트릭 /
사소한 오해가 부른 비극 / 시간·장소의 착각 / 직업·역할의 함정 / 동물이나 사물의 시점 /
말장난·언어유희 / 과학·자연현상 트릭 / 따뜻한 미담으로 끝나는 반전. 기존 제목 목록(은행의
title 들)을 회피 목록으로 넣는다.

```
너는 "바다거북 수프"(수평사고 퀴즈) 출제자다. 겉보기엔 모순돼 보이지만 진상을 알면 "아하!" 하는 수수께끼 24개.
[이번 분위기] "<A>" 12개, "<B>" 12개.  [난이도 배분] easy 8 · normal 10 · hard 6.
[규칙]
1. scenario 2~4문장. 기괴하거나 모순돼 보여 "왜?"가 들어야 하고, 읽자마자 답이 보이면 안 된다.
2. solution 3~6문장. 논리적으로 완결. 예/아니오 질문만으로 도달 가능해야 한다 — 추측 불가능한 자의적 정보 금지.
3. 자살·자해·성적 소재·아동 학대 금지. 죽음은 담백하게.
4. title 8자 내외, 답 누설 금지.
5. 등장인물은 일본식 이름 또는 유명 애니 캐릭터 이름. "남자", "A씨" 금지.
6. 널리 알려진 기존 퍼즐과 그 변형 금지. 24개끼리 같은 트릭 유형 최대 2개.
7. keyFacts: 판정 기준 핵심 사실 3~5개. solution 과 모순 금지.
[출력] Write data/soup-seed/<cycle>/<set>.json:
[{"title","scenario","solution","mood","difficulty","keyFacts":[]}] → Bash 로 파싱 확인, 보고는 "count: N".
```

## 7. 수프 — 린트 → 적대적 검수 (Opus, 세트당 1개) → 조립 → 적재

```bash
node tools/soup-seed/pipeline.mjs lint --drafts data/soup-seed/<cycle>
```

검수 프롬프트(요지): 논리(solution 이 scenario 의 모든 이상한 점을 설명하는가) · 공정성(예/아니오로
도달 가능한가) · 스포일러(scenario/title 만으로 답이 보이는가) · keyFacts 일관성 · 톤 ·
기시감(기존 유명 퍼즐 변형) · 과학적 사실. 판정 pass / fix(+fixed{scenario?,solution?,keyFacts?,title?}) /
drop(+reason). 불확실하면 drop. 출력 `data/soup-seed/<cycle>_verify/<set>.json` —
`[{"title","verdict","reason","fixed":{}}]`.

```bash
node tools/soup-seed/pipeline.mjs assemble --drafts data/soup-seed/<cycle> --verify data/soup-seed/<cycle>_verify --final data/soup-seed/<cycle>_final
node tools/seed-load.mjs soup data/soup-seed/<cycle>_final     # SEED_TOKEN 필요
```

## 8. 신고·이의제기 검토 (매 사이클 처음에)

유저가 신고하거나 이의제기가 인용된 문제는 즉시 `status = 'review'` 로 숨겨지고
`quiz_review_queue` 에 쌓인다(migration 038). 사이클마다 이걸 먼저 비운다.

```bash
node tools/review.mjs list          # → data/review/pending.json  (kind, bank_id, reasons, item)
```

검토 에이전트(Sonnet, 항목 20개당 1개) 프롬프트:

```
너는 추리 퀴즈·바다거북 수프 문제은행의 재검토관이다. 유저가 신고한 문제를 다시 검증해 복구/수정/삭제를 정한다.
[입력] data/review/pending.json — Read. 항목: kind(quiz|soup), bank_id, reasons(hallucination|off_topic|appeal_upheld|
  broken_logic|spoiler|inappropriate), notes, item(퀴즈: answer, category_key, acceptable, hint_sets, difficulty_labeled /
  수프: title, scenario, solution, key_facts).
[퀴즈 검증] ① 정답이 실존하는가 — Bash 로 위키백과 API 를 조회하라:
  curl -s "https://ko.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=<정답>"
  (없으면 en/ja 도). 문서가 없거나 동음이의면 → delete. ② 힌트 하나하나를 문서 본문과 대조. 틀린 힌트가 1~2개면
  고쳐서 fix(hints 전체 배열, 정답 음절 노출 금지·존댓말 유지), 3개 이상이거나 정답 자체가 힌트와 맞지 않으면 delete.
  ③ off_topic: 정답이 카테고리에 맞지 않으면 delete. ④ 신고가 근거 없으면 restore.
[수프 검증] 진상이 시나리오의 모든 이상한 점을 설명하는가, 예/아니오로 도달 가능한가, 시나리오만으로 답이 보이는가,
  소재가 불쾌한가. 고칠 수 있으면 fix(patch 에 바꾼 필드만), 아니면 delete, 신고가 근거 없으면 restore.
[출력] Write data/review/decisions.json: [{"kind","bank_id","action":"restore|fix|delete","patch":{...}(fix 시),"reason":"한 줄"}]
  불확실하면 delete — 은행은 넉넉하고 틀린 문제 하나가 신뢰를 깎는다. 보고는 "restore: N, fix: N, delete: N" 한 줄만.
```

```bash
node tools/review.mjs resolve data/review/decisions.json
```

## 실측 (2026-09-30, P4 / 수프 P1)

- 퀴즈: 후보 693 → 위키 근거 644 → 신규 594 → 힌트 570 → 검수 후 **563 적재** (은행 ≈3,370).
  드롭은 대부분 힌트 단계의 동명 오매칭 skip 이었고, 검수 drop 은 1~2%.
- 수프: 출제 144 → 검수 pass 65 · fix 43 · drop 36 → **107 적재**. 수프는 검수가 4분의 1을
  버린다 — 출제 수량을 목표의 1.4배로 잡아라.
- 에이전트 비용: 후보 ~55k 토큰/개, 힌트 ~85k/청크 2개, 검수 ~85k/청크 2개, 수프 출제 ~100k/세트.

## 실측 (2026-10-07, P6 / 수프 P2)

- 퀴즈: 후보 11칸×30=330 → 위키 근거 318 → 신규 307 → 힌트 299 → 검수 pass 253·fix 46·drop 1 →
  **296 적재** (은행 ≈3,630). 주간 토큰의 약 7%p 사용(수프 포함).
- 수프: 출제 6세트 144 → 검수 pass 104·fix 28·drop 12 → **132 적재** (은행 239). 말장난 세트가
  drop 6 으로 가장 많이 깎였다 — 다음엔 말장난 분위기는 12개만.
- 에이전트: 힌트 ~80k/청크 2개, 검수 ~85k/청크 2개, 수프 출제 ~110k/세트, 수프 검수 ~80k/세트.

## 실측 (2026-10-09, P7 4웨이브 / 수프 P3) — 5시간 한도 16%→약 66%

한 번에 다 띄우지 않고 웨이브로 나눠 `get_usage` 를 보며 조절했다 (목표 70%).
- 웨이브 1 (14칸): 후보 419 → 근거 381 → **373 적재**.  웨이브 2 (8칸): 240 → 206 → **198**.
  웨이브 3 (8칸): 237 → 211 → **187** (영화는 동명 작품 오매칭 skip 이 많아 60 후보 중 36).
  웨이브 4 (4칸): 119 → 102 → **95**.  합계 **853 적재** (은행 4,324, 최저 칸 78).
- 수프 P3 1세트(일상 기묘·호러, hard 비중): 24 → pass 16·fix 6·drop 2 → **22 적재** (은행 393).
- 비용 감: 후보 1칸 ≈ 0.4%p, 힌트·검수 에이전트(청크 2개) ≈ 0.5%p 씩. 14칸 풀 사이클 ≈ 17%p.
  속담 hard 는 위키낱말사전 표제어 탈락이 절반(30→15) — 후보 프롬프트에 "4글자 한글 표기로 표제어가
  있는지 확신" 을 더 강조하거나 수량을 40 으로 잡아라.

