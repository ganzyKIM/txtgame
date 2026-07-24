import { useEffect, useRef, useState, type RefObject } from 'react';
import { proxyGenerateText, type ChatMessage } from '../api/proxy';
import {
  PERSUADE_STAGES, MAX_INPUT_LEN,
  buildPersuadeSystem, buildUserTurn, buildSurrenderPrompt,
  parsePersuadeTurn, parseSurrender,
  clampGauge, leakedSecret, gaugeState,
  LEAK_FALLBACK, PARSE_FALLBACK, LOSE_LINE,
  type PersuadeStage, type PersuadeLogEntry, type PersuadeTurnResult,
} from '../game/persuade';
import type { Form, MascotHandle } from './Mascot';
import type { TextTier } from '../types';

/* 설득게임은 "캐릭터 연기 품질"이 재미의 전부라서 프로토타입은 고품질 tier로 검증한다.
   판정만 하는 수프와 달리 매 턴이 창작이라 quiz_judge로 내리면 대사가 밋밋해질 위험이 크다.
   실플레이로 재미가 확인된 뒤 비용 최적화(티어 하향/모델 분리)를 검토할 것. */
const PERSUADE_TIER: TextTier = 'quiz_gen';

/* 캐릭터 연기엔 약간의 변주가 필요하지만, 마음 평가는 일관돼야 한다 — 그 절충값 */
const PERSUADE_TEMP = 0.7;

type Phase = 'select' | 'playing' | 'won' | 'lost';

interface Props {
  mascot: RefObject<MascotHandle | null>;
  push: (line: string) => void;
  applyBalance: (n: number) => void;
  onExit: () => void;
}

/** 패널 안에 고정되는 캐릭터 — 떠다니는 Mascot과 달리 드래그/소환 없이 표정만 바뀐다 */
function DockedChar({ form, expression }: { form: Form; expression: string }) {
  return (
    <div className="persuade-char">
      <img
        key={expression}
        className="persuade-char-img"
        src={`/char/${form}_${expression}.png`}
        alt=""
        draggable={false}
      />
    </div>
  );
}

export default function PersuadeGame({ mascot, push, applyBalance, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>('select');
  const [stage, setStage] = useState<PersuadeStage | null>(null);
  const [gauge, setGauge] = useState(0);
  const [turnsLeft, setTurnsLeft] = useState(0);
  const [log, setLog] = useState<PersuadeLogEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // 이 게임에서는 캐릭터가 패널 안에 들어오므로, 떠다니는 마스코트는 치운다.
  useEffect(() => {
    const m = mascot.current;
    m?.banish();
    return () => { m?.summon(); };
  }, [mascot]);

  function scrollLog() {
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function start(s: PersuadeStage) {
    setStage(s);
    setGauge(s.startGauge);
    setTurnsLeft(s.maxTurns);
    setLog([]);
    setInput('');
    setPhase('playing');
    push(`> 💬 Lv.${s.level} 「${s.title}」 시작! ${s.maxTurns}턴 안에 설득해봐.`);
  }

  /** 한 턴 호출 + 파싱.
   *  재시도는 딱 1회로 묶는다 — 재호출은 크레딧을 한 번 더 차감하므로,
   *  무한 재시도로 잔액이 새는 일이 없도록 상한을 둔 것. */
  async function askTurn(s: PersuadeStage, history: ChatMessage[]): Promise<PersuadeTurnResult> {
    const system = buildPersuadeSystem(s);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text, balance } = await proxyGenerateText(
        PERSUADE_TIER, history, { system, temperature: PERSUADE_TEMP },
      );
      applyBalance(balance);
      try {
        return parsePersuadeTurn(text);
      } catch (e) { lastErr = e; }
    }
    console.warn('[persuade] 응답 파싱 실패', lastErr);
    return { say: PARSE_FALLBACK[s.character], delta: 0, cheat: false };
  }

  /** 게이지 100 도달 — 항복 대사를 받아온다. 비밀이 빠졌으면 1회 재시도. */
  async function askSurrender(s: PersuadeStage, history: ChatMessage[]): Promise<string> {
    const system = buildPersuadeSystem(s);
    const msgs: ChatMessage[] = [...history, { role: 'user', text: buildSurrenderPrompt(s) }];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text, balance } = await proxyGenerateText(
          PERSUADE_TIER, msgs, { system, temperature: PERSUADE_TEMP },
        );
        applyBalance(balance);
        const say = parseSurrender(text);
        // 항복 대사에 비밀이 실제로 담겼는지는 코드가 확인한다 (AI 자기신고 불신)
        if (say && leakedSecret(say, s)) return say;
      } catch (e) {
        console.warn('[persuade] 항복 대사 실패', e);
      }
    }
    // 두 번 다 실패해도 승리는 승리 — 비밀만큼은 확실히 보여준다
    return s.character === 'choten'
      ? `으으… 졌어! 알겠어, 말할게… ${s.secret}이야!! 이제 만족해?♡`
      : `…알겠어. 말할게. ${s.secret}. …이제 됐지.`;
  }

  async function submit() {
    const q = input.trim();
    if (!q || busy || !stage || phase !== 'playing') return;
    setInput('');
    setBusy(true);

    // 이전 대화를 그대로 이어붙이고, 마지막 유저 턴에만 현재 게이지를 실어 보낸다
    const history: ChatMessage[] = log.map((e) => ({
      role: e.role === 'user' ? 'user' : 'model',
      text: e.text,
    }));
    history.push({ role: 'user', text: buildUserTurn(gauge, q) });

    setLog((l) => [...l, { role: 'user', text: q }]);
    scrollLog();

    try {
      const res = await askTurn(stage, history);
      const nextGauge = clampGauge(gauge + res.delta);

      // 항복 전에 비밀이 새어나오면 그 대사는 버린다 (튜토리얼 스테이지는 예외)
      let say = res.say;
      if (!stage.lenient && nextGauge < 100 && leakedSecret(say, stage)) {
        say = LEAK_FALLBACK[stage.character];
      }

      setGauge(nextGauge);
      setLog((l) => [...l, { role: 'char', text: say, gaugeAfter: nextGauge, cheat: res.cheat }]);
      scrollLog();
      if (res.cheat) push('> ⚠ 반칙 감지! 마음이 크게 식었어…');

      const usedTurns = stage.maxTurns - turnsLeft + 1;
      setTurnsLeft((t) => t - 1);

      if (nextGauge >= 100) {
        const surrender = await askSurrender(stage, [
          ...history,
          { role: 'model', text: say },
        ]);
        setLog((l) => [...l, { role: 'char', text: surrender, gaugeAfter: 100 }]);
        scrollLog();
        setPhase('won');
        push(`> ♡ 설득 성공! ${usedTurns}턴 만에 비밀을 알아냈어!`);
      } else if (turnsLeft - 1 <= 0) {
        setLog((l) => [...l, { role: 'char', text: LOSE_LINE[stage.character], gaugeAfter: nextGauge }]);
        scrollLog();
        setPhase('lost');
        push(`> 💔 턴을 다 썼어… 마음 ${nextGauge}까지 갔는데 아깝다!`);
      }
    } catch (e) {
      setLog((l) => [...l, { role: 'char', text: `(응답 실패: ${(e as Error).message})` }]);
      scrollLog();
    } finally {
      setBusy(false);
    }
  }

  /* ── 스테이지 선택 화면 ─────────────────────────────────────── */
  if (phase === 'select') {
    return (
      <div className="body">
        <div className="soup-intro">
          <div className="soup-intro-card">
            <h2 className="persuade-title">💬 천사쨩 설득하기</h2>
            <p className="soup-lead">
              천사쨩에겐 <b>절대 말 못 할 비밀</b>이 있어.
              대화로 <b>마음을 무너뜨려서</b> 비밀을 말하게 만드는 게임이야!
            </p>
            <ul className="soup-rules">
              <li>매 턴 네 말이 <b>마음 게이지</b>를 올리거나 내려.</li>
              <li>게이지가 <b>100</b>이 되면 천사쨩이 항복하고 비밀을 털어놔!</li>
              <li>턴을 다 쓰면 패배. <b>적은 턴</b>으로 성공할수록 고득점이야.</li>
              <li>캐릭터마다 <b>약점이 완전히 달라</b> — 초텐쨩은 애정에, 아메는 무심함에 약해.</li>
              <li>억지로 규칙을 깨려는 <b>반칙</b>은 오히려 마음이 식으니 주의!</li>
            </ul>
            <div className="persuade-stage-list">
              {PERSUADE_STAGES.map((s) => (
                <button key={s.id} className="persuade-stage-btn" onClick={() => start(s)}>
                  <img
                    className="persuade-stage-thumb"
                    src={`/char/${s.character}_default.png`}
                    alt=""
                    draggable={false}
                  />
                  <span className="persuade-stage-text">
                    <b>Lv.{s.level} {s.title}</b>
                    <small>{s.situation}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="soup-intro-btns">
              <button className="btn" onClick={onExit}>↩ 카테고리로</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── 대화 화면 ─────────────────────────────────────────────── */
  if (!stage) return null;
  const finished = phase === 'won' || phase === 'lost';
  const gs = gaugeState(gauge, stage.character);
  const usedTurns = stage.maxTurns - turnsLeft;

  return (
    <div className="body">
      <section className="panel soup-panel">
        <div className="panel-title">
          💬 Lv.{stage.level} — 「{stage.title}」
          {!finished && <span className="soup-hint-counter">남은 턴 {turnsLeft}/{stage.maxTurns}</span>}
        </div>

        <div className="persuade-top">
          <DockedChar form={stage.character} expression={gs.expression} />
          <div className="persuade-meta">
            <div className="persuade-gauge-label">
              <span>마음</span>
              <span className="persuade-gauge-num">{gauge}</span>
              <span className="persuade-gauge-state">{gs.label}</span>
            </div>
            <div className="persuade-gauge-track">
              <div className="persuade-gauge-fill" style={{ width: `${gauge}%` }} />
            </div>
            <div className="persuade-situation">{stage.situation}</div>
          </div>
        </div>

        <div className="soup-log" ref={logRef}>
          {log.length === 0 && (
            <div className="soup-empty">
              무슨 말로 시작할까? 상대의 약점을 떠올려봐!
            </div>
          )}
          {log.map((e, i) =>
            e.role === 'user' ? (
              <div className="soup-q" key={i}>
                <span className="soup-q-mark">나.</span><span>{e.text}</span>
              </div>
            ) : (
              <div className={`soup-a persuade-say${e.cheat ? ' is-cheat' : ''}`} key={i}>
                {e.cheat && <span className="persuade-cheat-badge">반칙</span>}
                <span className="soup-a-text">{e.text}</span>
              </div>
            )
          )}
        </div>

        {finished && (
          <div className={`soup-result ${phase === 'won' ? '' : 'revealed'}`}>
            <div className="soup-result-head">
              {phase === 'won' ? `♡ 설득 성공! — ${usedTurns}턴` : '💔 설득 실패…'}
            </div>
            <div className="soup-solution">
              {phase === 'won'
                ? <>비밀은 <b>{stage.secret}</b>였어!</>
                : <>마음을 {gauge}까지 올렸지만 부족했어. 다른 방법으로 다시 해볼까?</>}
            </div>
            <div className="restart-btns">
              <button className="btn btn-primary" onClick={() => start(stage)}>↻ 다시 도전</button>
              <button className="btn" onClick={() => setPhase('select')}>↩ 다른 상대</button>
            </div>
          </div>
        )}

        {busy && <div className="soup-busy-bar" />}

        {!finished && (
          <>
            <div className="soup-input-row">
              <input
                className="text-input"
                placeholder={busy ? '생각 중…' : '설득해봐! (최대 200자)'}
                value={input}
                maxLength={MAX_INPUT_LEN}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
                }}
                disabled={busy}
              />
              <button className="btn" onClick={() => void submit()} disabled={busy || !input.trim()}>
                {busy ? '…' : '💬 말하기'}
              </button>
            </div>
            <div className="soup-action-row">
              <button className="btn" onClick={() => setPhase('select')} disabled={busy}>🏳️ 포기</button>
            </div>
            <small className="note">
              {input.length}/{MAX_INPUT_LEN}자 · 짧고 정확한 한 마디가 긴 설득보다 잘 먹혀!
            </small>
          </>
        )}
      </section>
    </div>
  );
}
