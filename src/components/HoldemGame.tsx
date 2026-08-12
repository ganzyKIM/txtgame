import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { supabase } from '../lib/supabase';
import { initHand, applyAction, nextDealer, type HandState, type Action } from '../game/poker/engine';
import { decideBotAction, CHOTEN_PERSONALITY, AME_PERSONALITY, type BotPersonality } from '../game/poker/bot';
import { rankLabel } from '../game/poker/deck';
import { evaluate7, HAND_CATEGORY_LABEL } from '../game/poker/handRank';
import { HAND_CATEGORY, type HandValue, type Rank } from '../game/poker/types';
import type { Form, MascotHandle } from './Mascot';
import { PixelCard, ChipStack, SeatAvatar } from './pokerUI';

/** 족보 이름 + 핵심 랭크(어떤 숫자로 만들어졌는지) — "투페어 (Q, 2)" 같은 식 */
function handSummary(hv: HandValue): string {
  const label = HAND_CATEGORY_LABEL[hv.category];
  const keyRankCount = hv.category === HAND_CATEGORY.FULL_HOUSE || hv.category === HAND_CATEGORY.TWO_PAIR ? 2 : 1;
  const ranks = hv.tiebreakers.slice(0, keyRankCount).map((r) => rankLabel(r as Rank));
  return `${label} (${ranks.join(', ')})`;
}

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
/** 서버 RPC(poker_buy_in)가 실제로 얼마를 주는지가 최종 진실이지만,
 *  봇 리바이·화면 문구용 기본값으로 이 값을 같이 씀(RPC와 손발 맞춰뒀음). */
const DEFAULT_BUYIN_CHIPS = 1000;

const SEAT_ID = ['나', '초텐쨩', '아메'] as const;
const SEAT_FORM: (Form | null)[] = [null, 'choten', 'ame'];
const SEAT_PERSONALITY: (BotPersonality | null)[] = [null, CHOTEN_PERSONALITY, AME_PERSONALITY];

type Phase = 'buyin' | 'playing' | 'busted';
type SpeechKind = 'thinking' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'win' | 'lose';

/** 상황별 대사 뱅크 — Mascot.tsx의 기존 말투(초텐쨩: 밝고 호들갑, 아메: 건조하고 짧음)를 그대로 따른다 */
const BOT_LINES: Record<'choten' | 'ame', Record<SpeechKind, string[]>> = {
  choten: {
    thinking: ['으음, 뭘 낼까~♡', '잠깐만, 고민 중!', '카드가 좋아야 할 텐데♡'],
    fold: ['에이 포기!', '이번 판은 접을래~', '안 되겠다, 폴드!'],
    check: ['체크할게~', '일단 지켜볼래♡'],
    call: ['콜! 따라갈래~', '좋아, 콜이야♡'],
    raise: ['레이즈 간다!!♡', '더 걸어볼게~ 후후', '자신있어! 레이즈!'],
    allin: ['올인이야!! 가보자고~♡', '다 걸었어!! 두근두근'],
    win: ['이겼다~!!♡ 초텐쨩 승리!', '짜잔~ 내가 이겼어!♡'],
    lose: ['으앙 졌어…', '아까워라~ 다음엔 꼭!'],
  },
  ame: {
    thinking: ['…생각 중.', '…잠깐.'],
    fold: ['…폴드.', '…접을게.'],
    check: ['…체크.'],
    call: ['…콜.', '…따라갈게.'],
    raise: ['…레이즈.', '…더 걸게.'],
    allin: ['…올인. 각오해.', '…다 걸었어.'],
    win: ['…이겼네.', '…나쁘지 않아.'],
    lose: ['…졌어. …다음엔.', '…분해.'],
  },
};

function pickLine(form: 'choten' | 'ame', kind: SpeechKind): string {
  const bank = BOT_LINES[form][kind];
  return bank[Math.floor(Math.random() * bank.length)];
}

function actionToSpeechKind(action: Action): SpeechKind {
  switch (action.type) {
    case 'fold': return 'fold';
    case 'check': return 'check';
    case 'call': return 'call';
    case 'allin': return 'allin';
    case 'raiseTo': return 'raise';
  }
}

interface Props {
  mascot: RefObject<MascotHandle | null>;
  push: (line: string) => void;
  applyBalance: (n: number) => void;
  onGoMulti: () => void;
  /** 지금이 이 게임의 첫 화면인지 알려준다 — 창 상단 "처음으로" 표시 여부 판단용 */
  onAtHomeChange?: (atHome: boolean) => void;
}

export interface HoldemGameHandle {
  /** 진행 중인 판을 버리고 구매(첫) 화면으로 돌아간다 */
  goHome: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

/** 봇 좌석 표정 — 승패/폴드/올인 상황을 기존 Mascot 이미지로 표현 */
function botExpression(_form: Form, hand: HandState, seat: number): string {
  const p = hand.players[seat];
  if (hand.street === 'handEnd') {
    if (hand.winners?.some((w) => w.seat === seat)) return 'bunny_joy';
    if (p.folded) return 'bunny_contempt';
    return 'bunny';
  }
  if (p.folded) return 'bunny_contempt';
  if (p.allIn) return 'bunny_smirk';
  if (hand.toAct === seat) return 'bunny_smirk';
  return 'bunny';
}

const HoldemGame = forwardRef<HoldemGameHandle, Props>(function HoldemGame({ mascot, push, applyBalance, onGoMulti, onAtHomeChange }, ref) {
  const [phase, setPhase] = useState<Phase>('buyin');
  const [buying, setBuying] = useState(false);
  const [buyinError, setBuyinError] = useState<string | null>(null);
  const [hand, setHand] = useState<HandState | null>(null);
  const [dealerIndex, setDealerIndex] = useState(0);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [botSpeech, setBotSpeech] = useState<Record<number, string>>({});
  const botTimer = useRef<number | null>(null);
  const lastReactedHandEnd = useRef<HandState | null>(null);

  // "처음으로"/"카테고리로" 공통 — 다른 모드로 나가지 않고 이 게임 안의 구매(첫)
  // 화면으로 되돌아간다. 진행 중인 판(이미 산 칩 포함)은 그냥 두고 버튼을 다시
  // 사면 되는 구조라 이걸로 충분하다.
  function resetToIntro() {
    if (botTimer.current) window.clearTimeout(botTimer.current);
    setHand(null);
    setBotSpeech({});
    setActionError(null);
    setBuyinError(null);
    setPhase('buyin');
  }

  useImperativeHandle(ref, () => ({ goHome: resetToIntro }), []);

  // 칩 구매/파산 화면이 이 게임의 첫 화면 — 여기선 "처음으로"가 필요 없다
  useEffect(() => {
    onAtHomeChange?.(phase === 'buyin' || phase === 'busted');
  }, [phase, onAtHomeChange]);

  // 이 게임에서는 초텐쨩·아메가 테이블 좌석에 들어와 앉으므로, 떠다니는 마스코트는 치운다.
  useEffect(() => {
    const m = mascot.current;
    m?.banish();
    return () => { m?.summon(); };
  }, [mascot]);

  useEffect(() => {
    return () => { if (botTimer.current) window.clearTimeout(botTimer.current); };
  }, []);

  async function buyIn() {
    setBuying(true); setBuyinError(null);
    try {
      const { data, error } = await rpc.rpc('poker_buy_in');
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? '구매 실패');
      applyBalance(data.balance);
      const myChips: number = data.chips ?? DEFAULT_BUYIN_CHIPS;
      push(`> 🃏 텍사스 홀덤 입장! 놀이용 칩 ${myChips}개 구매 (크레딧 ${data.cost} 소모)`);
      const players = [
        { id: SEAT_ID[0], stack: myChips },
        { id: SEAT_ID[1], stack: DEFAULT_BUYIN_CHIPS },
        { id: SEAT_ID[2], stack: DEFAULT_BUYIN_CHIPS },
      ];
      setDealerIndex(0);
      setBotSpeech({});
      setHand(initHand(players, 0, SMALL_BLIND, BIG_BLIND));
      setPhase('playing');
    } catch (e) {
      setBuyinError((e as Error).message);
    } finally {
      setBuying(false);
    }
  }

  function startNextHand(prevHand: HandState) {
    const myStack = prevHand.players[0].stack;
    if (myStack < BIG_BLIND) { setPhase('busted'); setHand(null); return; }
    // 봇이 파산하면 게임이 멈추지 않도록 조용히 리바이(봇은 크레딧을 안 쓰는 가상 상대이므로)
    const inputs = prevHand.players.map((p, i) => ({
      id: p.id, stack: i === 0 ? p.stack : (p.stack < BIG_BLIND ? DEFAULT_BUYIN_CHIPS : p.stack),
    }));
    const nd = nextDealer(3, dealerIndex);
    setDealerIndex(nd);
    setBotSpeech({});
    setHand(initHand(inputs, nd, SMALL_BLIND, BIG_BLIND));
    setActionError(null);
  }

  // 봇 턴 자동 진행 — 턴이 오면 먼저 "생각 중" 대사를 띄우고, 약간의 텀 뒤에 실제 액션+대사로 교체
  useEffect(() => {
    if (!hand || hand.street === 'handEnd') return;
    const seat = hand.toAct;
    if (seat === null || seat === 0) return;
    const personality = SEAT_PERSONALITY[seat];
    const form = SEAT_FORM[seat];
    if (!personality || !form) return;
    setBotSpeech((s) => ({ ...s, [seat]: pickLine(form, 'thinking') }));
    botTimer.current = window.setTimeout(() => {
      const action = decideBotAction(hand, seat, personality);
      const res = applyAction(hand, seat, action);
      if (res.ok) {
        setBotSpeech((s) => ({ ...s, [seat]: pickLine(form, actionToSpeechKind(action)) }));
        setHand(res.state);
      }
    }, 750 + Math.random() * 550);
    return () => { if (botTimer.current) window.clearTimeout(botTimer.current); };
  }, [hand]);

  // 핸드 종료 시 승/패 리액션 (폴드로 이미 빠진 좌석은 방금 한 폴드 대사를 그대로 유지)
  useEffect(() => {
    if (!hand || hand.street !== 'handEnd' || lastReactedHandEnd.current === hand) return;
    lastReactedHandEnd.current = hand;
    setBotSpeech((s) => {
      const next = { ...s };
      for (const seat of [1, 2]) {
        const p = hand.players[seat];
        const form = SEAT_FORM[seat];
        if (!form || p.folded) continue;
        const won = hand.winners?.some((w) => w.seat === seat) ?? false;
        next[seat] = pickLine(form, won ? 'win' : 'lose');
      }
      return next;
    });
  }, [hand]);

  // 내 턴이 새로 돌아올 때마다 레이즈 스텝퍼는 그 판의 최소 레이즈로 리셋
  useEffect(() => {
    if (hand && hand.toAct === 0) setRaiseAmount(0);
  }, [hand?.toAct, hand?.street]);

  function act(action: Action) {
    if (!hand || hand.toAct !== 0) return;
    const res = applyAction(hand, 0, action);
    if (!res.ok) { setActionError(res.error ?? '불가능한 액션'); return; }
    setActionError(null);
    setHand(res.state);
  }

  if (phase === 'buyin' || phase === 'busted') {
    return (
      <div className="body">
        <div className="soup-intro">
          <div className="soup-intro-card">
            <h2 className="persuade-title">🃏 텍사스 홀덤</h2>
            {phase === 'busted' && (
              <p className="soup-lead"><b>칩을 모두 잃었어…</b> 다시 구매하고 이어서 해볼까?</p>
            )}
            <p className="soup-lead">
              초텐쨩·아메와 함께하는 <b>3인 캐시게임</b>이야.
            </p>
            <ul className="soup-rules">
              <li>소량의 크레딧으로 <b>놀이용 칩</b>을 구매해서 시작해(운영자가 주는 재화라 실제 결제와 무관해).</li>
              <li>칩을 다 잃으면 언제든 다시 구매(리바이)할 수 있어.</li>
              <li>초텐쨩은 느슨하고 블러프를 잘 걸어. 아메는 타이트하고 정직하게 베팅해 — 상대별로 공략이 달라!</li>
            </ul>
            {buyinError && <div style={{ fontSize: 11, color: '#c03060' }}>{buyinError}</div>}
            <div className="soup-intro-btns">
              <button className="btn btn-primary" disabled={buying} onClick={() => void buyIn()}>
                {buying ? '구매 중…' : '🃏 칩 구매하고 입장 (싱글)'}
              </button>
              <button className="btn" onClick={onGoMulti}>👥 멀티로 하기</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hand) return null;

  const me = hand.players[0];
  const owed = hand.currentBet - me.betThisStreet;
  const myTurn = hand.toAct === 0;
  const maxTotal = me.betThisStreet + me.stack;
  const minRaiseTotal = Math.min(hand.currentBet + hand.minRaise, maxTotal);
  const potNow = hand.players.reduce((s, p) => s + p.committed, 0);
  const finished = hand.street === 'handEnd';
  const revealBotCards = finished && (hand.winners?.some((w) => w.handValue !== undefined) ?? false);
  const canRaise = minRaiseTotal < maxTotal;
  const raiseClamped = Math.max(minRaiseTotal, Math.min(maxTotal, raiseAmount || minRaiseTotal));

  function bumpRaise(delta: number) {
    setRaiseAmount(Math.max(minRaiseTotal, Math.min(maxTotal, (raiseAmount || minRaiseTotal) + delta)));
  }

  /** 쇼다운에서 이 좌석이 어떤 족보를 만들었는지 — 폴드했거나 쇼다운 자체가 없었으면 null */
  const seatShowdownLine = (seat: number): string | null => {
    const p = hand.players[seat];
    if (!revealBotCards || p.folded || !p.holeCards) return null;
    const hv = evaluate7([...p.holeCards, ...hand.board]);
    return `${p.id}: ${handSummary(hv)}`;
  };

  return (
    <div className="body">
      <section className="panel soup-panel holdem-panel">
        <div className="holdem-opponents">
          {[1, 2].map((seat) => {
            const p = hand.players[seat];
            const form = SEAT_FORM[seat] as Form;
            const show = revealBotCards && !p.folded;
            return (
              <div key={seat} className="holdem-seat-group">
                <div className={`holdem-seat${hand.toAct === seat ? ' is-turn' : ''}${p.folded ? ' is-folded' : ''}`}>
                  {dealerIndex === seat && <span className="holdem-dealer-badge">D</span>}
                  {botSpeech[seat] && <div className="holdem-speech">{botSpeech[seat]}</div>}
                  <SeatAvatar src={`/char/${form}_${botExpression(form, hand, seat)}.png`} />
                  <div className="holdem-seat-name">
                    {p.id} · 칩 {p.stack}{p.allIn && !finished ? ' (올인)' : ''}
                    {p.betThisStreet > 0 ? ` · 베팅 ${p.betThisStreet}` : ''}
                  </div>
                  <div className="holdem-seat-cards">
                    <PixelCard card={p.holeCards?.[0]} hidden={!show} />
                    <PixelCard card={p.holeCards?.[1]} hidden={!show} />
                  </div>
                </div>
                <ChipStack amount={p.stack} />
              </div>
            );
          })}
        </div>

        <div className="holdem-board">
          {hand.board.map((c, i) => <PixelCard key={i} card={c} />)}
          {Array.from({ length: 5 - hand.board.length }).map((_, i) => <PixelCard key={`e${i}`} />)}
          <div className="holdem-pot">팟 {potNow}</div>
        </div>

        <div className="holdem-seat-group">
          <div className={`holdem-seat holdem-me${myTurn ? ' is-turn' : ''}${me.folded ? ' is-folded' : ''}`}>
            {dealerIndex === 0 && <span className="holdem-dealer-badge">D</span>}
            <div className="holdem-seat-name">
              {me.id} · 칩 {me.stack}{me.allIn && !finished ? ' (올인)' : ''}
              {me.betThisStreet > 0 ? ` · 베팅 ${me.betThisStreet}` : ''}
            </div>
            <div className="holdem-seat-cards">
              <PixelCard card={me.holeCards?.[0]} big />
              <PixelCard card={me.holeCards?.[1]} big />
            </div>
          </div>
          <ChipStack amount={me.stack} />
        </div>

        {actionError && <div style={{ fontSize: 11, color: '#c03060' }}>{actionError}</div>}

        {!finished && myTurn && !me.folded && !me.allIn && (
          <div className="holdem-actions">
            <div className="holdem-actions-row">
              <button className="btn btn-warn" onClick={() => act({ type: 'fold' })}>폴드</button>
              <button className="btn" onClick={() => act(owed > 0 ? { type: 'call' } : { type: 'check' })}>
                {owed > 0 ? `콜 (${Math.min(owed, me.stack)})` : '체크'}
              </button>
              <button
                className="btn"
                disabled={!canRaise}
                onClick={() => act({ type: 'raiseTo', amount: Math.min(hand.currentBet + potNow, maxTotal) })}
              >
                팟 베팅
              </button>
              <button className="btn btn-lav" onClick={() => act({ type: 'allin' })}>올인 ({maxTotal})</button>
            </div>
            {canRaise && (
              <div className="holdem-raise-row">
                <button className="btn btn-xs" onClick={() => bumpRaise(-50)}>-50</button>
                <button className="btn btn-xs" onClick={() => bumpRaise(-10)}>-10</button>
                <span className="holdem-raise-amount">{raiseClamped}</span>
                <button className="btn btn-xs" onClick={() => bumpRaise(10)}>+10</button>
                <button className="btn btn-xs" onClick={() => bumpRaise(50)}>+50</button>
                <button className="btn btn-primary" onClick={() => act({ type: 'raiseTo', amount: raiseClamped })}>
                  레이즈
                </button>
              </div>
            )}
          </div>
        )}
        {!finished && !myTurn && <div className="soup-empty">{hand.players[hand.toAct ?? 1].id}의 차례…</div>}

        {finished && (
          <div className="soup-result">
            <div className="soup-result-head">
              {hand.winners?.map((w) => `${hand.players[w.seat].id} +${w.amount}`).join(' · ')}
            </div>
            {revealBotCards && (
              <div className="holdem-showdown">
                {[0, 1, 2].map((seat) => seatShowdownLine(seat)).filter(Boolean).join(' · ')}
              </div>
            )}
            <div className="restart-btns">
              <button className="btn btn-primary" onClick={() => startNextHand(hand)}>▶ 다음 핸드</button>
              <button className="btn" onClick={resetToIntro}>↩ 첫화면으로</button>
            </div>
          </div>
        )}

      </section>
    </div>
  );
});

export default HoldemGame;
