# 편차치 99 초텐짱의 와쿠와쿠 ✞추리극장✞

천사쨩(아메)이 숨긴 정답을 **작은 힌트만으로** 맞히는 추리 게임.
힌트를 적게 열고 맞힐수록 고득점, AI가 정한 임계값을 넘기면 **탈락**.

- **UI/캐릭터**: webp_editor의 윈도우98 × 파스텔 멘헤라갸루 감성 + 마스코트(천사쨩 ⟷ 아메, 변신·강림) 차용
- **AI/로그인/저장**: txtrpg와 **동일한 Supabase 프로젝트·계정** 공유
  - 구글 OAuth 로그인 (Supabase Auth) — 유저 계정·크레딧(`profiles` 테이블) 공유
  - Gemini 텍스트 생성은 Supabase Edge Function `generate-text` 경유 (서버키·크레딧 차감 정책 txtrpg와 동일)
  - 추리극장 전적은 `quiz_results` 테이블에만 저장 — txtrpg 데이터와 완전 분리

## 스택
Vite + React 19 + TypeScript · @supabase/supabase-js

## 로컬 실행
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit + vite build → dist/
```
`.env.local` 에 txtrpg와 동일한 값:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 게임 규칙
1. 카테고리(또는 자유주제) + 난이도 + 모델 선택 → 출제
2. 첫 힌트 자동 공개. "힌트 열기"로 점점 구체적인 힌트 공개 (열수록 점수 ↓)
3. 정답 추리 제출 → AI가 의미로 정/오답 판정
4. 정답 = 클리어(등급 S/A/B/C, 점수) / 힌트를 다 쓰고도 오답 = 탈락(정답 공개)

## 배포 (Vercel) 전 체크리스트
1. **Supabase SQL Editor**에서 `supabase/migrations/004_quiz_results.sql` 1회 실행
2. **Supabase → Auth → URL Configuration**에 리디렉트 URL 추가
   - `http://localhost:5173` (로컬)
   - Vercel 배포 도메인 (`https://<project>.vercel.app`)
3. **Vercel 프로젝트 환경변수**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록
4. Framework Preset: Vite (build `npm run build`, output `dist`). `vercel.json`이 SPA 라우팅 처리.

> 전제: `generate-text`는 크레딧이 0 이하이면 거부한다. txtrpg와 같은 계정/크레딧을 공유한다.
