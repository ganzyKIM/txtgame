import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useMultiplayerRoom } from '../hooks/useMultiplayerRoom';
import { CATEGORIES, DIFFICULTIES } from '../game/puzzle';
import type { StartConfig } from './StartScreen';
import type { Puzzle } from '../game/types';
import type { JoinedRoom } from './MultiplayerLobby';
import { MP_TOTAL_ROUNDS } from '../game/multiplayer';
import type { TextTier } from '../types';
import type { LineKind } from './Mascot';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc: any = null; // unused — leave/rpc handled via hook

const ROUND_TRANSITION_MS = 7000; // 다음 라운드 전환 대기 (카운트다운과 동일)

interface Props {
  room: JoinedRoom;
  myUserId: string;
  myNickname: string;
  tier: TextTier;
  generatePuzzle: (cfg: StartConfig) => Promise<Puzzle>;
  onLeave: () => void;
  onMascotEvent?: (kind: LineKind) => void;
}

export interface MultiplayerViewHandle {
  leaveRoom: () => Promise<void>;
}

const MultiplayerView = forwardRef<MultiplayerViewHandle, Props>(function MultiplayerView({ room, myUserId, myNickname: _nick, tier, generatePuzzle, onLeave, onMascotEvent }, ref) {
  void rpc; // suppress lint
  const { roomStatus, members, activeMembers, round, chat, finalScores, wrongGuesses, roomClosed, startGame, startRound, giveUp, submitGuess, sendChat, finishGame, leaveRoom } = useMultiplayerRoom(room.id, myUserId);

  useImperativeHandle(ref, () => ({ leaveRoom }), [leaveRoom]);

  const iAmHost = members.find(m => m.user_id === myUserId)?.is_host ?? false;
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hintCountdown, setHintCountdown] = useState(7);
  const [nextRoundCountdown, setNextRoundCountdown] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wrongGuessEndRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef(false);
  const prefetchRef = useRef<Puzzle | null>(null);
  const prefetchingRef = useRef(false);
  const prefetchPromiseRef = useRef<Promise<Puzzle | null> | null>(null);
  const allGaveUpFiredRef = useRef(false);

  const mpCfg: StartConfig = {
    categoryKey: room.category_key, categoryLabel: room.category_label,
    categoryPrompt: room.category_prompt, difficulty: room.difficulty,
    tier, theme: '', examMode: 'center',
  };

  // 다음 문제 백그라운드 생성 (호스트 전용)
  function prefetchNext(currentRound: number) {
    if (!iAmHost) return;
    if (currentRound >= MP_TOTAL_ROUNDS) return;
    if (prefetchingRef.current || prefetchRef.current) return;
    prefetchingRef.current = true;
    const p = generatePuzzle(mpCfg)
      .then((puzzle: Puzzle) => { prefetchRef.current = puzzle; return puzzle as Puzzle | null; })
      .catch(() => null as Puzzle | null)
      .finally(() => { prefetchingRef.current = false; prefetchPromiseRef.current = null; });
    prefetchPromiseRef.current = p;
  }

  // 호스트 이탈로 방이 폐쇄되면 자동으로 로비로 복귀
  useEffect(() => { if (roomClosed) onLeave(); }, [roomClosed, onLeave]);

  // ── 마스코트 이벤트 트리거 ────────────────────────────────────
  // 로비 입장 시 1회
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onMascotEvent?.('mp_lobby'); }, []);

  // 라운드 시작
  useEffect(() => {
    if (!round || round.ended) return;
    onMascotEvent?.(round.roundNum === 1 ? 'mp_start' : 'mp_round');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.roundNum]);

  // 라운드 종료 결과
  useEffect(() => {
    if (!round?.ended) return;
    if (round.winnerId === myUserId) onMascotEvent?.('mp_correct');
    else if (round.winnerId)         onMascotEvent?.('mp_rival_correct');
    else                             onMascotEvent?.('mp_timeout');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.ended, round?.roundNum]);

  // 마지막 힌트 공개
  useEffect(() => {
    if (round && !round.ended && round.revealedCount >= round.maxHints) {
      onMascotEvent?.('mp_lasthint');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.revealedCount]);

  // 문제 생성 중
  useEffect(() => {
    if (generating) onMascotEvent?.('mp_loading');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  // 전원 포기
  useEffect(() => {
    if (!round || round.ended) { allGaveUpFiredRef.current = false; return; }
    if (round.gaveUpIds.length > 0 && round.gaveUpIds.length >= activeMembers.length && !allGaveUpFiredRef.current) {
      allGaveUpFiredRef.current = true;
      onMascotEvent?.('mp_allgiveup');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.gaveUpIds.length, round?.ended]);

  // 최종 결과
  useEffect(() => {
    if (!finalScores) return;
    const sorted = [...finalScores].sort((a, b) => b.score - a.score);
    onMascotEvent?.(sorted[0]?.user_id === myUserId ? 'mp_win' : 'mp_rank');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalScores]);

  // auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);
  useEffect(() => { wrongGuessEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [wrongGuesses]);

  // 힌트 카운트다운 (힌트가 바뀔 때마다 7→0)
  useEffect(() => {
    if (!round || round.ended || round.revealedCount >= round.maxHints) {
      setHintCountdown(0);
      return;
    }
    setHintCountdown(7);
    const t = window.setInterval(() => {
      setHintCountdown(prev => {
        if (prev <= 1) { window.clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [round?.revealedCount, round?.ended]);

  // 라운드 종료 후 카운트다운 (7→0)
  useEffect(() => {
    if (!round?.ended) { setNextRoundCountdown(0); return; }
    setNextRoundCountdown(Math.ceil(ROUND_TRANSITION_MS / 1000));
    const t = window.setInterval(() => {
      setNextRoundCountdown(prev => {
        if (prev <= 1) { window.clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [round?.ended, round?.roundNum]);

  // host: auto-advance after round ends
  useEffect(() => {
    if (!round?.ended || !iAmHost) return;
    if (advancedRef.current) return;
    advancedRef.current = true;

    let cancelled = false;

    const advance = async () => {
      if (round.roundNum >= MP_TOTAL_ROUNDS) {
        await new Promise<void>(r => window.setTimeout(r, ROUND_TRANSITION_MS));
        if (!cancelled) await finishGame();
        return;
      }

      // 퍼즐 생성과 7초 타이머를 병렬 실행
      // ① prefetch 완료 → 즉시 사용
      // ② prefetch 진행 중 → 완료 대기 (이중 생성 방지, 로딩바 불필요)
      // ③ prefetch 없음 → 즉석 생성 + 로딩바
      let puzzlePromise: Promise<Puzzle>;
      if (prefetchRef.current) {
        puzzlePromise = Promise.resolve(prefetchRef.current);
      } else if (prefetchPromiseRef.current) {
        puzzlePromise = prefetchPromiseRef.current.then(p => {
          if (p) return p;
          setGenerating(true); setGenError(null);
          return generatePuzzle(mpCfg);
        });
      } else {
        setGenerating(true); setGenError(null);
        puzzlePromise = generatePuzzle(mpCfg);
      }

      // 반드시 7초를 채운 뒤에 다음 라운드로 넘어감
      const timerPromise = new Promise<void>(r => window.setTimeout(r, ROUND_TRANSITION_MS));

      try {
        const [puzzle] = await Promise.all([puzzlePromise, timerPromise]);
        if (cancelled) return;
        prefetchRef.current = null;
        setGenerating(false);
        await startRound(round.roundNum + 1, puzzle.hints, puzzle.maxHints, puzzle.answer, puzzle.acceptable);
        if (!cancelled) prefetchNext(round.roundNum + 1);
      } catch {
        if (!cancelled) { setGenError('문제 생성에 실패했어. 다시 시도할게…'); setGenerating(false); }
      }
    };

    void advance();
    return () => { cancelled = true; setGenerating(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.ended, round?.roundNum, iAmHost]);

  // reset advancedRef on new round
  useEffect(() => { advancedRef.current = false; }, [round?.roundNum]);

  // 라운드 시작 즉시 다음 문제 프리페치 (호스트만)
  useEffect(() => {
    if (!round || round.ended) return;
    prefetchNext(round.roundNum);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.roundNum]);

  async function handleStartGame() {
    setGenerating(true); setGenError(null);
    try {
      await startGame();
      // round 1 생성과 동시에 round 2 프리페치 시작
      const [puzzle] = await Promise.all([generatePuzzle(mpCfg), (prefetchNext(0), Promise.resolve())]);
      await startRound(1, puzzle.hints, puzzle.maxHints, puzzle.answer, puzzle.acceptable);
    } catch { setGenError('게임 시작 실패. 다시 시도해줘.'); }
    finally { setGenerating(false); }
  }

  // 채팅창 통합 입력: "!"로 시작하면 정답 제출, 그 외엔 일반 채팅
  async function handleChatOrGuess() {
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    setChatInput('');
    if (trimmed.startsWith('!') && round && !round.ended) {
      const g = trimmed.slice(1).trim();
      if (!g) return; // "!"만 친 경우 무시
      setSubmitError(null);
      const res = await submitGuess(g, round.revealedCount);
      if (!res.correct) setSubmitError('오답!');
      return;
    }
    setSubmitError(null);
    await sendChat(trimmed);
  }

  // 전체 오답 표시 (내 오답 포함)
  const allWrongGuesses = wrongGuesses;

  // ── 대기실 ─────────────────────────────────────────────────────
  if (roomStatus === 'waiting') {
    return (
      <div className="body">
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="panel-title">
            <span>◆ 대합전 대기실 — {CATEGORIES.find(c => c.key === room.category_key)?.emoji} {room.category_label} / {DIFFICULTIES.find(d => d.key === room.difficulty)?.label}</span>
            <button className="btn btn-xs btn-warn" onClick={async () => { await leaveRoom(); onLeave(); }}>나가기</button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>참가자 ({members.length}/{10})</div>
          <div className="sunken" style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {members.map(m => (
              <div key={m.user_id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                {m.is_host && <span style={{ fontSize: 10, color: 'var(--magenta)' }}>♛</span>}
                <span>{m.nickname}</span>
                {m.user_id === myUserId && <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>(나)</span>}
              </div>
            ))}
          </div>

          {genError && <div style={{ fontSize: 11, color: '#c03060' }}>{genError}</div>}

          {iAmHost && (
            <>
              {generating && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--magenta-d)', textAlign: 'center' }}>◆ 문제 출제 중… ♡</div>
                  <div className="generating-bar-bg" style={{ margin: '0 0 2px' }}>
                    <div className="generating-bar-fill" />
                  </div>
                </div>
              )}
              <button className="btn" disabled={members.length < 1 || generating} onClick={() => void handleStartGame()}>
                {generating ? '출제 중…' : '◆ 게임 시작'}
              </button>
            </>
          )}
          {!iAmHost && <div style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>호스트가 시작하기를 기다리는 중… ♡</div>}

          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="sunken" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleChatOrGuess(); }}
              placeholder="채팅…" style={{ flex: 1, fontSize: 12, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
            <button className="btn btn-xs" onClick={() => void handleChatOrGuess()}>전송</button>
          </div>
          <div className="sunken" style={{ maxHeight: 100, overflowY: 'auto', padding: 4, fontSize: 11 }}>
            {chat.map((c, i) => <div key={i}><b>{c.nickname}</b>: {c.message}</div>)}
            <div ref={chatEndRef} />
          </div>
        </div>
      </div>
    );
  }

  // ── 최종 결과 ────────────────────────────────────────────────
  if (roomStatus === 'finished' && finalScores) {
    const sorted = [...finalScores].sort((a, b) => b.score - a.score);
    return (
      <div className="body">
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <div className="panel-title" style={{ width: '100%', margin: '-8px -8px 8px' }}>◆ 대합전 결과</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--magenta)', marginBottom: 8 }}>✞ 게임 종료 ✞</div>
          {sorted.map((s, i) => (
            <div key={s.user_id} className="raised" style={{ width: '100%', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, width: 28 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{s.nickname}{s.user_id === myUserId ? ' (나)' : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--magenta-d)' }}>{s.rounds_won}문제 · {s.score}점</span>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 12 }} onClick={async () => { await leaveRoom(); onLeave(); }}>로비로 돌아가기</button>
        </div>
      </div>
    );
  }

  // ── 게임 중 ─────────────────────────────────────────────────
  const revealedHints = round ? round.hints.slice(0, round.revealedCount) : [];
  const myGaveUp = round?.gaveUpIds.includes(myUserId) ?? false;

  return (
    <div className="body" style={{ gap: 8 }}>
      {/* 좌: 힌트 패널 */}
      <div className="panel" style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div className="panel-title">
          <span>◆ {round ? `라운드 ${round.roundNum}/${MP_TOTAL_ROUNDS}` : '준비 중…'}</span>
          <span style={{ fontSize: 11 }}>{CATEGORIES.find(c => c.key === room.category_key)?.emoji} {room.category_label} · {DIFFICULTIES.find(d => d.key === room.difficulty)?.label}</span>
        </div>

        {/* 문제 출제 중 로딩바 — 라운드 종료 후엔 mp-round-result 내부 로딩바로 대체 */}
        {generating && !round?.ended && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0' }}>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--magenta-d)' }}>◆ 문제 출제 중… ♡</div>
            <div className="generating-bar-bg" style={{ margin: 0 }}>
              <div className="generating-bar-fill" />
            </div>
          </div>
        )}

        {round && !generating && !round.ended && (
          <>
            {/* 타이머 바 + 카운트다운 숫자 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="mp-timer-track" style={{ flex: 1 }}>
                  <div key={`timer-${round.revealedCount}`} className="mp-timer-bar" />
                </div>
                <span key={`cd-${round.revealedCount}-${hintCountdown}`} className="mp-countdown-num">
                  {hintCountdown}
                </span>
              </div>
              {round.revealedCount >= round.maxHints && (
                <div style={{ fontSize: 10, color: 'var(--ink-soft)', textAlign: 'right' }}>마지막 힌트</div>
              )}
            </div>
          </>
        )}

        {/* 힌트 목록 — 진행 중일 때만 표시 */}
        {round && !generating && !round.ended && (
          <div className="sunken" style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {revealedHints.map((h, i) => (
              <div key={i} className="hint-item">
                <span className="hint-num">{i + 1}</span>
                <span>{h}</span>
              </div>
            ))}
          </div>
        )}

        {/* 다른 플레이어 오답 기록 */}
        {round && !generating && !round.ended && allWrongGuesses.length > 0 && (
          <div className="sunken" style={{ padding: '3px 6px', maxHeight: 72, overflowY: 'auto' }}>
            {allWrongGuesses.slice(-8).map((wg, i) => (
              <div key={i} className="mp-wrong-entry">
                <span className="mp-wrong-x">✗</span>
                <b>{wg.nickname}</b>: {wg.guess}
              </div>
            ))}
            <div ref={wrongGuessEndRef} />
          </div>
        )}

        {/* 라운드 종료 결과 — generating 중에도 반드시 표시 */}
        {round?.ended && (
          <div className="mp-round-result">
            {round.winnerId
              ? <div className="mp-result-winner">✓ {round.winnerNickname}{round.winnerId === myUserId ? ' (나!)' : ''} 정답!</div>
              : <div className="mp-result-no-winner">이번 라운드는 아무도 못 맞혔어…</div>
            }
            <div className="mp-result-answer">정답: <b>{round.answer ?? '확인 중…'}</b></div>
            {generating
              ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--magenta-d)' }}>◆ 다음 문제 출제 중…</div>
                  <div className="generating-bar-bg" style={{ margin: '3px 0 0' }}>
                    <div className="generating-bar-fill" />
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
                  {nextRoundCountdown > 0
                    ? <>{round.roundNum >= MP_TOTAL_ROUNDS ? '결과 발표까지' : '다음 라운드까지'} <span key={`nr-${nextRoundCountdown}`} className="mp-countdown-num">{nextRoundCountdown}</span>초…</>
                    : (
                      <>
                        <div style={{ marginBottom: 3 }}>◆ 다음 문제 출제 중…</div>
                        <div className="generating-bar-bg" style={{ margin: 0 }}>
                          <div className="generating-bar-fill" />
                        </div>
                      </>
                    )
                  }
                </div>
              )
            }
          </div>
        )}

        {/* 포기 영역: 마지막 힌트 공개 후에만 표시 */}
        {round && !generating && !round.ended && round.revealedCount >= round.maxHints && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
              포기 ({round.gaveUpIds.length}/{activeMembers.length})
            </span>
            {!myGaveUp
              ? <button className="btn btn-xs btn-warn" onClick={giveUp}>포기</button>
              : <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>포기함… 결과 대기 중</span>
            }
          </div>
        )}
      </div>

      {/* 우: 점수 + 채팅(정답 겸용) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {/* 점수판 */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div className="panel-title">◆ 점수판</div>
          {[...members].sort((a, b) => b.score - a.score).map(m => (
            <div key={m.user_id} style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', opacity: m.left_at ? 0.5 : 1 }}>
              {m.is_host && <span style={{ color: 'var(--magenta)', fontSize: 10 }}>♛</span>}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: m.left_at ? 'line-through' : 'none' }}>
                {m.nickname}{m.user_id === myUserId ? '(나)' : ''}
              </span>
              {m.left_at && <span style={{ fontSize: 9, color: 'var(--ink-soft)' }}>나감</span>}
              <span style={{ color: 'var(--magenta-d)', whiteSpace: 'nowrap' }}>{m.rounds_won}문/{m.score}점</span>
            </div>
          ))}
        </div>

        {/* 채팅 */}
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
          <div className="panel-title">◆ 채팅</div>
          <div className="sunken" style={{ flex: 1, overflowY: 'auto', padding: 4, fontSize: 11 }}>
            {chat.map((c, i) => (
              <div key={i} style={{ color: c.user_id === myUserId ? 'var(--magenta-d)' : 'var(--ink)' }}>
                <b>{c.nickname}</b>: {c.message}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {submitError && <div style={{ fontSize: 10, color: '#c03060' }}>{submitError}</div>}
          {genError && <div style={{ fontSize: 10, color: '#c03060' }}>{genError}</div>}
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="sunken" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleChatOrGuess(); }}
              placeholder={round && !round.ended ? '정답은 !입력 후 작성' : '채팅…'}
              style={{ flex: 1, fontSize: 11, padding: '2px 5px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
            <button className="btn btn-xs" onClick={() => void handleChatOrGuess()}>↵</button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default MultiplayerView;
