import { useState, useEffect, useRef } from 'react';
import { useMultiplayerRoom } from '../hooks/useMultiplayerRoom';
import { CATEGORIES, DIFFICULTIES } from '../game/puzzle';
import type { StartConfig } from './StartScreen';
import type { Puzzle } from '../game/types';
import type { JoinedRoom } from './MultiplayerLobby';
import { MP_TOTAL_ROUNDS } from '../game/multiplayer';
import type { TextTier } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc: any = null; // unused — leave/rpc handled via hook

interface Props {
  room: JoinedRoom;
  myUserId: string;
  myNickname: string;
  tier: TextTier;
  generatePuzzle: (cfg: StartConfig) => Promise<Puzzle>;
  onLeave: () => void;
}

export default function MultiplayerView({ room, myUserId, myNickname: _nick, tier, generatePuzzle, onLeave }: Props) {
  void rpc; // suppress lint
  const { roomStatus, members, round, chat, finalScores, startGame, startRound, giveUp, submitGuess, sendChat, finishGame } = useMultiplayerRoom(room.id, myUserId);

  const iAmHost = members.find(m => m.user_id === myUserId)?.is_host ?? false;
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef(false);
  const prefetchRef = useRef<Puzzle | null>(null);   // 미리 만들어둔 다음 문제
  const prefetchingRef = useRef(false);

  const mpCfg: StartConfig = {
    categoryKey: room.category_key, categoryLabel: room.category_label,
    categoryPrompt: room.category_prompt, difficulty: room.difficulty,
    tier, theme: '', examMode: 'center',
  };

  // 다음 문제 백그라운드 생성 (호스트 전용)
  function prefetchNext(currentRound: number) {
    if (!iAmHost) return;
    if (currentRound >= MP_TOTAL_ROUNDS) return; // 마지막 라운드엔 불필요
    if (prefetchingRef.current || prefetchRef.current) return;
    prefetchingRef.current = true;
    void generatePuzzle(mpCfg).then(p => {
      prefetchRef.current = p;
    }).catch(() => {
      // 실패해도 무방 — 라운드 종료 시 재시도
    }).finally(() => {
      prefetchingRef.current = false;
    });
  }

  // auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  // host: auto-advance after round ends
  useEffect(() => {
    if (!round?.ended || !iAmHost) return;
    if (advancedRef.current) return;
    advancedRef.current = true;

    const t = window.setTimeout(async () => {
      if (round.roundNum >= MP_TOTAL_ROUNDS) {
        await finishGame();
      } else {
        setGenerating(true); setGenError(null);
        try {
          // 프리페치가 준비됐으면 즉시 사용, 아니면 지금 생성
          const puzzle = prefetchRef.current ?? await generatePuzzle(mpCfg);
          prefetchRef.current = null;
          await startRound(round.roundNum + 1, puzzle.hints, puzzle.maxHints, puzzle.answer, puzzle.acceptable);
          prefetchNext(round.roundNum + 1); // 바로 다음다음 문제 예열
        } catch { setGenError('문제 생성에 실패했어. 다시 시도할게…'); }
        finally { setGenerating(false); }
      }
    }, 3500);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.ended, round?.roundNum, iAmHost]);

  // reset advancedRef on new round
  useEffect(() => { advancedRef.current = false; }, [round?.roundNum]);

  async function handleStartGame() {
    setGenerating(true); setGenError(null);
    try {
      await startGame();
      const puzzle = await generatePuzzle(mpCfg);
      await startRound(1, puzzle.hints, puzzle.maxHints, puzzle.answer, puzzle.acceptable);
      prefetchNext(1); // 라운드 1 시작 → 라운드 2 즉시 예열
    } catch { setGenError('게임 시작 실패. 다시 시도해줘.'); }
    finally { setGenerating(false); }
  }

  async function handleGuess() {
    const g = guess.trim();
    if (!g || !round || round.ended) return;
    setGuess(''); setSubmitError(null);
    const res = await submitGuess(g, round.revealedCount);
    if (!res.correct) setSubmitError('오답!');
  }

  async function handleChat() {
    const m = chatInput.trim();
    if (!m) return;
    setChatInput('');
    await sendChat(m);
  }

  // ── 대기실 ─────────────────────────────────────────────────────
  if (roomStatus === 'waiting') {
    return (
      <div className="body">
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="panel-title">
            <span>◆ 대합전 대기실 — {CATEGORIES.find(c => c.key === room.category_key)?.emoji} {room.category_label} / {DIFFICULTIES.find(d => d.key === room.difficulty)?.label}</span>
            <button className="btn btn-xs btn-warn" onClick={onLeave}>나가기</button>
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
            <button className="btn" disabled={members.length < 1 || generating} onClick={() => void handleStartGame()}>
              {generating ? '◆ 문제 출제 중…' : '◆ 게임 시작'}
            </button>
          )}
          {!iAmHost && <div style={{ fontSize: 11, color: 'var(--ink-soft)', textAlign: 'center' }}>호스트가 시작하기를 기다리는 중… ♡</div>}

          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="sunken" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleChat(); }}
              placeholder="채팅…" style={{ flex: 1, fontSize: 12, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
            <button className="btn btn-xs" onClick={() => void handleChat()}>전송</button>
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
          <button className="btn" style={{ marginTop: 12 }} onClick={onLeave}>로비로 돌아가기</button>
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
          <span style={{ fontSize: 11 }}>{CATEGORIES.find(c => c.key === room.category_key)?.emoji} {room.category_label}</span>
        </div>

        {generating && (
          <div style={{ textAlign: 'center', padding: 20, fontSize: 12, color: 'var(--ink-soft)' }}>◆ 문제 출제 중… ♡</div>
        )}

        {round && !generating && (
          <>
            {/* 타이머 바 */}
            {!round.ended && (
              <div className="mp-timer-track">
                <div key={`timer-${round.revealedCount}`} className="mp-timer-bar" />
              </div>
            )}

            {/* 힌트 목록 */}
            <div className="sunken" style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {revealedHints.map((h, i) => (
                <div key={i} className="hint-item">
                  <span className="hint-num">{i + 1}</span>
                  <span>{h}</span>
                </div>
              ))}
              {!round.ended && round.revealedCount < round.maxHints && (
                <div style={{ fontSize: 10, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 4 }}>
                  다음 힌트까지 7초…
                </div>
              )}
            </div>

            {/* 라운드 종료 오버레이 */}
            {round.ended && (
              <div className="mp-round-result">
                {round.winnerId
                  ? <><div className="mp-result-winner">✓ {round.winnerNickname}{round.winnerId === myUserId ? ' (나!)' : ''} 정답!</div></>
                  : <div className="mp-result-no-winner">이번 라운드는 아무도 못 맞혔어…</div>
                }
                <div className="mp-result-answer">정답: <b>{round.answer}</b></div>
                {generating ? <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>다음 문제 출제 중…</div>
                  : <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>잠시 후 다음 라운드…</div>}
              </div>
            )}

            {/* 포기 버튼 */}
            {!round.ended && !myGaveUp && (
              <button className="btn btn-xs btn-warn" style={{ alignSelf: 'flex-end' }} onClick={giveUp}>포기</button>
            )}
            {!round.ended && myGaveUp && (
              <div style={{ fontSize: 10, color: 'var(--ink-soft)', textAlign: 'right' }}>포기함… 다음 힌트 대기 중</div>
            )}
          </>
        )}
      </div>

      {/* 우: 입력 + 점수 + 채팅 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {/* 정답 입력 */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="panel-title">◆ 정답 입력</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="sunken" value={guess}
              onChange={e => { setGuess(e.target.value); setSubmitError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') void handleGuess(); }}
              disabled={!round || round.ended}
              placeholder={round?.ended ? '라운드 종료' : '정답을 입력해봐…'}
              style={{ flex: 1, fontSize: 12, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }}
            />
            <button className="btn btn-xs" disabled={!round || round.ended || !guess.trim()} onClick={() => void handleGuess()}>입력</button>
          </div>
          {submitError && <div style={{ fontSize: 10, color: '#c03060' }}>{submitError}</div>}
          {genError && <div style={{ fontSize: 10, color: '#c03060' }}>{genError}</div>}
        </div>

        {/* 점수판 */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div className="panel-title">◆ 점수판</div>
          {[...members].sort((a, b) => b.score - a.score).map(m => (
            <div key={m.user_id} style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
              {m.is_host && <span style={{ color: 'var(--magenta)', fontSize: 10 }}>♛</span>}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.nickname}{m.user_id === myUserId ? '(나)' : ''}
              </span>
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
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="sunken" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleChat(); }}
              placeholder="채팅…" style={{ flex: 1, fontSize: 11, padding: '2px 5px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
            <button className="btn btn-xs" onClick={() => void handleChat()}>↵</button>
          </div>
        </div>
      </div>
    </div>
  );
}
