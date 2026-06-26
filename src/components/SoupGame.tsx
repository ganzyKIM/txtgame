import { useRef, useState, type RefObject } from 'react';
import { proxyGenerateText } from '../api/proxy';
import {
  buildSoupSetupPrompt, parseSoupPuzzle,
  buildSoupAnswerPrompt, parseSoupAnswer,
  buildSoupGuessPrompt, parseSoupGuess,
  buildSoupHintPrompt, parseSoupHint,
  type SoupPuzzle, type SoupTurn,
} from '../game/soup';
import { saveSoupResult } from '../save/cloudSave';
import type { MascotHandle } from './Mascot';
import type { TextTier } from '../types';

const MAX_HINTS = 3;

type Phase = 'intro' | 'loading' | 'playing' | 'solved' | 'revealed';

interface Props {
  tier: TextTier;
  userId?: string;
  mascot: RefObject<MascotHandle | null>;
  push: (line: string) => void;
  applyBalance: (n: number) => void;
  onExit: () => void;
}

export default function SoupGame({ tier, userId, mascot, push, applyBalance, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [puzzle, setPuzzle] = useState<SoupPuzzle | null>(null);
  const [turns, setTurns] = useState<SoupTurn[]>([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const recentTitles = useRef<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  function scrollLog() {
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // ── 수프 끓이기: 새 시나리오 출제 ───────────────────────────────
  async function brew() {
    setPhase('loading');
    setTurns([]);
    setHintsUsed(0);
    setPuzzle(null);
    push('> 🐢 바다거북 수프를 끓이는 중…');
    mascot.current?.event('loading');
    const tick = window.setInterval(() => mascot.current?.event('loading'), 4000);
    try {
      const { text, balance } = await proxyGenerateText(
        tier,
        [{ role: 'user', text: '바다거북 수프 문제를 하나 출제해줘.' }],
        { system: buildSoupSetupPrompt(recentTitles.current), temperature: 1.0 },
      );
      applyBalance(balance);
      const p = parseSoupPuzzle(text);
      recentTitles.current = [...recentTitles.current.slice(-19), p.title];
      setPuzzle(p);
      setPhase('playing');
      push(`> 🐢 수프 완성! 「${p.title}」 — 예/아니오로 질문해봐!`);
      mascot.current?.event('soup_intro');
    } catch (e) {
      push(`! 수프 출제 실패: ${(e as Error).message}`);
      mascot.current?.say('으… 수프가 타버렸어. 다시 해줄래?');
      setPhase('intro');
    } finally {
      window.clearInterval(tick);
    }
  }

  // ── 예/아니오 질문 ─────────────────────────────────────────────
  async function ask() {
    const q = input.trim();
    if (!q || busy || !puzzle || phase !== 'playing') return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: q }]);
    scrollLog();
    setBusy(true);
    mascot.current?.event('judging');
    try {
      const { text, balance } = await proxyGenerateText(
        tier,
        [{ role: 'user', text: buildSoupAnswerPrompt(puzzle, q) }],
        { temperature: 0 },
      );
      applyBalance(balance);
      const { verdict, comment } = parseSoupAnswer(text);
      setTurns((t) => [...t, { role: 'gm', text: comment, verdict }]);
      scrollLog();
      if (verdict === '정답') {
        setPhase('solved');
        push('> ⭕ 진상을 꿰뚫었어! 클리어!');
        mascot.current?.event('soup_solve');
        if (userId && puzzle) void saveSoupResult(userId, {
          title: puzzle.title, solved: true, hintsUsed,
          questionsAsked: turns.filter((t) => t.role === 'user').length + 1,
        });
      } else if (verdict === '예') {
        mascot.current?.event('soup_yes');
      } else if (verdict === '아니오') {
        mascot.current?.event('soup_no');
      } else {
        mascot.current?.event('soup_irrelevant');
      }
    } catch (e) {
      setTurns((t) => [...t, { role: 'gm', text: `(판정 실패: ${(e as Error).message})`, verdict: '상관없음' }]);
      scrollLog();
    } finally {
      setBusy(false);
    }
  }

  // ── 힌트 요청 ─────────────────────────────────────────────────
  async function getHint() {
    if (busy || !puzzle || phase !== 'playing' || hintsUsed >= MAX_HINTS) return;
    const nextHintNum = hintsUsed + 1;
    setHintsUsed(nextHintNum);
    setBusy(true);
    mascot.current?.event('soup_hint');
    try {
      const { text, balance } = await proxyGenerateText(
        tier,
        [{ role: 'user', text: buildSoupHintPrompt(puzzle, nextHintNum, turns) }],
        { temperature: 0.4 },
      );
      applyBalance(balance);
      const hint = parseSoupHint(text);
      setTurns((t) => [...t, { role: 'gm', text: hint, isHint: true }]);
      scrollLog();
      push(`> 💡 힌트 ${nextHintNum}/${MAX_HINTS} 공개`);
    } catch (e) {
      setTurns((t) => [...t, { role: 'gm', text: `(힌트 생성 실패: ${(e as Error).message})`, isHint: true }]);
      scrollLog();
    } finally {
      setBusy(false);
    }
  }

  // ── 최종 정답 외치기 ───────────────────────────────────────────
  async function shout() {
    const g = input.trim();
    if (!g || busy || !puzzle || phase !== 'playing') return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: `💡 [정답] ${g}` }]);
    scrollLog();
    setBusy(true);
    mascot.current?.event('judging');
    try {
      const { text, balance } = await proxyGenerateText(
        tier,
        [{ role: 'user', text: buildSoupGuessPrompt(puzzle, g) }],
        { temperature: 0 },
      );
      applyBalance(balance);
      const { correct, comment } = parseSoupGuess(text);
      setTurns((t) => [...t, { role: 'gm', text: comment, verdict: correct ? '정답' : '아니오' }]);
      scrollLog();
      if (correct) {
        setPhase('solved');
        push('> ⭕ 정답! 진상을 완벽하게 추리했어!');
        mascot.current?.event('soup_solve');
        if (userId && puzzle) void saveSoupResult(userId, {
          title: puzzle.title, solved: true, hintsUsed,
          questionsAsked: turns.filter((t) => t.role === 'user').length + 1,
        });
      } else {
        push('> ❌ 아직 핵심이 비껴갔어. 더 질문해봐!');
        mascot.current?.event('soup_no');
      }
    } catch (e) {
      setTurns((t) => [...t, { role: 'gm', text: `(판정 실패: ${(e as Error).message})`, verdict: '아니오' }]);
      scrollLog();
    } finally {
      setBusy(false);
    }
  }

  function reveal() {
    if (!puzzle) return;
    setPhase('revealed');
    push('> 🏳️ 진상을 공개했어.');
    mascot.current?.event('soup_reveal');
    if (userId) void saveSoupResult(userId, {
      title: puzzle.title, solved: false, hintsUsed,
      questionsAsked: turns.filter((t) => t.role === 'user').length,
    });
  }

  // ── 인트로(설명) 화면 ──────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="body">
        <div className="soup-intro">
          <div className="soup-intro-card">
            <h2 className="soup-title">🐢 바다거북 수프 게임</h2>
            <p className="soup-lead">
              겉보기엔 <b>이상하고 모순돼 보이는 상황</b>이 주어져.
              너는 <b>예 / 아니오</b>로 답할 수 있는 질문을 던지며 그 뒤에 숨은 <b>진상</b>을 추리하는 거야!
            </p>
            <ul className="soup-rules">
              <li>천사쨩이 수수께끼 상황을 하나 보여줘.</li>
              <li>너는 자유롭게 질문 → 천사쨩이 <b>「예」「아니오」「상관없음」</b>으로 답해.</li>
              <li>막히면 <b>💡 힌트</b>를 최대 3번까지 요청할 수 있어!</li>
              <li>충분히 감이 오면 <b>💡 정답 외치기</b>로 진상을 말해봐.</li>
              <li>핵심을 제대로 짚으면 <b>클리어!</b> ♡</li>
            </ul>
            <div className="soup-eg">
              <b>예시</b> — "한 남자가 식당에서 바다거북 수프를 한 입 먹고는, 집에 돌아가 스스로 목숨을 끊었다. 왜?"
              <br />…이런 식의, 질문으로 파헤치는 추리 게임이야!
            </div>
            <div className="soup-intro-btns">
              <button className="btn btn-primary" onClick={() => void brew()}>🍲 수프 끓이기 시작!</button>
              <button className="btn" onClick={onExit}>↩ 카테고리로</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 로딩 화면 ──────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="body">
        <div className="generating-full">
          <div className="generating-wrap">
            <div className="generating-label">◆ 수프 끓이는 중 ◆</div>
            <div className="generating-bar-bg"><div className="generating-bar-fill" /></div>
            <div className="generating-sub">Please wait ♡</div>
          </div>
        </div>
      </div>
    );
  }

  // ── 게임 진행 / 결과 화면 ──────────────────────────────────────
  const finished = phase === 'solved' || phase === 'revealed';
  const hintsLeft = MAX_HINTS - hintsUsed;

  return (
    <div className="body">
      <section className="panel soup-panel">
        <div className="panel-title">
          🐢 바다거북 수프 — 「{puzzle?.title}」
          {!finished && <span className="soup-hint-counter">💡힌트 {hintsLeft}회 남음</span>}
        </div>

        <div className="soup-scenario">{puzzle?.scenario}</div>

        <div className="soup-log" ref={logRef}>
          {turns.length === 0 && (
            <div className="soup-empty">예/아니오로 답할 수 있는 질문을 던져봐! 예) "그는 전에 바다거북 수프를 먹은 적 있어?"</div>
          )}
          {turns.map((t, i) =>
            t.isHint ? (
              <div className="soup-hint-turn" key={i}>
                <span className="soup-hint-badge">💡 힌트</span>
                <span className="soup-hint-text">{t.text}</span>
              </div>
            ) : t.role === 'user' ? (
              <div className="soup-q" key={i}>
                <span className="soup-q-mark">Q.</span><span>{t.text}</span>
              </div>
            ) : (
              <div className={`soup-a v-${t.verdict ?? '상관없음'}`} key={i}>
                <span className="soup-verdict">{t.verdict}</span>
                {t.text && <span className="soup-a-text">{t.text}</span>}
              </div>
            )
          )}
        </div>

        {finished && (
          <div className={`soup-result ${phase === 'solved' ? '' : 'revealed'}`}>
            <div className="soup-result-head">{phase === 'solved' ? '⭕ 클리어!' : '🏳️ 진상 공개'}</div>
            <div className="soup-solution">{puzzle?.solution}</div>
            <div className="restart-btns">
              <button className="btn btn-primary" onClick={() => void brew()}>🍲 새 수프</button>
              <button className="btn" onClick={onExit}>↩ 카테고리로</button>
            </div>
          </div>
        )}

        {busy && <div className="soup-busy-bar" />}

        {!finished && (
          <>
            <div className="soup-input-row">
              <input
                className="text-input"
                placeholder={busy ? '천사쨩이 생각 중…' : '질문을 입력해봐!'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
                disabled={busy}
              />
              <button className="btn" onClick={() => void ask()} disabled={busy || !input.trim()}>
                {busy ? '…' : '❓ 질문'}
              </button>
            </div>
            <div className="soup-action-row">
              <button className="btn btn-lav" onClick={() => void shout()} disabled={busy || !input.trim()}>
                💡 정답 외치기
              </button>
              <button
                className="btn soup-hint-btn"
                onClick={() => void getHint()}
                disabled={busy || hintsLeft === 0}
                title={hintsLeft === 0 ? '힌트를 모두 사용했어!' : `힌트 요청 (${hintsLeft}회 남음)`}
              >
                🔍 힌트{hintsLeft > 0 ? ` (${hintsLeft})` : ' 없음'}
              </button>
              <button className="btn" onClick={reveal} disabled={busy}>🏳️ 포기</button>
            </div>
            <small className="note">입력창에 추리를 적고 <b>💡 정답 외치기</b>를 누르면 최종 판정을 해줘!</small>
          </>
        )}
      </section>
    </div>
  );
}
