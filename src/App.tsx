import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import LoginScreen from './auth/LoginScreen';
import Window from './components/Window';
import Mascot, { type MascotHandle } from './components/Mascot';
import StartScreen, { type StartConfig } from './components/StartScreen';
import GamePanel from './components/GamePanel';
import SoupGame from './components/SoupGame';
import { proxyGenerateText } from './api/proxy';
import { buildSetupPrompt, parsePuzzle } from './game/puzzle';
import { judgeGuess } from './game/judge';
import { computeScore } from './game/scoring';
import { saveResult } from './save/cloudSave';
import StatsModal from './components/StatsModal';
import type { GameResult, GameState, Puzzle } from './game/types';
import type { TextTier } from './types';

// ── 카테고리별 정답 이력 (localStorage 영속화) ──────────────────────
const EXCLUSION_KEY = 'txtgame_exclusions_v1';
// 출제 프롬프트에 매번 주입되는 "최근 정답(중복 금지)" 목록 상한.
// 너무 크면 입력 토큰이 그만큼 늘어 비용↑ → 반복 방지에 충분한 선에서 축소.
const MAX_PER_CATEGORY = 15;

function loadExclusions(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(EXCLUSION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch { return {}; }
}

function addExclusion(map: Record<string, string[]>, category: string, answer: string): Record<string, string[]> {
  const prev = map[category] ?? [];
  if (prev.includes(answer)) return map;
  const updated = { ...map, [category]: [...prev.slice(-(MAX_PER_CATEGORY - 1)), answer] };
  try { localStorage.setItem(EXCLUSION_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  return updated;
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

  const [game, setGame] = useState<GameState>(emptyGame);
  const [result, setResult] = useState<GameResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [judging, setJudging] = useState(false);
  const [tier, setTier] = useState<TextTier>('quiz_gen');
  const [statsOpen, setStatsOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [lastConfig, setLastConfig] = useState<StartConfig | null>(null);
  const [mode, setMode] = useState<'quiz' | 'soup'>('quiz');
  const exclusions = useRef<Record<string, string[]>>(loadExclusions());
  // 미리 만들어둔 문제(키: cfgKey) — 즉시 출제용
  const prefetchCache = useRef<Map<string, Puzzle>>(new Map());
  // 백그라운드 생성 진행 중인 프리페치 (중복 생성 방지 + 요청 시 await 대상)
  const prefetchInFlight = useRef<Map<string, Promise<Puzzle>>>(new Map());
  // 현재 판의 설정 (프리페치 트리거가 최신 설정을 참조하도록 ref로 보관)
  const lastCfgRef = useRef<StartConfig | null>(null);
  // 이번 판에서 프리페치를 이미 시작했는지 (유저가 "이어서 할 의사"를 보인 뒤 1회만)
  const prefetchArmed = useRef(false);
  const [log, setLog] = useState<string[]>(['> ✞퀴즈대합전✞ 준비완료. 카테고리를 골라줘… ♡']);
  const greeted = useRef(false);

  useEffect(() => {
    document.body.classList.toggle('is-minimized', minimized);
  }, [minimized]);

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
  // 프록시 호출 → 크레딧 차감 반영 → 파싱 → 정답을 카테고리 제외목록에 누적.
  async function generatePuzzle(cfg: StartConfig): Promise<Puzzle> {
    const { text, balance } = await proxyGenerateText(
      cfg.tier,
      [{ role: 'user', text: `카테고리: ${cfg.categoryLabel}\n주제: ${cfg.theme || '(자유)'}\n위 조건으로 문제를 출제해줘.` }],
      { system: buildSetupPrompt(cfg.categoryLabel, cfg.theme, cfg.difficulty, exclusions.current[cfg.categoryLabel] ?? []), temperature: 0.9 },
    );
    applyBalance(balance);
    const puzzle = parsePuzzle(text, cfg.categoryLabel, cfg.theme);
    exclusions.current = addExclusion(exclusions.current, cfg.categoryLabel, puzzle.answer);
    return puzzle;
  }

  // 준비된 문제로 즉시 플레이 화면 전환
  function startWithPuzzle(puzzle: Puzzle, cfg: StartConfig) {
    lastCfgRef.current = cfg;
    prefetchArmed.current = false; // 새 판 → 프리페치 트리거 재무장
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
  }

  // 유저가 "이어서 할 의사"를 보인 시점(첫 추가 힌트 공개 또는 첫 추측)에 1회만
  // 다음 문제를 미리 만든다. 한 문제만 보고 나가면 프리페치를 아예 안 해 크레딧 낭비를 막는다.
  function maybePrefetch() {
    if (prefetchArmed.current) return;
    prefetchArmed.current = true;
    if (lastCfgRef.current) prefetchNext(lastCfgRef.current);
  }

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
      startWithPuzzle(puzzle, cfg);
      // 다음 문제 프리페치는 maybePrefetch(첫 힌트 공개/첫 추측)에서 시작
    } catch (e) {
      push(`! 출제 실패: ${(e as Error).message}`);
      mascot.current?.say('으… 출제에 실패했어. 다시 해줄래?');
      setGame(emptyGame);
    } finally {
      window.clearInterval(loadingTick);
      setBusy(false);
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
        if (user) void saveResult(user.id, r);
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
        if (user) void saveResult(user.id, r);
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
    if (user) void saveResult(user.id, r);
  }

  function handleRestart() {
    setGame(emptyGame);
    setResult(null);
    push('> 새 문제를 준비할게. 카테고리를 골라줘! ♡');
  }

  function handleRestartSame() {
    if (!lastConfig || busy) return;
    // setup 화면으로 돌아가지 않고 GamePanel 안에서 바로 재출제
    setResult(null);
    void handleStart(lastConfig);
  }

  function handleMinimize() {
    setMinimized(true);
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

  const statusText =
    mode === 'soup' ? '🐢 바다거북 수프'
    : game.phase === 'setup' ? '준비됨 ♡'
    : game.phase === 'playing' ? `진행 중 · 힌트 ${game.revealedCount}/${game.puzzle?.maxHints}`
    : game.phase === 'won' ? '클리어! ♡'
    : '탈락…';

  return (
    <>
      {minimized ? (
        <div className="desktop-icons">
          <div className="desktop-icon" onClick={() => { setMode('quiz'); setMinimized(false); }}>
            <img className="desktop-icon-img" src="/icon_neko.png" alt="퀴즈대합전" draggable={false} />
            <span className="desktop-icon-label">✞퀴즈대합전✞</span>
          </div>
          <div className="desktop-icon" onClick={() => { setMode('soup'); setMinimized(false); }}>
            <img className="desktop-icon-img" src="/icon_kame.png" alt="바다거북수프" draggable={false} />
            <span className="desktop-icon-label">🐢 바다거북수프 <small style={{fontSize:'10px',opacity:.8}}>(beta)</small></span>
          </div>
        </div>
      ) : (
        <Window
          credits={profile?.credits ?? null}
          consoleLines={log}
          statusText={statusText}
          onTransform={() => mascot.current?.transform()}
          onLogout={() => void handleLogout()}
          onOpenStats={() => setStatsOpen(true)}
          onMinimize={handleMinimize}
          onClose={handleClose}
        >
          {mode === 'soup' ? (
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
                onStart={(cfg) => void handleStart(cfg)}
              />
            )
          ) : (
            <GamePanel
              state={game}
              judging={judging}
              result={result}
              generating={busy}
              onReveal={handleReveal}
              onGuess={(t) => void handleGuess(t)}
              onRestart={handleRestart}
              onRestartSame={lastConfig ? handleRestartSame : undefined}
              onEliminate={handleEliminate}
            />
          )}
        </Window>
      )}
      <Mascot ref={mascot} />
      {statsOpen && user && (
        <StatsModal userId={user.id} onClose={() => setStatsOpen(false)} />
      )}
    </>
  );
}
