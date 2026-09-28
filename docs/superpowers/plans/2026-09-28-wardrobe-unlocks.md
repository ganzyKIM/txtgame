# 옷장·해금·표정 확장 구현 계획

> 스펙: docs/superpowers/specs/2026-09-28-wardrobe-unlocks-design.md

**Goal:** 새 이미지 128장을 게임에 넣고, 의상 6종을 전적으로 해금하고, 대사를 확장한다.
**Architecture:** 이미지 매니페스트 자동 생성 → 감정 기반 이미지 해석기 → 순수 해금 함수 → Mascot 의상 2층(선택/강제) → 옷장 창 → 대사 데이터 확장.
**Tech:** React 19 + TS, Vite, esbuild(node --test), Supabase `my_stats`.

## 작업
1. 자산·매니페스트: `cut/*.png` → `public/char/`, `tools/char-manifest.mjs`, `src/game/charManifest.ts`, npm 스크립트.
2. 테스트 러너: `tools/run-tests.mjs` + `npm test`.
3. `src/game/wardrobe.ts`: 카탈로그·규칙·`evaluateUnlocks` + `tests/wardrobe.test.ts`.
4. `src/game/mascotImages.ts`: Mood 후보표, LineKind→Mood, `pickImage` + `tests/mascotImages.test.ts`. `mascotLines.ts`의 `lineImage/costumeBaseImage/costumeTouchImages/IDLE_VARIANTS`를 이 위에 다시 구현. `Costume` 타입 확장.
5. `Mascot.tsx`: `setCostume`(선택) / `setCostumeOverride`(강제) / `unlockCostume(id)`; 터치 시 의상 대사. 오목 3곳 호출 변경.
6. `mascotCostumeLines.ts` 작성, `LINES` 확장.
7. `WardrobeModal.tsx` + 스타일 + `Window`/바탕화면 버튼 + `App` 상태(선택 의상 저장, 해금 감시, `txtgame:recorded` 이벤트).
8. `cloudSave.ts` 저장 4곳에서 이벤트 발행.
9. 빌드·테스트·브라우저 확인, ARCHITECTURE.md 갱신, 커밋.
