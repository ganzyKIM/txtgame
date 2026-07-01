import { useEffect, useRef, useState } from 'react';
import type { GameState, GameResult, ExamMode } from '../game/types';
import { CENTER_QUESTIONS } from '../game/types';
import { computeScore, runGrade } from '../game/scoring';

interface Props {
  state: GameState;
  judging: boolean;
  appealing: boolean;
  result: GameResult | null;
  generating?: boolean;
  examMode: ExamMode;
  runScores: number[];
  onReveal: () => void;
  onGuess: (text: string) => void;
  onAppeal: (guessText: string) => void;
  onRestart: () => void;
  onRestartSame?: () => void;
  onEliminate: () => void;
  onNext: () => void;
  onReport: (reason: 'hallucination' | 'off_topic') => void;
}

export default function GamePanel({ state, judging, appealing, result, generating, examMode, runScores, onReveal, onGuess, onAppeal, onRestart, onRestartSame, onEliminate, onNext, onReport }: Props) {
  const [guess, setGuess] = useState('');
  const [reportStep, setReportStep] = useState<'idle' | 'selecting' | 'done'>('idle');
  const hintListRef = useRef<HTMLDivElement>(null);
  const puzzle = state.puzzle;

  useEffect(() => { setReportStep('idle'); }, [puzzle?.answer]);

  useEffect(() => {
    const el = hintListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.revealedCount]);
  if (!puzzle) return null;

  const revealed = puzzle.hints.slice(0, state.revealedCount);
  const remaining = puzzle.maxHints - state.revealedCount;
  const canReveal = state.phase === 'playing' && state.revealedCount < puzzle.maxHints && !judging;
  const live = computeScore(state.revealedCount, puzzle.maxHints, state.wrongGuesses);
  const finished = state.phase === 'won' || state.phase === 'lost';

  // 센터시험 진행 상태
  const isCenter = examMode === 'center';
  const done = runScores.length;                    // 완료한 문제 수
  const runTotal = runScores.reduce((a, b) => a + b, 0);
  const qNum = state.phase === 'playing' ? done + 1 : done; // 현재 문제 번호
  const isRunDone = isCenter && finished && done >= CENTER_QUESTIONS;

  function submit() {
    const g = guess.trim();
    if (!g || judging || state.phase !== 'playing') return;
    onGuess(g);
    setGuess('');
  }

  function handleReport(reason: 'hallucination' | 'off_topic') {
    setReportStep('done');
    onReport(reason);
  }

  const reportZone = (
    <div className="report-zone">
      {reportStep === 'done' ? (
        <span className="report-done">✓ 신고가 접수되었습니다</span>
      ) : reportStep === 'selecting' ? (
        <div className="report-options">
          <span className="report-ask">신고 사유를 선택해주세요:</span>
          <button className="btn btn-xs btn-report" onClick={() => handleReport('hallucination')}>환각 (존재하지 않는 정답)</button>
          <button className="btn btn-xs btn-report" onClick={() => handleReport('off_topic')}>주제 부적합</button>
          <button className="btn btn-xs" onClick={() => setReportStep('idle')}>취소</button>
        </div>
      ) : (
        <button className="btn-report-trigger" onClick={() => setReportStep('selecting')}>⚠ 문제 신고</button>
      )}
    </div>
  );

  return (
    <div className="body">
      <div className="game-grid">
        {/* 왼쪽: 힌트 */}
        <section className="panel game-left">
          <div className="panel-title">
            ◆ 힌트 <span className="mini" style={{ color: '#fff' }}>{puzzle.category}</span>
          </div>

          {isCenter && (
            <div className="center-progress">
              🎯 센터시험 <b>{Math.min(qNum, CENTER_QUESTIONS)}/{CENTER_QUESTIONS}</b> · 누적 <b>{runTotal}</b>점
            </div>
          )}

          <div className="gauge" title="공개한 힌트 / 탈락 임계값">
            <div
              className={`gauge-fill${judging ? ' is-judging' : ''}`}
              style={{ width: `${Math.min(100, (state.revealedCount / puzzle.maxHints) * 100)}%` }}
            />
            <div className="gauge-label">
              힌트 {state.revealedCount} / {puzzle.maxHints} · 현재 등급 {live.rank} ({live.score}점)
            </div>
          </div>

          <div className="hint-list" ref={hintListRef}>
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
              : <button className="btn btn-warn" onClick={onEliminate} disabled={judging}>
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
                  <span>{g.correct ? '⭕ ' : '❌ '}{g.text}{g.reason ? ` — ${g.reason}` : ''}</span>
                  {!g.correct && (
                    <button
                      className="btn btn-xs btn-appeal"
                      onClick={() => onAppeal(g.text)}
                      disabled={appealing || judging}
                      title="이 추측으로 이의제기"
                    >
                      {appealing ? '…' : '⚖ 이의제기'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {generating && (
            <div className="generating-wrap">
              <div className="generating-label">◆ 새 문제 출제 중 ◆</div>
              <div className="generating-bar-bg">
                <div className="generating-bar-fill" />
              </div>
              <div className="generating-sub">Please wait ♡</div>
            </div>
          )}

          {finished && result && !generating && (
            isCenter ? (
              isRunDone ? (
                /* ── 센터시험 런 종료 요약 ── */
                (() => {
                  const rg = runGrade(runTotal, CENTER_QUESTIONS);
                  return (
                    <div className="result-card">
                      <div className="result-rank">{rg.rank}</div>
                      <div className="result-answer">
                        센터시험 종료! 총점 <b>{runTotal}</b> <small>/ {CENTER_QUESTIONS * 1000}</small>
                      </div>
                      <div className="result-meta">평균 {rg.avg}점 · 종합 등급 {rg.rank}</div>
                      <div className="run-breakdown">
                        {runScores.map((s, i) => (
                          <span className="run-cell" key={i}>{i + 1}<b>{s}</b></span>
                        ))}
                      </div>
                      <div className="restart-btns">
                        {onRestartSame && (
                          <button className="btn btn-primary" onClick={onRestartSame}>↺ 다시 센터시험</button>
                        )}
                        <button className="btn" onClick={onRestart}>↩ 처음으로</button>
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* ── 센터시험 한 문제 결과 → 다음 문제 ── */
                <div className={`result-card ${result.won ? '' : 'lost'}`}>
                  <div className="result-rank">{result.won ? result.rank : '탈락'}</div>
                  <div className="result-answer">정답은 <b>{result.answer}</b> 이었어!</div>
                  <div className="result-meta">
                    {result.won ? `이 문제 ${result.score}점` : '이 문제 0점…'} · 누적 {runTotal}점
                  </div>
                  <div className="restart-btns">
                    <button className="btn btn-primary" onClick={onNext}>
                      다음 문제 → <small>({done}/{CENTER_QUESTIONS} 완료)</small>
                    </button>
                  </div>
                  {reportZone}
                </div>
              )
            ) : (
              /* ── 모의시험 (기존) ── */
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
                <div className="restart-btns">
                  {onRestartSame && (
                    <button className="btn btn-primary" onClick={onRestartSame}>↺ 한번 더!</button>
                  )}
                  <button className="btn" onClick={onRestart}>↩ 다른 주제</button>
                </div>
                {reportZone}
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
}
