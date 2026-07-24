import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  validateWord, pickAiWord, allowedStarts, lastChar,
  type AiLevel, type RejectReason,
} from '../game/wordchain';
import { defaultDict } from '../game/wordchain-dict';
import type { MascotHandle } from './Mascot';

type Phase = 'intro' | 'playing' | 'won' | 'lost';
type By = 'player' | 'ai';
interface ChainItem { word: string; by: By; }

interface Props {
  mascot: RefObject<MascotHandle | null>;
  push: (line: string) => void;
  onExit: () => void;
}

const TURN_SECONDS = 15;

const LEVELS: { key: AiLevel; label: string; note: string }[] = [
  { key: 'easy',   label: '쉬움',   note: '초텐쨩이 받기 쉬운 단어를 내줘' },
  { key: 'normal', label: '보통',   note: '초텐쨩이 적당히 골라' },
  { key: 'hard',   label: '어려움', note: '초텐쨩이 한방단어로 괴롭혀!' },
];

const REJECT_MSG: Record<RejectReason, string> = {
  'too-short':   '두 글자 이상 한글 단어로 입력해줘!',
  'chain':       '앞 글자가 안 이어져!',
  'used':        '이미 쓴 단어야!',
  'not-in-dict': '사전에 없는 단어야…',
};

export default function WordChainGame({ mascot, push, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [level, setLevel] = useState<AiLevel>('normal');
  const [chain, setChain] = useState<ChainItem[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [aiThinking, setAiThinking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TURN_SECONDS);

  const usedRef = useRef<Set<string>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lastWord = chain.length > 0 ? chain[chain.length - 1].word : null;
  const myTurn = phase === 'playing' && !aiThinking && chain.length > 0 && chain[chain.length - 1].by === 'ai';
  const need = lastWord ? allowedStarts(lastChar(lastWord)) : [];

  function scrollLog() {
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function clearTimer() {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }

  // ── 플레이어 턴 타이머 ───────────────────────────────────────────
  useEffect(() => {
    clearTimer();
    if (!myTurn) return;
    setSecondsLeft(TURN_SECONDS);
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearTimer(); onTimeout(); return 0; }
        return s - 1;
      });
    }, 1000);
    inputRef.current?.focus();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, chain.length]);

  useEffect(() => clearTimer, []);

  function onTimeout() {
    setPhase('lost');
    push('> ⏰ 시간 초과! 초텐쨩 승리…');
    mascot.current?.event('win');
  }

  // ── 게임 시작 ────────────────────────────────────────────────────
  function start() {
    usedRef.current = new Set();
    // 초텐쨩이 첫 단어 제시 — 받기 어렵지 않게, 끝글자로 이어갈 단어가
    // 많은 음절로 시작하는 단어를 랜덤으로 고른다.
    const firstWord = randomFirstWord();
    usedRef.current.add(firstWord);
    setChain([{ word: firstWord, by: 'ai' }]);
    setError('');
    setPhase('playing');
    push(`> 🔤 끝말잇기 시작! 초텐쨩: "${firstWord}"`);
    mascot.current?.event('intro');
    scrollLog();
  }

  function randomFirstWord(): string {
    const all: string[] = [];
    for (const ch of '가나다마바사아자차카타파하라') all.push(...defaultDict.byFirst(ch));
    return all[Math.floor(Math.random() * all.length)] ?? '시작';
  }

  // ── 플레이어 제출 ────────────────────────────────────────────────
  function submit() {
    if (!myTurn) return;
    const w = input.trim();
    const res = validateWord(w, lastWord, usedRef.current, defaultDict);
    if (!res.ok) {
      const msg = REJECT_MSG[res.reason!]
        + (res.reason === 'chain' && res.expected ? ` (${res.expected.join('/')} 로 시작!)` : '');
      setError(msg);
      mascot.current?.event('wrong');
      return;
    }
    setError('');
    setInput('');
    clearTimer();
    usedRef.current.add(w);
    const next: ChainItem[] = [...chain, { word: w, by: 'player' }];
    setChain(next);
    scrollLog();
    mascot.current?.event('correct');
    // 초텐쨩 차례
    aiTurn(w);
  }

  // ── 초텐쨩 턴 ────────────────────────────────────────────────────
  function aiTurn(playerWord: string) {
    setAiThinking(true);
    window.setTimeout(() => {
      const aiWord = pickAiWord(playerWord, usedRef.current, defaultDict, level);
      if (!aiWord) {
        setAiThinking(false);
        setPhase('won');
        push('> 🏆 초텐쨩이 단어를 못 찾았어! 너의 승리!');
        mascot.current?.event('eliminated'); // 초텐쨩이 짐 → 분한 표정
        return;
      }
      usedRef.current.add(aiWord);
      setChain((c) => [...c, { word: aiWord, by: 'ai' }]);
      setAiThinking(false);
      scrollLog();
    }, 700 + Math.random() * 600);
  }

  function giveUp() {
    clearTimer();
    setPhase('lost');
    push('> 🏳️ 포기했어. 초텐쨩 승리!');
    mascot.current?.event('win');
  }

  // ── 인트로 ───────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="body">
        <div className="soup-intro">
          <div className="soup-intro-card">
            <h2 className="soup-title">🔤 초텐쨩 끝말잇기</h2>
            <p className="soup-lead">
              초텐쨩과 <b>번갈아 단어를 이어</b>가는 대결이야!
              앞 단어의 <b>마지막 글자</b>로 시작하는 단어를 제한 시간 안에 외쳐줘.
            </p>
            <ul className="soup-rules">
              <li>초텐쨩이 먼저 단어를 하나 던져.</li>
              <li>너는 <b>{TURN_SECONDS}초</b> 안에 끝말을 이어야 해!</li>
              <li>두음법칙 인정 — 예) "사랑" → "낙엽" 또는 "악수" 둘 다 OK.</li>
              <li>이미 나온 단어·사전에 없는 단어는 안 돼.</li>
              <li>초텐쨩이 더 못 이으면 <b>너의 승리!</b> ♡</li>
            </ul>
            <div className="ctl-group" style={{ marginTop: 4 }}>
              <label className="ctl-label">◆ 난이도</label>
              <div className="seg">
                {LEVELS.map((l) => (
                  <button
                    key={l.key}
                    className={`seg-btn ${level === l.key ? 'active' : ''}`}
                    onClick={() => setLevel(l.key)}
                  >{l.label}</button>
                ))}
              </div>
              <small className="note">{LEVELS.find((l) => l.key === level)?.note}</small>
            </div>
            <div className="soup-intro-btns">
              <button className="btn btn-primary" onClick={start}>🔤 시작!</button>
              <button className="btn" onClick={onExit}>↩ 나가기</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const finished = phase === 'won' || phase === 'lost';

  return (
    <div className="body">
      <section className="panel soup-panel">
        <div className="panel-title">
          🔤 초텐쨩 끝말잇기
          {myTurn && <span className="soup-hint-counter">⏱ {secondsLeft}초</span>}
        </div>

        {myTurn && (
          <div className="wc-timerbar">
            <div className="wc-timerbar-fill" style={{ width: `${(secondsLeft / TURN_SECONDS) * 100}%` }} />
          </div>
        )}

        <div className="wc-chain" ref={logRef}>
          {chain.map((it, i) => (
            <div key={i} className={`wc-word wc-${it.by}`}>
              <span className="wc-who">{it.by === 'ai' ? '초텐쨩' : '나'}</span>
              <span className="wc-text">{it.word}</span>
            </div>
          ))}
          {aiThinking && <div className="wc-word wc-ai wc-thinking"><span className="wc-who">초텐쨩</span><span className="wc-text">…고민 중</span></div>}
        </div>

        {finished && (
          <div className={`soup-result ${phase === 'won' ? '' : 'revealed'}`}>
            <div className="soup-result-head">{phase === 'won' ? '🏆 너의 승리!' : '😈 초텐쨩 승리…'}</div>
            <div className="restart-btns">
              <button className="btn btn-primary" onClick={start}>🔤 다시!</button>
              <button className="btn" onClick={onExit}>↩ 나가기</button>
            </div>
          </div>
        )}

        {!finished && (
          <>
            {need.length > 0 && (
              <div className="wc-need">
                다음 글자: <b>{need.join(' / ')}</b> (으)로 시작!
              </div>
            )}
            <div className="soup-input-row">
              <input
                ref={inputRef}
                className="text-input"
                placeholder={aiThinking ? '초텐쨩이 고민 중…' : myTurn ? '단어를 입력!' : '잠깐만…'}
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                disabled={!myTurn}
              />
              <button className="btn" onClick={submit} disabled={!myTurn || !input.trim()}>
                ➤ 제출
              </button>
            </div>
            {error && <div className="wc-error">⚠ {error}</div>}
            <div className="soup-action-row">
              <button className="btn" onClick={giveUp}>🏳️ 포기</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
