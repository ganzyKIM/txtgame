import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import LoginScreen from './auth/LoginScreen';
import Window from './components/Window';
import Mascot, { type MascotHandle } from './components/Mascot';
import StartScreen, { type StartConfig } from './components/StartScreen';
import GamePanel from './components/GamePanel';
import SoupGame from './components/SoupGame';
import PersuadeGame from './components/PersuadeGame';
import HoldemGame, { type HoldemGameHandle } from './components/HoldemGame';
import HoldemLobby, { type JoinedPokerRoom } from './components/HoldemLobby';
import HoldemRoomWait, { type HoldemRoomWaitHandle } from './components/HoldemRoomWait';
import { proxyGenerateText } from './api/proxy';
import { buildSetupPrompt, parsePuzzle, CATEGORIES, DIFFICULTIES, baseName, collidesWithRecent, lintHints, buildHintOnlyPrompt, parseHintOnly, pickGenAxes, PROMPT_VERSION, type GenAxes } from './game/puzzle';
import { checkWikipedia, anyTrue } from './game/wiki';
import { checkNamuWiki } from './game/namu';
import { loadBank, addToBank, updateBankStats, recordAppealUpheld, getDifficultyCalibration, normAnswerKey, type AnswerBank } from './game/answerBank';
import { judgeGuess, appealGuess, verifyPuzzle } from './game/judge';
import { computeScore } from './game/scoring';
import { saveResult, saveRun } from './save/cloudSave';
import { saveQuizGeneration, updateQuizBankStats, recordQuizAppeal, saveQuizRejection, getChronicFailures, getFailurePatterns, reportQuizProblem, pickServerBankPuzzle } from './save/quizBank';
import StatsModal from './components/StatsModal';
import DialogHost from './components/DialogHost';
import { showConfirm, showPrompt } from './lib/dialog';
import MultiplayerLobby, { type JoinedRoom } from './components/MultiplayerLobby';
import MultiplayerView from './components/MultiplayerView';
import type { MultiplayerViewHandle } from './components/MultiplayerView';
import type { GameResult, GameState, Puzzle, ExamMode } from './game/types';
import { CENTER_QUESTIONS } from './game/types';
import type { TextTier } from './types';

// ── 카테고리별 정답 이력 (localStorage 영속화) ──────────────────────
const EXCLUSION_KEY = 'txtgame_exclusions_v1';
// 출제 프롬프트에 매번 주입되는 "최근 정답(중복 금지)" 목록 상한.
// 너무 크면 입력 토큰이 그만큼 늘어 비용↑ → 반복 방지에 충분한 선에서 조절.
// 다양성 체감을 위해 더 길게 기억(괄호 제거 베이스명까지 누적되므로 실효 기억은 더 큼).
const MAX_PER_CATEGORY = 25;

function loadExclusions(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(EXCLUSION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch { return {}; }
}

function addExclusion(map: Record<string, string[]>, category: string, answer: string): Record<string, string[]> {
  const prev = map[category] ?? [];
  // 정답 원본 + 기본 이름(괄호 제거) 둘 다 등록해서 시리즈 변형 중복 차단
  const toAdd = [...new Set([answer, baseName(answer)])].filter(a => a && !prev.includes(a));
  if (toAdd.length === 0) return map;
  const updated = { ...map, [category]: [...prev.slice(-(MAX_PER_CATEGORY - toAdd.length)), ...toAdd] };
  try { localStorage.setItem(EXCLUSION_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  return updated;
}

// ── 멀티 닉네임 (localStorage 영속화) ──────────────────────────────
const NICKNAME_KEY = 'txtgame_mp_nickname_v1';
const NICKNAME_MAX_LEN = 16;

function loadSavedNickname(): string | null {
  try { return localStorage.getItem(NICKNAME_KEY); } catch { return null; }
}

function saveNickname(name: string) {
  try { localStorage.setItem(NICKNAME_KEY, name); } catch { /* ignore */ }
}

/** 프리페치 캐시 키 — 퍼즐 내용에 영향 주는 설정이 같으면 미리 만들어둔 문제를 재사용 */
function cfgKey(cfg: StartConfig): string {
  return JSON.stringify([cfg.tier, cfg.difficulty, cfg.categoryLabel, cfg.theme]);
}

/** 프리페치 캐시 최대 보관 개수 (오래된 것부터 폐기) */
const PREFETCH_CACHE_MAX = 12;

const emptyGame: GameState = {
  phase: 'setup',
  puzzle: null,
  revealedCount: 0,
  wrongGuesses: 0,
  guesses: [],
  difficulty: 'normal',
};

export default function App() {
  const { user, profile, loading: authLoading, signOut, applyBalance } = useAuth();
  const mascot = useRef<MascotHandle>(null);
  const mpViewRef = useRef<MultiplayerViewHandle>(null);
  const holdemRef = useRef<HoldemGameHandle>(null);
  const holdemWaitRef = useRef<HoldemRoomWaitHandle>(null);

  const [game, setGame] = useState<GameState>(emptyGame);
  const [result, setResult] = useState<GameResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [judging, setJudging] = useState(false);
  const [appealing, setAppealing] = useState(false);
  const [tier, setTier] = useState<TextTier>('quiz_gen');
  const [statsOpen, setStatsOpen] = useState(false);
  // 접속하면 퀴즈가 바로 뜨는 대신 데스크탑(아이콘 화면)부터 보여준다
  const [minimized, setMinimized] = useState(true);
  // 사회인모드(보스키) — 게임 상태는 그대로 두고 화면만 업무용으로 위장
  const [officeMode, setOfficeMode] = useState(false);
  // 멀티에서 보일 닉네임 — 직접 정한 게 있으면 그걸, 없으면 이메일 앞부분
  const [customNickname, setCustomNickname] = useState<string | null>(() => loadSavedNickname());
  const [lastConfig, setLastConfig] = useState<StartConfig | null>(null);
  const [mode, setMode] = useState<'quiz' | 'soup' | 'multi' | 'persuade' | 'holdem' | 'holdem-multi'>('quiz');
  const [holdemRoom, setHoldemRoom] = useState<JoinedPokerRoom | null>(null);
  const [mpRoom, setMpRoom] = useState<JoinedRoom | null>(null);
  // 센터시험(10문제 루틴)에서 완료한 문제들의 점수 (length = 완료 문제 수)
  const [runScores, setRunScores] = useState<number[]>([]);
  // 현재 판의 출제 모드 (마지막 시작 설정에서 파생)
  const examMode: ExamMode = lastConfig?.examMode ?? 'mock';
  const exclusions = useRef<Record<string, string[]>>(loadExclusions());
  const answerBank = useRef<AnswerBank>(loadBank());
  // Level 2~3: 카테고리별 실패 데이터 캐시 (첫 generatePuzzle 호출 시 백그라운드 로드)
  const failureCache = useRef<Map<string, { chronic: string[]; patterns: string[] }>>(new Map());
  // 미리 만들어둔 문제(키: cfgKey) — 즉시 출제용
  const prefetchCache = useRef<Map<string, Puzzle>>(new Map());
  // 백그라운드 생성 진행 중인 프리페치 (중복 생성 방지 + 요청 시 await 대상)
  const prefetchInFlight = useRef<Map<string, Promise<Puzzle>>>(new Map());
  // 현재 판의 설정 (프리페치 트리거가 최신 설정을 참조하도록 ref로 보관)
  const lastCfgRef = useRef<StartConfig | null>(null);
  // 이번 판에서 프리페치를 이미 시작했는지 (유저가 "이어서 할 의사"를 보인 뒤 1회만)
  const prefetchArmed = useRef(false);
  // 출제 중(busy) "처음으로"로 취소했을 때, 이미 날아간 generatePuzzle 응답이 뒤늦게
  // 도착해 취소를 덮어쓰지 않도록 하는 세션 토큰 — 값이 바뀌면 이전 요청은 폐기.
  const genSessionRef = useRef(0);
  const [log, setLog] = useState<string[]>(['> ✞퀴즈대합전✞ 준비완료. 카테고리를 골라줘… ♡']);
  const greeted = useRef(false);

  useEffect(() => {
    document.body.classList.toggle('is-minimized', minimized);
  }, [minimized]);

  useEffect(() => {
    document.body.classList.toggle('office-mode', officeMode);
  }, [officeMode]);

  // 카테고리 배경 클래스 — 퀴즈 진행 중일 때만 활성화, 수프/첫화면/로그인은 back 유지
  useEffect(() => {
    const BG_CLASSES = ['bg-garden', 'bg-kitchen', 'bg-lib', 'bg-battle', 'bg-casino'] as const;
    BG_CLASSES.forEach((c) => document.body.classList.remove(c));
    let bg: string | undefined;
    if (mode === 'holdem' || mode === 'holdem-multi') {
      bg = 'casino';
    } else if (mode === 'multi') {
      bg = CATEGORIES.find(c => c.key === mpRoom?.category_key)?.bg ?? lastConfig?.categoryBg;
    } else if (mode === 'quiz' && game.phase !== 'setup') {
      bg = lastConfig?.categoryBg;
    }
    if (bg) document.body.classList.add(`bg-${bg}`);
  }, [mode, game.phase, lastConfig?.categoryBg, mpRoom?.category_key]);

  // 최초 로그인 후 마스코트 인사
  useEffect(() => {
    if (!authLoading && user && !greeted.current) {
      greeted.current = true;
      window.setTimeout(() => mascot.current?.event('idle'), 900);
    }
  }, [authLoading, user]);

  function push(line: string) {
    setLog((l) => [...l, line].slice(-50));
  }

  // ── 한 문제 생성 (직접 출제·프리페치 공용) ────────────────────────
  // 4단계 품질 파이프라인:
  //  ① Wikipedia 실존 검증 (결정론적, 무료)
  //  ② 정답 풀 하이브리드 — trusted 정답 재사용 시 힌트만 생성 (정답 환각 원천 제거)
  //  ③ 힌트 린터 (코드, 무료) — 스포일러·중복 결정론적 차단
  //  + 중복 차단, 2차 AI 검증
  //  ④ 난이도 실측 보정 — 풀 통계로 프롬프트 피드백
  async function generatePuzzle(cfg: StartConfig): Promise<Puzzle> {
    const OTAKU_KEYS = ['otaku', 'anime', 'game'];
    const relatedLabels: string[] = OTAKU_KEYS.includes(cfg.categoryKey ?? '')
      ? CATEGORIES.filter(c => OTAKU_KEYS.includes(c.key)).map(c => c.label)
      : [cfg.categoryLabel];
    // ④ 난이도 실측 보정 신호
    const diffCalib = getDifficultyCalibration(answerBank.current, cfg.categoryKey ?? '', cfg.difficulty);

    // Level 2~3: 실패 캐시 — 없으면 백그라운드 fetch 후 다음 호출부터 반영
    const catKey = cfg.categoryKey ?? '';
    if (!failureCache.current.has(catKey)) {
      void Promise.all([getChronicFailures(catKey), getFailurePatterns(catKey)])
        .then(([chronic, patterns]) => failureCache.current.set(catKey, { chronic, patterns }));
    }
    const failureData = failureCache.current.get(catKey);
    const chronicFailures = failureData?.chronic ?? [];
    const failurePatterns = failureData?.patterns ?? [];

    const baseExclusions = [...new Set([
      ...relatedLabels.flatMap(label => exclusions.current[label] ?? []),
      ...chronicFailures,  // Level 2: 만성 실패 정답 자동 차단
    ])];

    // ① 서버 문제은행 우선 재사용 — 적중하면 AI 호출 없이 출제(0크레딧).
    //    저장된 힌트 세트는 전부 생성 당시 검증을 통과했으므로 재검증도 생략.
    //    항상 뱅크만 쓰면 신선도가 떨어지므로 확률 상한을 둔다.
    const SERVER_BANK_REUSE_P = 0.65;
    if (Math.random() < SERVER_BANK_REUSE_P) {
      const hit = await pickServerBankPuzzle(catKey, cfg.difficulty, baseExclusions);
      if (hit) {
        const reused: Puzzle = {
          answer: hit.answer,
          hints: hit.hints,
          maxHints: hit.maxHints,
          acceptable: hit.acceptable,
          category: cfg.categoryLabel,
          categoryKey: catKey,
          theme: cfg.theme,
        };
        if (!collidesWithRecent(reused, baseExclusions)) {
          push('> ♻ 문제은행에서 검증된 문제 재사용 (크레딧 0)');
          answerBank.current = addToBank(answerBank.current, {
            answer: reused.answer, categoryKey: catKey, categoryLabel: cfg.categoryLabel,
            acceptable: reused.acceptable, wikiVerified: true, difficultyLabeled: cfg.difficulty,
          });
          exclusions.current = addExclusion(exclusions.current, cfg.categoryLabel, reused.answer);
          return reused;
        }
      }
    }

    const MAX_RETRY = 2;
    const extraBanned: string[] = [];
    let puzzle!: Puzzle;

    // 채택된 문제의 생성 메타데이터 (서버 DB 저장용)
    let genSource: 'ai_fresh' | 'bank_reuse' = 'ai_fresh';
    let genAxes: GenAxes | null = null;
    let genWiki = false, genLint = false, genVerify = false, genVerifyProblem = '';

    for (let attempt = 0; ; attempt++) {
      // exclusions.current를 매 시도마다 다시 읽는다 — 프리페치 등 동시에 도는 다른
      // generatePuzzle() 호출이 그 사이 정답을 하나 확정했을 수 있어(경쟁 상태),
      // 루프 진입 전 한 번만 스냅샷 뜨면 그 갱신을 못 보고 같은 답이 중복 출제된다.
      const liveExclusions = [...new Set([
        ...relatedLabels.flatMap(label => exclusions.current[label] ?? []),
        ...chronicFailures,
      ])];
      const banned = [...new Set([...liveExclusions, ...baseExclusions, ...extraBanned])];
      let cand: Puzzle;
      let candAxes: GenAxes | null = null;

      // 새 정답 생성 — 다양성 축을 밖에서 뽑아 프롬프트에 주입 + 저장용 보관
      // (로컬 localStorage 뱅크 재사용은 제거함 — 위키검증을 스킵해도 되는 근거가
      //  "서버가 이미 검증한 답"이어야 하는데, 로컬 뱅크는 강제채택된 미검증 답도
      //  wikiVerified=true로 잘못 기록해 그게 영구히 재순환하는 사고가 있었다.
      //  진짜 검증된 재사용은 앞의 서버 pickServerBankPuzzle 경로가 담당한다.)
      candAxes = pickGenAxes();
      const { text, balance } = await proxyGenerateText(
        cfg.tier,
        [{ role: 'user', text: `카테고리: ${cfg.categoryLabel}\n주제: ${cfg.theme || '(자유)'}\n위 조건으로 문제를 출제해줘.` }],
        { system: buildSetupPrompt(cfg.categoryLabel, cfg.theme, cfg.difficulty, banned, cfg.categoryPrompt, cfg.categoryKey, diffCalib, candAxes, failurePatterns), temperature: 0.8 },
      );
      applyBalance(balance);
      cand = parsePuzzle(text, cfg.categoryLabel, cfg.theme);

      // 마지막 시도는 무조건 채택 (무한루프·과도한 호출 방지)
      // — 검증을 건너뛰었으므로 통과 플래그는 전부 미검증(false)으로 남긴다
      // → 뱅크에는 안 쌓이고 quiz_generations 로그에만 남음(재사용 대상 아님).
      if (attempt >= MAX_RETRY) {
        puzzle = cand;
        genSource = 'ai_fresh';
        genAxes = candAxes;
        break;
      }

      // 중복 차단
      if (collidesWithRecent(cand, banned)) {
        extraBanned.push(cand.answer, baseName(cand.answer));
        push(`> ↻ 중복 정답("${cand.answer}") 감지 — 다시 출제`);
        continue;
      }

      // ③ 힌트 린터 (결정론적, 무료)
      const lintIssues = lintHints(cand, cfg.categoryLabel, catKey);
      if (lintIssues.length > 0) {
        extraBanned.push(cand.answer, baseName(cand.answer));
        push(`> ↻ 힌트 품질 문제(${lintIssues[0]}) — 다시 출제`);
        void saveQuizRejection({ categoryKey: catKey, categoryLabel: cfg.categoryLabel, answer: cand.answer, hints: cand.hints, maxHints: cand.maxHints, rejectStage: 'lint', rejectReason: lintIssues[0] });
        continue;
      }

      // ① 실존 검증(위키·나무위키를 처음부터 동시에 조회 — "위키 실패 후에만 나무위키" 직렬 폴백은
      //    최악의 경우 위키 대기 + 나무위키 대기가 그대로 더해져서, 처음부터 둘 다 쏘고 하나만
      //    통과해도 즉시 확정한다)와 ② 2차 AI 검증을 모두 병렬 실행.
      const wikiPromise: Promise<boolean> = anyTrue([checkWikipedia(cand.answer), checkNamuWiki(cand.answer)]);
      const verifyPromise = verifyPuzzle(cand);
      const [wikiOk, v] = await Promise.all([wikiPromise, verifyPromise]);
      if (typeof v.balance === 'number') applyBalance(v.balance);

      if (!wikiOk) {
        extraBanned.push(cand.answer, baseName(cand.answer));
        push(`> ↻ 위키백과·나무위키 미확인("${cand.answer}") — 다시 출제`);
        void saveQuizRejection({ categoryKey: catKey, categoryLabel: cfg.categoryLabel, answer: cand.answer, hints: cand.hints, maxHints: cand.maxHints, rejectStage: 'wiki', rejectReason: '위키백과·나무위키 문서 없음' });
        continue;
      }

      if (!v.ok) {
        // 정답 자체는 위키 검증을 통과했으므로 버리지 않고, 힌트만 1회 재생성해본다.
        // (정답 재선정 + 위키 재검증을 건너뛰므로 전체 재출제보다 빠르다)
        let repaired: Puzzle | null = null;
        try {
          const { text, balance: repairBalance } = await proxyGenerateText(
            cfg.tier,
            [{ role: 'user', text: `정답 "${cand.answer}"에 대한 힌트를 아래 문제점을 고쳐서 다시 만들어줘.\n[문제점] ${v.problem || '품질 미달'}` }],
            { system: buildHintOnlyPrompt(cand.answer, cfg.categoryLabel, cfg.difficulty, cfg.categoryPrompt), temperature: 0.7 },
          );
          applyBalance(repairBalance);
          repaired = parseHintOnly(text, cand.answer, cfg.categoryLabel, cfg.theme, cand.acceptable);
        } catch { /* 재생성 실패 — 아래에서 전체 재출제로 폴백 */ }

        if (repaired && lintHints(repaired, cfg.categoryLabel, catKey).length === 0) {
          const v2 = await verifyPuzzle(repaired);
          if (typeof v2.balance === 'number') applyBalance(v2.balance);
          if (v2.ok) {
            push(`> ✓ 힌트 재생성으로 복구("${cand.answer}")`);
            puzzle = repaired;
            genSource = 'ai_fresh';
            genAxes = candAxes;
            genWiki = true; genLint = true; genVerify = true; genVerifyProblem = v2.problem ?? '';
            break;
          }
        }

        // 힌트 재생성도 실패 — 정답 자체를 버리고 전체 재출제
        extraBanned.push(cand.answer, baseName(cand.answer));
        push(`> ↻ 검증 탈락(${v.problem || '품질 미달'}) — 다시 출제`);
        void saveQuizRejection({ categoryKey: catKey, categoryLabel: cfg.categoryLabel, answer: cand.answer, hints: cand.hints, maxHints: cand.maxHints, rejectStage: 'verify', rejectReason: v.problem || '품질 미달' });
        // 실패 패턴 캐시 무효화 — 다음 generatePuzzle에서 새 패턴 반영
        failureCache.current.delete(catKey);
        continue;
      }

      // 모든 검증 통과
      puzzle = cand;
      genSource = 'ai_fresh';
      genAxes = candAxes;
      genWiki = true; genLint = true; genVerify = true; genVerifyProblem = v.problem ?? '';
      break;
    }

    puzzle.categoryKey = cfg.categoryKey ?? '';

    // 로컬 난이도 보정용 통계 누적(재사용 아님 — 실제 답 재활용은 서버 뱅크가 전담)
    answerBank.current = addToBank(answerBank.current, {
      answer: puzzle.answer,
      categoryKey: cfg.categoryKey ?? '',
      categoryLabel: cfg.categoryLabel,
      acceptable: puzzle.acceptable,
      wikiVerified: genWiki,
      difficultyLabeled: cfg.difficulty,
    });

    // 서버 퀴즈 DB 적재 (fire-and-forget) — 생성 콘텐츠 + 검증·출처 메타
    void saveQuizGeneration({
      categoryKey: cfg.categoryKey ?? '',
      categoryLabel: cfg.categoryLabel,
      theme: puzzle.theme,
      answer: puzzle.answer,
      acceptable: puzzle.acceptable,
      hints: puzzle.hints,
      maxHints: puzzle.maxHints,
      difficultyLabeled: cfg.difficulty,
      promptVersion: PROMPT_VERSION,
      genEra: genAxes?.era ?? null,
      genRegion: genAxes?.region ?? null,
      genAngle: genAxes?.angle ?? null,
      source: genSource,
      wikiVerified: genWiki,
      lintPassed: genLint,
      verifyPassed: genVerify,
      verifyProblem: genVerifyProblem,
    });

    exclusions.current = addExclusion(exclusions.current, cfg.categoryLabel, puzzle.answer);
    return puzzle;
  }

  // 준비된 문제로 즉시 플레이 화면 전환
  function startWithPuzzle(puzzle: Puzzle, cfg: StartConfig) {
    lastCfgRef.current = cfg;
    prefetchArmed.current = true;
    setGame({
      phase: 'playing',
      puzzle,
      revealedCount: 1, // 첫 힌트는 자동 공개
      wrongGuesses: 0,
      guesses: [],
      difficulty: cfg.difficulty,
    });
    push(`> 출제 완료! 힌트 ${puzzle.hints.length}개 · 탈락 임계값 ${puzzle.maxHints} · 첫 힌트 공개`);
    mascot.current?.event('intro');
    // 문제 표시 즉시 다음 문제 백그라운드 생성 시작 (센터시험 마지막 문제 제외)
    if (!(cfg.examMode === 'center' && runScores.length >= CENTER_QUESTIONS - 1)) {
      prefetchNext(cfg);
    }
  }

  function maybePrefetch() { /* prefetch는 startWithPuzzle에서 즉시 시작하므로 no-op */ }

  // ── 다음 문제 백그라운드 미리 생성 ────────────────────────────────
  // 유저가 현재 문제를 푸는 동안 같은 설정의 다음 문제를 만들어 캐시에 넣어둔다.
  // 다른 카테고리로 가도 캐시에 남아, 나중에 같은 설정을 다시 고르면 즉시 재사용된다.
  // (크레딧은 미리 차감되지만, 미사용분은 캐시로 회수해 낭비를 줄인다.)
  function prefetchNext(cfg: StartConfig) {
    const key = cfgKey(cfg);
    if (prefetchCache.current.has(key) || prefetchInFlight.current.has(key)) return;
    const promise = generatePuzzle(cfg);
    prefetchInFlight.current.set(key, promise);
    promise
      .then((puz) => {
        // 캐시 상한 초과 시 가장 오래된 항목부터 제거
        if (prefetchCache.current.size >= PREFETCH_CACHE_MAX) {
          const oldest = prefetchCache.current.keys().next().value;
          if (oldest !== undefined) prefetchCache.current.delete(oldest);
        }
        prefetchCache.current.set(key, puz);
        push('> ◇ 다음 문제를 미리 만들어뒀어 ♡');
      })
      .catch(() => { /* 조용히 실패 — 요청 시 즉석 생성으로 폴백 */ })
      .finally(() => { prefetchInFlight.current.delete(key); });
  }

  // ── 게임 시작: 출제 ───────────────────────────────────────────────
  async function handleStart(cfg: StartConfig) {
    setResult(null);
    setTier(cfg.tier);
    setLastConfig(cfg);
    const key = cfgKey(cfg);

    // 1) 미리 만들어둔 문제가 있으면 크레딧 추가 소모 없이 즉시 출제
    const ready = prefetchCache.current.get(key);
    if (ready) {
      prefetchCache.current.delete(key);
      push(`> ⚡ 미리 준비된 문제로 바로 출제! [${cfg.categoryLabel}${cfg.theme ? ' · ' + cfg.theme : ''}]`);
      startWithPuzzle(ready, cfg);
      // 다음 문제 프리페치는 유저가 이어서 풀 의사를 보일 때(maybePrefetch) 시작
      return;
    }

    // 2) 캐시에 없으면 생성 — 백그라운드 생성이 진행 중이면 그걸 기다려 대기시간을 줄인다
    const mySession = ++genSessionRef.current; // 출제 중 "처음으로"로 취소되면 이 세션은 폐기
    setBusy(true);
    push(`> 출제 중… [${cfg.categoryLabel}${cfg.theme ? ' · ' + cfg.theme : ''}]`);
    mascot.current?.event('loading');
    const loadingTick = window.setInterval(() => mascot.current?.event('loading'), 4000);
    try {
      const inflight = prefetchInFlight.current.get(key);
      let puzzle: Puzzle;
      if (inflight) {
        try { puzzle = await inflight; }
        catch { puzzle = await generatePuzzle(cfg); } // 프리페치 실패 → 즉석 재생성
      } else {
        puzzle = await generatePuzzle(cfg);
      }
      prefetchCache.current.delete(key); // 방금 소비한 항목 정리
      if (mySession !== genSessionRef.current) return; // 그새 취소됨 — 결과 버림
      startWithPuzzle(puzzle, cfg);
      // 다음 문제 프리페치는 maybePrefetch(첫 힌트 공개/첫 추측)에서 시작
    } catch (e) {
      if (mySession !== genSessionRef.current) return; // 그새 취소됨 — 실패 처리도 무시
      push(`! 출제 실패: ${(e as Error).message}`);
      mascot.current?.say('으… 출제에 실패했어. 다시 해줄래?');
      setGame(emptyGame);
    } finally {
      window.clearInterval(loadingTick);
      // 그새 새 세션이 시작됐으면(취소 후 재출제) 그쪽의 busy 상태를 지우면 안 됨
      if (mySession === genSessionRef.current) setBusy(false);
    }
  }

  // ── 힌트 공개 ─────────────────────────────────────────────────────
  function handleReveal() {
    maybePrefetch(); // 힌트를 더 연다 = 이어서 풀 의사 → 다음 문제 미리 준비 시작
    setGame((g) => {
      if (g.phase !== 'playing' || !g.puzzle) return g;
      if (g.revealedCount >= g.puzzle.maxHints) return g;
      const revealedCount = g.revealedCount + 1;
      push(`> 힌트 #${revealedCount} 공개`);
      mascot.current?.event('hint');
      return { ...g, revealedCount };
    });
  }

  // ── 한 문제 종료 시 기록 ──────────────────────────────────────────
  // 센터시험: 점수를 런에 누적(저장은 10문제 완주 시 1회). 탈락/포기는 0점.
  // 모의시험: 기존대로 문제별로 quiz_results에 저장.
  function recordQuestionEnd(r: GameResult) {
    if (examMode === 'center') {
      const next = [...runScores, r.won ? r.score : 0];
      setRunScores(next);
      if (next.length >= CENTER_QUESTIONS && user) {
        const total = next.reduce((a, b) => a + b, 0);
        void saveRun(user.id, { totalScore: total, questions: next.length, category: r.category });
        push(`> 🎯 센터시험 종료! 총점 ${total}점 (${CENTER_QUESTIONS}문제)`);
      }
    } else if (user) {
      void saveResult(user.id, r);
    }
  }

  // 센터시험: 다음 문제로 (런 점수 유지). 모의시험에선 쓰지 않음.
  function handleNextQuestion() {
    if (!lastConfig || busy) return;
    setResult(null);
    void handleStart(lastConfig);
  }

  // ── 추리 제출 ─────────────────────────────────────────────────────
  async function handleGuess(text: string) {
    if (!game.puzzle || game.phase !== 'playing') return;
    maybePrefetch(); // 추측 시도 = 이어서 풀 의사 → 다음 문제 미리 준비 시작
    setJudging(true);
    push(`> 추측: "${text}"`);
    mascot.current?.event('judging');
    try {
      const res = await judgeGuess(game.puzzle, text, tier);
      if (typeof res.balance === 'number') applyBalance(res.balance);

      if (res.correct) {
        const score = computeScore(game.revealedCount, game.puzzle.maxHints, game.wrongGuesses);
        const r: GameResult = {
          category: game.puzzle.category,
          theme: game.puzzle.theme,
          answer: game.puzzle.answer,
          hintsUsed: game.revealedCount,
          won: true,
          score: score.score,
          rank: score.rank,
        };
        setGame((g) => ({
          ...g,
          phase: 'won',
          guesses: [...g.guesses, { text, correct: true, reason: res.reason }],
        }));
        setResult(r);
        push(`> ⭕ 정답! 등급 ${r.rank} · ${r.score}점`);
        mascot.current?.event('win');
        recordQuestionEnd(r);
        // ④ 정답 풀 통계 반영 (로컬 + 서버)
        answerBank.current = updateBankStats(answerBank.current, normAnswerKey(game.puzzle.answer), { won: true, hintsUsed: game.revealedCount });
        void updateQuizBankStats(game.puzzle.answer, game.puzzle.categoryKey ?? '', true, game.revealedCount);
        return;
      }

      // 오답
      const wrongGuesses = game.wrongGuesses + 1;
      const exhausted = game.revealedCount >= game.puzzle.maxHints;
      if (exhausted) {
        const r: GameResult = {
          category: game.puzzle.category,
          theme: game.puzzle.theme,
          answer: game.puzzle.answer,
          hintsUsed: game.revealedCount,
          won: false,
          score: 0,
          rank: '-',
        };
        setGame((g) => ({
          ...g,
          phase: 'lost',
          wrongGuesses,
          guesses: [...g.guesses, { text, correct: false, reason: res.reason }],
        }));
        setResult(r);
        push(`> ❌ 탈락… 정답은 "${game.puzzle.answer}"`);
        mascot.current?.event('eliminated');
        recordQuestionEnd(r);
        // ④ 정답 풀 통계 반영 (로컬 + 서버)
        answerBank.current = updateBankStats(answerBank.current, normAnswerKey(game.puzzle.answer), { won: false, hintsUsed: game.revealedCount });
        void updateQuizBankStats(game.puzzle.answer, game.puzzle.categoryKey ?? '', false, game.revealedCount);
      } else {
        setGame((g) => ({
          ...g,
          wrongGuesses,
          guesses: [...g.guesses, { text, correct: false, reason: res.reason }],
        }));
        push('> ❌ 오답. 힌트를 더 열거나 다시 추측해봐.');
        mascot.current?.event('wrong');
      }
    } finally {
      setJudging(false);
    }
  }

  async function handleAppeal(guessText: string) {
    if (!game.puzzle || (game.phase !== 'playing' && game.phase !== 'lost')) return;
    setAppealing(true);
    push(`> ⚖ 이의제기: "${guessText}"`);
    mascot.current?.event('judging');
    try {
      const revealedHints = game.puzzle.hints.slice(0, game.revealedCount);
      const res = await appealGuess(game.puzzle, guessText, revealedHints);
      if (typeof res.balance === 'number') applyBalance(res.balance);

      if (res.correct) {
        const score = computeScore(game.revealedCount, game.puzzle.maxHints, game.wrongGuesses);
        const r: GameResult = {
          category: game.puzzle.category,
          theme: game.puzzle.theme,
          answer: guessText,
          hintsUsed: game.revealedCount,
          won: true,
          score: score.score,
          rank: score.rank,
        };
        setGame((g) => ({ ...g, phase: 'won', guesses: [...g.guesses, { text: `${guessText} (이의제기 인용)`, correct: true, reason: res.reason }] }));
        setResult(r);
        push(`> ✅ 이의제기 인용! "${guessText}" 정답으로 인정됨`);
        mascot.current?.event('win');
        if (user) void saveResult(user.id, r);
        // 이의제기 인용 = 저장된 정답이 환각이었을 가능성 → 정답 풀 신뢰도 감소 (로컬 + 서버)
        if (game.puzzle) {
          answerBank.current = recordAppealUpheld(answerBank.current, normAnswerKey(game.puzzle.answer));
          void recordQuizAppeal(game.puzzle.answer, game.puzzle.categoryKey ?? '');
        }
      } else {
        push(`> ⚖ 이의제기 기각 — ${res.reason}`);
        mascot.current?.event('wrong');
      }
    } finally {
      setAppealing(false);
    }
  }

  function handleEliminate() {
    if (!game.puzzle || game.phase !== 'playing') return;
    const r: GameResult = {
      category: game.puzzle.category,
      theme: game.puzzle.theme,
      answer: game.puzzle.answer,
      hintsUsed: game.revealedCount,
      won: false,
      score: 0,
      rank: '-',
    };
    setGame((g) => ({ ...g, phase: 'lost' }));
    setResult(r);
    push(`> ⚠ 포기… 정답은 "${game.puzzle.answer}"`);
    mascot.current?.event('eliminated');
    recordQuestionEnd(r);
  }

  function handleReport(reason: 'hallucination' | 'off_topic') {
    if (!game.puzzle) return;
    void reportQuizProblem(game.puzzle.answer, game.puzzle.categoryKey ?? '', reason);
  }

  function handleRestart() {
    genSessionRef.current++; // 출제 중이었다면 그 결과가 나중에 도착해도 무시하도록 세션 무효화
    setBusy(false);
    setGame(emptyGame);
    setResult(null);
    setRunScores([]); // 진행 중이던 센터시험 런 폐기 (중간 이탈 = 기록 안 함)
    push('> 새 문제를 준비할게. 카테고리를 골라줘! ♡');
  }

  function handleRestartSame() {
    if (!lastConfig || busy) return;
    // setup 화면으로 돌아가지 않고 바로 재시작 (센터: 새 런 / 모의: 한번 더)
    setResult(null);
    setRunScores([]);
    void handleStart(lastConfig);
  }

  function handleMinimize() {
    setMinimized(true);
  }

  // 사회인모드 진입 — 게임 상태는 그대로 두고 화면만 위장, 마스코트는 안 보이게
  function handleEnterOffice() {
    setOfficeMode(true);
    mascot.current?.banish();
  }

  // "변신" 버튼: 사회인모드 중엔 원래 화면 복귀, 평소엔 원래대로 마스코트 변신
  function handleTransformOrExitOffice() {
    if (officeMode) {
      setOfficeMode(false);
      mascot.current?.summon();
      mascot.current?.event('office_exit');
    } else {
      mascot.current?.transform();
    }
  }

  function handleClose() {
    push('> 아직 더 놀아야 해~! 허락 없이는 나갈 수 없어! ♡');
    mascot.current?.event('close');
  }

  async function handleLogout() {
    await signOut();
  }

  if (authLoading) {
    return <div className="login-wrap"><div className="login-card"><div className="login-body">불러오는 중… ♡</div></div></div>;
  }
  if (!user) return <LoginScreen />;

  const myNickname = customNickname?.trim() || (user?.email?.split('@')[0] ?? 'player');

  // 멀티 진입 전 닉네임을 정하게 한다 — 이전에 정한 게 있으면 기본값으로 채워두고 수정만 하면 됨.
  // 취소하면 멀티에 들어가지 않는다(닉네임 없이 들어가는 경로를 만들지 않기 위함).
  async function handleEnterMulti() {
    const name = await showPrompt({
      title: '대합전 닉네임',
      message: '멀티에서 다른 사람에게 보일 닉네임을 정해줘! (최대 16자)',
      defaultValue: myNickname,
      maxLength: NICKNAME_MAX_LEN,
      confirmLabel: '입장',
      cancelLabel: '취소',
    });
    if (name === null) return;
    const trimmed = name.trim().slice(0, NICKNAME_MAX_LEN);
    if (!trimmed) return;
    setCustomNickname(trimmed);
    saveNickname(trimmed);
    setMode('multi');
    setMpRoom(null);
  }

  // 홀덤 멀티도 퀴즈 멀티와 동일한 규칙: 진입 전 닉네임을 정하게 하고, 취소하면 들어가지 않는다.
  async function handleEnterHoldemMulti() {
    const name = await showPrompt({
      title: '홀덤 닉네임',
      message: '멀티에서 다른 사람에게 보일 닉네임을 정해줘! (최대 16자)',
      defaultValue: myNickname,
      maxLength: NICKNAME_MAX_LEN,
      confirmLabel: '입장',
      cancelLabel: '취소',
    });
    if (name === null) return;
    const trimmed = name.trim().slice(0, NICKNAME_MAX_LEN);
    if (!trimmed) return;
    setCustomNickname(trimmed);
    saveNickname(trimmed);
    setMode('holdem-multi');
    setHoldemRoom(null);
  }

  const statusText =
    mode === 'soup'  ? '🐢 바다거북 수프'
    : mode === 'persuade' ? '💬 천사쨩 설득하기'
    : mode === 'holdem' ? '🃏 텍사스 홀덤'
    : mode === 'holdem-multi' ? (holdemRoom ? `🃏 ${holdemRoom.hostNickname}의 테이블` : '🃏 텍사스 홀덤 · 멀티 대기실')
    : mode === 'multi' ? (mpRoom ? `◆ 대합전 중 · ${mpRoom.category_label} · ${DIFFICULTIES.find(d => d.key === mpRoom.difficulty)?.label ?? mpRoom.difficulty}` : '◆ 대합전 대기실')
    : game.phase === 'setup' ? '준비됨 ♡'
    : game.phase === 'playing' ? `진행 중 · 힌트 ${game.revealedCount}/${game.puzzle?.maxHints}`
    : game.phase === 'won' ? '클리어! ♡'
    : '탈락…';

  return (
    <>
      {minimized ? (
        <>
          <div className="desktop-toolbar">
            <button
              className="mascot-transform"
              onClick={handleTransformOrExitOffice}
              title={officeMode ? '원래대로' : '변신!'}
            >
              {officeMode ? '⚙' : <><span className="menu-icon">✧</span> 변신 <span className="menu-icon">✧</span></>}
            </button>
            {!officeMode && (
              <button className="menu-btn" onClick={handleEnterOffice} title="사회인모드 (업무용 배색으로 전환)">
                <span className="menu-icon">🗂️</span>
                <span className="menu-label-full">사회인모드</span>
                <span className="menu-label-short">사회인</span>
              </button>
            )}
          </div>
          <div className="desktop-icons">
          <div className="desktop-icon" onClick={() => { setMode('quiz'); setMinimized(false); }}>
            <img className="desktop-icon-img" src="/icon_neko.png" alt="퀴즈대합전" draggable={false} />
            <span className="desktop-icon-label">✞퀴즈대합전✞</span>
          </div>
          <div className="desktop-icon" onClick={() => { setMode('holdem'); setMinimized(false); }}>
            <img className="desktop-icon-img" src="/icon_poker.webp" alt="텍사스 홀덤" draggable={false} />
            <span className="desktop-icon-label">🃏 텍사스 홀덤</span>
          </div>
          <div className="desktop-icon" onClick={() => { setMode('soup'); setMinimized(false); }}>
            <img className="desktop-icon-img" src="/icon_kame.png" alt="바다거북수프" draggable={false} />
            <span className="desktop-icon-label">🐢 바다거북수프 <small style={{fontSize:'10px',opacity:.8}}>(beta)</small></span>
          </div>
          </div>
        </>
      ) : (
        <Window
          credits={profile?.credits ?? null}
          consoleLines={log}
          statusText={statusText}
          onTransform={handleTransformOrExitOffice}
          onLogout={() => void handleLogout()}
          onOpenStats={() => setStatsOpen(true)}
          onMinimize={handleMinimize}
          onClose={handleClose}
          hideConsole={mode === 'multi' || mode === 'holdem' || mode === 'holdem-multi'}
          officeMode={officeMode}
          onEnterOffice={handleEnterOffice}
          onMultiplay={mode === 'quiz' && game.phase === 'setup' && !busy ? () => void handleEnterMulti() : undefined}
          onHome={
            mode === 'multi' ? () => {
              void showConfirm('대합전을 나가시겠어요?').then((ok) => {
                if (!ok) return;
                void mpViewRef.current?.leaveRoom();
                setMode('quiz'); setMpRoom(null);
              });
            }
            // 홀덤의 "처음으로"는 카테고리 화면이 아니라 홀덤 자체의 첫 화면(구매 화면)으로
            : mode === 'holdem' ? () => holdemRef.current?.goHome()
            : mode === 'holdem-multi' ? () => {
              void showConfirm('테이블을 나가시겠어요?').then((ok) => {
                if (!ok) return;
                void holdemWaitRef.current?.leaveRoom();
                setMode('holdem'); setHoldemRoom(null);
              });
            }
            // 출제 중(busy)에도 "처음으로"가 떠서 취소할 수 있어야 함(멀티 버튼 대신)
            : mode === 'quiz' && (game.phase !== 'setup' || busy) && !judging ? handleRestart
            : undefined
          }
        >
          {mode === 'multi' ? (
            mpRoom ? (
              <MultiplayerView
                ref={mpViewRef}
                room={mpRoom}
                myUserId={user.id}
                myNickname={myNickname}
                tier={tier}
                generatePuzzle={generatePuzzle}
                onLeave={() => setMpRoom(null)}
                onMascotEvent={kind => mascot.current?.event(kind)}
              />
            ) : (
              <MultiplayerLobby
                myUserId={user.id}
                myNickname={myNickname}
                onJoin={(room) => setMpRoom(room)}
              />
            )
          ) : mode === 'persuade' ? (
            <PersuadeGame
              mascot={mascot}
              push={push}
              applyBalance={applyBalance}
              onExit={() => setMode('quiz')}
            />
          ) : mode === 'holdem' ? (
            <HoldemGame
              ref={holdemRef}
              mascot={mascot}
              push={push}
              applyBalance={applyBalance}
              onGoMulti={() => void handleEnterHoldemMulti()}
            />
          ) : mode === 'holdem-multi' ? (
            holdemRoom ? (
              <HoldemRoomWait
                ref={holdemWaitRef}
                room={holdemRoom}
                myUserId={user.id}
                mascot={mascot}
                applyBalance={applyBalance}
                onLeave={() => setHoldemRoom(null)}
              />
            ) : (
              <HoldemLobby
                myUserId={user.id}
                myNickname={myNickname}
                mascot={mascot}
                onJoin={(room) => setHoldemRoom(room)}
                onExit={() => setMode('holdem')}
              />
            )
          ) : mode === 'soup' ? (
            <SoupGame
              tier={tier}
              userId={user.id}
              mascot={mascot}
              push={push}
              applyBalance={applyBalance}
              onExit={() => setMode('quiz')}
            />
          ) : game.phase === 'setup' ? (
            busy ? (
              <div className="generating-full">
                <div className="generating-wrap">
                  <div className="generating-label">◆ 문제 출제 중 ◆</div>
                  <div className="generating-bar-bg">
                    <div className="generating-bar-fill" />
                  </div>
                  <div className="generating-sub">Please wait ♡</div>
                </div>
              </div>
            ) : (
              <StartScreen
                busy={busy}
                onStart={(cfg) => { setRunScores([]); void handleStart(cfg); }}
              />
            )
          ) : (
            <GamePanel
              state={game}
              judging={judging}
              result={result}
              generating={busy}
              examMode={examMode}
              runScores={runScores}
              onReveal={handleReveal}
              onGuess={(t) => void handleGuess(t)}
              onRestart={handleRestart}
              onRestartSame={lastConfig ? handleRestartSame : undefined}
              onEliminate={handleEliminate}
              onAppeal={(t) => void handleAppeal(t)}
              appealing={appealing}
              onNext={handleNextQuestion}
              onReport={handleReport}
            />
          )}
        </Window>
      )}
      <Mascot ref={mascot} />
      {statsOpen && user && (
        <StatsModal userId={user.id} onClose={() => setStatsOpen(false)} />
      )}
      <DialogHost />
    </>
  );
}
