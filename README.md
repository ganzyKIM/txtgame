# 편차치 99 초텐짱의 와쿠와쿠 ✞추리극장✞

윈도우98 × 파스텔 멘헤라갸루 감성의 미니게임 모음. 마스코트(초텐쨩 ⟷ 아메)가 모든 게임에
상대·해설·응원역으로 등장하고, 변신 버튼으로 성격과 배색이 통째로 바뀐다.

## 게임

| 게임 | 모드 | AI 비용 |
|---|---|---|
| ✞퀴즈대합전✞ | 싱글 · 멀티(대합전) | LLM |
| 🃏 텍사스 홀덤 | 싱글(3인) · 멀티(최대 4인, 봇 추가 가능) | 0원 |
| ⚫ 오목 (렌주 룰) | 싱글(난이도 3단계) · 멀티(제한시간·봇) | 0원 |
| 🐢 바다거북수프 | 싱글 (beta) | LLM |

멀티는 방을 만들면 **초대 링크**를 바로 공유할 수 있다(모바일은 네이티브 공유 시트).

설득하기(`PersuadeGame`)와 끝말잇기(`WordChainGame`)는 코드만 있고 **아직 진입 경로를 안
붙였다** — 미완이라 일부러 숨긴 것이니 "아이콘이 빠졌다"고 고치지 말 것.

## 스택

Vite + React 19 + TypeScript · Supabase(Auth · Postgres RPC · Realtime) · Vercel · PWA

- 구글 OAuth 로그인, 크레딧(`profiles`)은 txtrpg와 **같은 Supabase 프로젝트를 공유**한다
- LLM 호출은 Edge Function `generate-text` 경유 (서버키 보관 + 크레딧 차감).
  **크레딧이 0 이하면 거부**된다
- 홀덤·오목은 LLM을 쓰지 않는다 — 순수 탐색 로직이라 운영비가 0원

## 로컬 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit + vite build → dist/
```

`.env.local` (txtrpg와 동일한 값):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 배포

`git push origin master` → Vercel 자동 배포.

**SQL 마이그레이션은 배포와 별개다.** `supabase/migrations/`의 새 파일을 Supabase 대시보드
SQL Editor에 **통째로 붙여넣어 한 번에 실행**해야 한다(CLI 접근 없음).

> ⚠ 에디터가 스크립트 전체를 한 트랜잭션으로 돌린다. **문장 하나가 실패하면 전부 롤백**되므로
> 절대 쪼개서 실행하지 말 것. 실행 후 원하는 함수/제약이 실제로 생겼는지 확인하는 습관을 권장.

최초 세팅 시:
1. `supabase/migrations/` 전체를 번호 순서대로 실행
2. Supabase → Auth → URL Configuration에 리디렉트 URL 등록
   (`http://localhost:5173`, Vercel 배포 도메인)
3. Vercel 환경변수에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록
4. Framework Preset: Vite (build `npm run build`, output `dist`) — SPA 라우팅은 `vercel.json`

## 문서

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 구조와 설계 결정, 다시 건드리면 깨지는 것들
- [docs/ideas.md](docs/ideas.md) — 미착수 재미 개선 아이디어
- [docs/quiz-ai-data-roadmap.md](docs/quiz-ai-data-roadmap.md) — 퀴즈 데이터 활용 로드맵
