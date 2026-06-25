import { useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import LoginScreen from './auth/LoginScreen';
import Window from './components/Window';
import Mascot, { type MascotHandle } from './components/Mascot';
import StartScreen, { type StartConfig } from './components/StartScreen';
import GamePanel from './components/GamePanel';
import { proxyGenerateText } from './api/proxy';
import { buildSetupPrompt, parsePuzzle } from './game/puzzle';
import { judgeGuess } from './game/judge';
import { computeScore } from './game/scoring';
import { saveResult } from './save/cloudSave';
import StatsModal from './components/StatsModal';
import type { GameResult, GameState } from './game/types';
import type { TextTier } from './types';

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
  const [tier, setTier] = useState<TextTier>('standard');
  const [statsOpen, setStatsOpen] = useState(false);
  const [log, setLog] = useState<string[]>(['> ✞퀴즈대합전✞ 준비완료. 카테고리를 골라줘… ♡']);

  function push(line: string) {
    setLog((l) => [...l, line].slice(-50));
  }

  // ── 게임 시작: 출제 ───────────────────────────────────────────────
  async function handleStart(cfg: StartConfig) {
    setBusy(true);
    setResult(null);
    setTier(cfg.tier);
    push(`> 출제 중… [${cfg.categoryLabel}${cfg.theme ? ' · ' + cfg.theme : ''}]`);
    mascot.current?.event('loading');
    const loadingTick = window.setInterval(() => mascot.current?.event('loading'), 4000);
    try {
      const { text, balance } = await proxyGenerateText(
        cfg.tier,
        [{ role: 'user', text: `카테고리: ${cfg.categoryLabel}\n주제: ${cfg.theme || '(자유)'}\n위 조건으로 문제를 출제해줘.` }],
        { system: buildSetupPrompt(cfg.categoryLabel, cfg.theme, cfg.difficulty), temperature: 0.9 },
      );
      applyBalance(balance);
      const puzzle = parsePuzzle(text, cfg.categoryLabel, cfg.theme);
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

  async function handleLogout() {
    await signOut();
  }

  if (authLoading) {
    return <div className="login-wrap"><div className="login-card"><div className="login-body">불러오는 중… ♡</div></div></div>;
  }
  if (!user) return <LoginScreen />;

  const statusText =
    game.phase === 'setup' ? '준비됨 ♡'
    : game.phase === 'playing' ? `진행 중 · 힌트 ${game.revealedCount}/${game.puzzle?.maxHints}`
    : game.phase === 'won' ? '클리어! ♡'
    : '탈락…';

  return (
    <>
      <Window
        credits={profile?.credits ?? null}
        consoleLines={log}
        statusText={statusText}
        onTransform={() => mascot.current?.transform()}
        onLogout={() => void handleLogout()}
        onOpenStats={() => setStatsOpen(true)}
      >
        {game.phase === 'setup' ? (
          <StartScreen busy={busy} onStart={(cfg) => void handleStart(cfg)} />
        ) : (
          <GamePanel
            state={game}
            judging={judging}
            result={result}
            onReveal={handleReveal}
            onGuess={(t) => void handleGuess(t)}
            onRestart={handleRestart}
            onEliminate={handleEliminate}
          />
        )}
      </Window>
      <Mascot ref={mascot} />
      {statsOpen && user && (
        <StatsModal userId={user.id} onClose={() => setStatsOpen(false)} />
      )}
    </>
  );
}
