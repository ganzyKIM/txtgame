# 옷장·해금·표정 확장 설계 (2026-09-28)

## 목표
cut/ 폴더의 캐릭터 이미지 128장(초텐·아메 각 64장)을 전부 게임에 넣고, 새 의상 6종을 전적으로 해금하며, 마스코트 대사를 크게 늘린다.

## 이미지 자산
- `public/char/`에 128장을 추가한다(400×658 알파 PNG). 파일명 규칙은 `<form>[_<costume>][_<face>].png`.
  - 의상: `kimono` `bunny` `casual` `knit` `lounge` `nurse` `pajama` `summer` (기본 교복은 접두 없음)
  - 표정: `default` `dere` `angry` `peace` `vape`/`smoke`/`smoking` `yandere` `drug` `contempt` `smirk` `joy` `shy` `pout` `worried` `jealous` `sleepy` `surprised` `smug` `sad` `laugh` `love` `thinking` `wave` `cheer` `heat` `rude`
- `tools/char-manifest.mjs`가 `public/char/*.png`를 훑어 `src/game/charManifest.ts`(파일명 배열)를 생성한다. 손으로 목록을 관리하지 않는다. `npm run char:manifest`.

## 이미지 해석 — `src/game/mascotImages.ts`
- `Mood`(감정 키) 하나당 표정 후보 목록을 앞에서부터 찾는다. 예: `joy → [joy, dere, peace]`, `contempt → [contempt, rude, yandere, angry]`.
- `LineKind → Mood` 표로 49개 상황을 감정에 매핑한다(기존 `LINE_IMAGES`·`KIMONO_FACE`를 대체).
- `pickImage(form, costume, mood)`: `<form>_<costume>_<face>` → `<form>_<face>` 순으로 매니페스트에 있는 파일을 모으고, **감정 후보 중 가장 앞 단계에서 찾은 파일들 중 무작위**로 고른다. 의상 파일이 하나도 없으면 의상 기본 컷(`<form>_<costume>`)으로 떨어진다. 기본 의상은 `<form>_default`가 최종 폴백.
- `heat`(라이터)는 심드렁·대기 계열 후보에만, `rude`(가운뎃손가락)는 아메의 경멸·도발 후보에만 넣는다.

## 옷장 데이터 — `src/game/wardrobe.ts`
```
COSTUMES: { id, label, desc, unlock: null | { rule } }
kimono/bunny: unlock null (항상)
pajama : { kind:'plays_total', need:5 }      // 퀴즈+센터+오목+홀덤+수프 플레이 합계
lounge : { kind:'soup_plays',  need:1 }
casual : { kind:'gomoku_wins', need:3 }
summer : { kind:'center_best', need:7000 }   // 70% (10문제×1000)
knit   : { kind:'any', rules:[{holdem_hands:20},{holdem_multi_wins:1}] }
nurse  : { kind:'any', rules:[{gomoku_hard_wins:1},{hensachi:60}] }
```
- `evaluateUnlocks(stats: MyStats | null) → { unlocked: Set<Costume>, progress: Record<Costume,{cur,need,label}> }`. 순수 함수. stats가 null이면 기본 3종만.
- 기본 교복은 의상이 아니라 `null`이다.

## 의상 적용
- `Mascot`은 두 층을 가진다: `selected`(사용자가 옷장에서 고른 것, `localStorage['mascot_costume']`)와 `override`(화면이 강제하는 것). 실제 착용 = `override ?? selected`. 오목 화면 3곳은 `setCostume('kimono')` → `setCostumeOverride('kimono')`로 바꾸고 나갈 때 `null`.
- 해금: `App`이 게임 기록 저장 이벤트(`window` 커스텀 이벤트 `txtgame:recorded`, `cloudSave`의 저장 함수 4곳이 발행)를 받으면 1.5초 뒤 `my_stats`를 다시 읽는다. 새로 열린 의상이 `localStorage['costumes_celebrated']`에 없으면 마스코트 `unlockCostume(id)`: 변신 연출 → 그 옷 착용(선택 의상도 그 옷으로 바꿈) → 해금 대사. 로그인 시점에도 한 번 계산한다.

## 옷장 창 — `WardrobeModal.tsx`
- `StatsModal`과 같은 `.modal` 골격. 카드 격자(2~3열). 카드 = 현재 폼의 `<form>_<costume>` 기본 컷 + 라벨. 기본 교복 카드 포함.
- 잠긴 카드: `filter: grayscale(1) brightness(.35)` + 자물쇠 + 조건 문구 + 진행도 바(`cur/need`). 로그인 전엔 "로그인하면 진행도를 볼 수 있어".
- 클릭 = 즉시 착용 + 창 유지. 버튼: `Window` 메뉴바 변신 옆 `👗 옷장`, 바탕화면 툴바에도 같은 버튼.

## 대사
- `mascotLines.ts`의 `LINES` 49종을 폼당 10~15줄로 늘린다. 톤: 초텐은 직진 애정·호들갑·♡, 아메는 건조·"…"·츤데레. 이모지는 초텐 ♡만.
- `src/game/mascotCostumeLines.ts`: 의상 8종 × 폼 2 × { touch: 8, unlock: 2 }. 의상 차림에서 마스코트를 누르면 touch 대사, 해금 순간 unlock 대사.
- `IDLE_VARIANTS`의 고정 이미지 경로는 제거하고 `pickImage(form, costume, 'idle')`로 대체.

## 검증
- `tools/run-tests.mjs`: `tests/*.test.ts`를 esbuild로 번들해 `node --test`로 실행. `npm test`.
- 테스트: 해금 표 6종(경계값), 합계 판수, 로그인 전 기본만; `pickImage` 폴백 순서(의상 있음/없음/기본).
- `npm run build`(tsc + vite) 통과. 브라우저: 옷장 열기·착용·잠금 표시, 오목 진입 시 기모노 강제·복귀, 해금 연출(전적 조작 대신 개발용 `?unlock=` 없음 — 테스트로 대신).

## 하지 않는 것
- 홀덤 좌석 이미지(바니)는 손대지 않는다. 서버 스키마 변경 없음(`my_stats` 그대로).
