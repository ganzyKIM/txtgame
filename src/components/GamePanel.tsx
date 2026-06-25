import { useState } from 'react';
import type { GameState, GameResult } from '../game/types';
import { computeScore } from '../game/scoring';

interface Props {
  state: GameState;
  judging: boolean;
  result: GameResult | null;
  onReveal: () => void;
  onGuess: (text: string) => void;
  onRestart: () => void;
  onEliminate: () => void;
}

export default function GamePanel({ state, judging, result, onReveal, onGuess, onRestart, onEliminate }: Props) {
  const [guess, setGuess] = useState('');
  const puzzle = state.puzzle;
  if (!puzzle) return null;

  const revealed = puzzle.hints.slice(0, state.revealedCount);
  const remaining = puzzle.maxHints - state.revealedCount;
  const canReveal = state.phase === 'playing' && state.revealedCount < puzzle.maxHints && !judging;
  const live = computeScore(state.revealedCount, puzzle.maxHints, state.wrongGuesses);
  const finished = state.phase === 'won' || state.phase === 'lost';

  function submit() {
    const g = guess.trim();
    if (!g || judging || state.phase !== 'playing') return;
    onGuess(g);
    setGuess('');
  }

  return (
    <div className="body">
      <div className="game-grid">
        {/* 왼쪽: 힌트 */}
        <section className="panel game-left">
          <div className="panel-title">
            ◆ 힌트 <span className="mini" style={{ color: '#fff' }}>{puzzle.category}</span>
          </div>

          <div className="gauge" title="공개한 힌트 / 탈락 임계값">
            <div
              className={`gauge-fill${judging ? ' is-judging' : ''}`}
              style={{ width: `${Math.min(100, (state.revealedCount / puzzle.maxHints) * 100)}%` }}
            />
            <div className="gauge-label">
              힌트 {state.revealedCount} / {puzzle.maxHints} · 현재 등급 {live.rank} ({live.score}점)
            </div>
          </div>

          <div className="hint-list">
            {revealed.length === 0 && <div className="hint-empty">아직 공개된 힌트가 없어…</div>}
            {revealed.map((h, i) => (
              <div className="hint-item" key={i}>
                <span className="hint-num">#{i + 1}</span>
                <span>{h}</span>
              </div>
            ))}
          </div>

          {!finished && (
            remaining > 0
              ? <button className="btn btn-lav" onClick={onReveal} disabled={!canReveal}>
                  🔓 힌트 열기 (남은 {remaining}개 — 열수록 점수 ↓)
                </button>
              : <button className="btn" style={{ background: 'linear-gradient(#ffd0e8,#ffb0d8)', borderColor: 'var(--bevel-lt) #c03070 #c03070 var(--bevel-lt)' }} onClick={onEliminate} disabled={judging}>
                  ⚠ 포기하고 정답 보기
                </button>
          )}
        </section>

        {/* 오른쪽: 추리 / 결과 */}
        <section className="panel game-right">
          <div className="panel-title">◆ 추리</div>

          {!finished && (
            <>
              <div className="guess-row">
                <input
                  className="text-input"
                  placeholder="정답을 입력해봐!"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  disabled={judging}
                />
                <button className="btn" onClick={submit} disabled={judging || !guess.trim()}>
                  {judging ? '판정…' : '제출'}
                </button>
              </div>
              <small className="note">정답을 맞히면 클리어! 임계값을 넘기면 탈락이야.</small>
            </>
          )}

          {state.guesses.length > 0 && (
            <div className="guess-log">
              {state.guesses.map((g, i) => (
                <div className={`guess-line ${g.correct ? '' : 'wrong'}`} key={i}>
                  {g.correct ? '⭕ ' : '❌ '}{g.text}{g.reason ? ` — ${g.reason}` : ''}
                </div>
              ))}
            </div>
          )}

          {finished && result && (
            <div className={`result-card ${result.won ? '' : 'lost'}`}>
              <div className="result-rank">{result.won ? result.rank : '탈락'}</div>
              <div className="result-answer">
                정답은 <b>{result.answer}</b> 이었어!
              </div>
              <div className="result-meta">
                {result.won
                  ? `힌트 ${result.hintsUsed}개 사용 · ${result.score}점`
                  : `힌트 ${result.hintsUsed}개를 다 썼지만 못 맞혔어…`}
              </div>
              <button className="btn btn-primary" onClick={onRestart}>↺ 다시 하기</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
