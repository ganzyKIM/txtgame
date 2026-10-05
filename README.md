# txtgame

윈도우 98 화면을 흉내 낸 브라우저 미니게임 모음입니다. 게임은 네 가지이고, 혼자 하거나 초대 링크로 친구를 불러 함께 합니다. 마스코트 캐릭터 둘(초텐, 아메)이 상대나 해설로 나옵니다. 변신 버튼을 누르면 캐릭터와 배색이 바뀝니다.

배포 주소: https://txtgame-two.vercel.app

## 게임

| 게임 | 혼자 | 여럿 | LLM |
|---|---|---|---|
| 추리 퀴즈(퀴즈대합전) | 카테고리 14개와 자유 주제, 난이도 3단계 | 대합전 방 | 사용 |
| 텍사스 홀덤 | 봇 2명과 3인 | 최대 4인, 빈자리에 봇 | 안 씀 |
| 오목(렌주 룰) | 난이도 3단계 | 제한시간, 봇 대국 | 안 씀 |
| 바다거북 수프(베타) | 예/아니오 질문으로 진상 맞히기 | 없음 | 사용 |

- 추리 퀴즈는 정답 하나에 힌트를 하나씩 엽니다. 힌트를 적게 보고 맞힐수록 점수가 높습니다.
- 멀티 방을 만들면 초대 링크가 나옵니다. 모바일에서는 공유 시트가 뜹니다.
- 마스코트 의상은 전적(`my_stats`)으로 해금합니다.
- 설득하기(`PersuadeGame`)와 끝말잇기(`WordChainGame`)는 미완성이라 메뉴에 넣지 않았습니다.

## 설계

- 게임 규칙은 `src/game/`의 순수 함수입니다. 싱글 플레이, 멀티 봇, 노드 테스트가 같은 코드를 씁니다.
- 멀티플레이 신뢰 모델은 게임마다 다릅니다. 홀덤은 손패가 새면 끝이라 서버 권위로 돌립니다. 카드는 `security definer` RPC로만 꺼냅니다. 오목은 숨길 정보가 없어서 공개 테이블에 착수를 쌓고 서버가 검증합니다. 퀴즈는 호스트 권위입니다.
- pg_cron이 없어서 타임아웃은 클라이언트가 요청하고 서버가 경과 시간을 다시 잽니다.
- 오목 AI는 `@algorithm.ts/gomoku`(minimax, alpha-beta) 위에 렌주 금수와 난이도 조절을 얹었습니다. Web Worker에서 돌립니다.
- 퀴즈와 수프 문제는 미리 만들어 문제은행 테이블에 쌓아 둡니다. 은행이 비었을 때만 Gemini로 새로 만듭니다. 정답이 든 테이블은 RLS로 클라이언트 조회를 막습니다.
- 홀덤과 오목은 LLM을 부르지 않아서 운영비가 들지 않습니다.

결정 배경과 실측 수치는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 있습니다.

## 스택

- Vite 6, React 19, TypeScript
- Supabase: 구글 로그인, Postgres RPC, Realtime
- LLM: [txtrpg](https://github.com/ganzyKIM/txtrpg)와 같은 Supabase 프로젝트의 Edge Function `generate-text`. 크레딧도 txtrpg와 공유하고, 잔액이 0 이하면 요청을 거부합니다.
- Vercel 배포, PWA(`vite-plugin-pwa`). 프리캐시는 JS, CSS, HTML만 합니다.

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm ci
cp .env.example .env.local
npm run dev      # http://localhost:5173
npm test         # tests/*.test.ts를 esbuild로 묶어 node --test로 실행
npm run build    # tsc 타입 검사 후 dist/에 빌드
```

| 환경변수 | 용도 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 주소. txtrpg와 같은 값 |
| `VITE_SUPABASE_ANON_KEY` | Supabase 공개 키. txtrpg와 같은 값 |
| `SEED_TOKEN` | 문제은행 적재 도구(`tools/seed-load.mjs`) 전용 |
| `GEMINI_API_KEY` | 캐릭터 이미지 생성 도구(`tools/gen-char.mjs`) 전용 |

앱 실행에는 위의 두 개만 있으면 됩니다.

## 배포

`master`에 push하면 Vercel이 배포합니다. SPA 라우팅은 `vercel.json`에 있습니다.

SQL 마이그레이션은 배포와 따로 실행합니다. `supabase/migrations/`의 새 파일을 Supabase 대시보드 SQL Editor에 통째로 붙여넣어 한 번에 실행합니다. 에디터는 스크립트 전체를 한 트랜잭션으로 돌려서, 문장 하나가 실패하면 전부 롤백됩니다. 나눠서 실행하지 않습니다.

처음 세팅할 때:

1. txtrpg의 마이그레이션과 Edge Function을 먼저 적용합니다. `profiles` 테이블과 크레딧 함수가 거기 있습니다.
2. 이 저장소의 `supabase/migrations/`를 번호 순서대로 실행합니다.
3. Supabase Auth의 URL Configuration에 리디렉트 URL을 등록합니다(`http://localhost:5173`, 배포 도메인).
4. Vercel 환경변수에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣습니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `src/components/` | 게임 화면과 로비 |
| `src/game/` | 게임 규칙, 프롬프트, 마스코트 대사 |
| `src/game/gomoku/`, `src/game/poker/` | 오목 엔진과 AI 워커, 홀덤 엔진과 봇 |
| `src/save/` | 전적과 문제은행 RPC 래퍼 |
| `supabase/migrations/` | 테이블, RLS, RPC |
| `tools/` | 캐릭터 이미지 처리, 문제은행 시드 생성과 적재, 신고 검토 |
| `.github/workflows/seed-load.yml` | `seed/**` 브랜치가 올라오면 문제은행에 적재 |
| `tests/` | 옷장 해금과 마스코트 이미지 테스트 |

## 문서

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): 구조와 설계 결정, 건드리면 깨지는 부분
- [docs/SEED_PIPELINE.md](docs/SEED_PIPELINE.md): 문제은행 시드 런북
- [docs/ideas.md](docs/ideas.md): 아직 손대지 않은 개선 아이디어
- [docs/quiz-ai-data-roadmap.md](docs/quiz-ai-data-roadmap.md): 퀴즈 데이터 활용 계획
