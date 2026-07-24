import { forwardRef, useState, useEffect, useCallback, useImperativeHandle, useRef, type RefObject } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { JoinedPokerRoom } from './HoldemLobby';
import type { MascotHandle } from './Mascot';
import { initHandWithDeck, applyAction, type HandState, type Action, type Street } from '../game/poker/engine';
import { decideBotAction, CHOTEN_PERSONALITY, AME_PERSONALITY } from '../game/poker/bot';
import { parseCard, rankLabel } from '../game/poker/deck';
import { evaluate7, HAND_CATEGORY_LABEL } from '../game/poker/handRank';
import { HAND_CATEGORY, type Card, type HandValue, type Rank } from '../game/poker/types';
import { PixelCard, ChipStack, SeatAvatar, HumanAvatar } from './pokerUI';

interface Seat {
  seat_index: number;
  user_id: string | null;
  is_bot: boolean;
  bot_form: 'choten' | 'ame' | null;
  nickname: string;
  is_host: boolean;
  stack: number;
}

interface ChatEntry { user_id: string | null; nickname: string; message: string; created_at: string }

/* ════════════════════════════════════════════════════════════════════
   멀티 핸드 상태 — 호스트 브라우저가 실제 베팅 엔진(engine.ts)을 그대로
   돌리고, "다른 사람 손패를 뺀" 이 공개용 스냅샷만 방에 broadcast한다.
   딜 시점에도 호스트는 실제 카드를 아예 받지 않는다(더미 덱으로 딜) —
   스트리트가 넘어가거나 쇼다운일 때만 그 순간 필요한 만큼만 서버에서
   받아온다(applyStreetAware). React DevTools로 봐도 아직 공개 안 된
   카드는 애초에 호스트 메모리에 존재하지 않는다.
   (자세한 설계는 supabase/migrations/027_poker_hide_from_host.sql 참고)
   ════════════════════════════════════════════════════════════════════ */
interface PublicPlayerSnap {
  stack: number;
  betThisStreet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
}
interface PublicHandState {
  handNo: number;
  seats: number[]; // 이 핸드에 참여 중인 실제 seat_index들
  dealerReal: number;
  street: Street;
  toActReal: number | null;
  board: Card[];
  currentBet: number;
  minRaise: number;
  players: Record<number, PublicPlayerSnap>; // key = 실제 seat_index
  winners: { seat: number; amount: number }[] | null;
  revealedHoleCards?: Record<number, [Card, Card]>; // handEnd에서 폴드 안 한 좌석만
  log: string[];
}

interface Props {
  room: JoinedPokerRoom;
  myUserId: string;
  mascot: RefObject<MascotHandle | null>;
  applyBalance: (n: number) => void;
  onLeave: () => void;
}

export interface HoldemRoomWaitHandle {
  leaveRoom: () => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;
const MAX_SEATS = 4;
const SPEECH_MS = 4500;

function handSummary(hv: HandValue): string {
  const label = HAND_CATEGORY_LABEL[hv.category];
  const keyRankCount = hv.category === HAND_CATEGORY.FULL_HOUSE || hv.category === HAND_CATEGORY.TWO_PAIR ? 2 : 1;
  const ranks = hv.tiebreakers.slice(0, keyRankCount).map((r) => rankLabel(r as Rank));
  return `${label} (${ranks.join(', ')})`;
}

/** 봇 좌석 표정 — 싱글(HoldemGame.tsx)의 botExpression과 동일한 매핑을 공개 스냅샷 기준으로 */
function botFace(form: 'choten' | 'ame', snap: PublicPlayerSnap, isToAct: boolean, finished: boolean, won: boolean): string {
  if (finished) {
    if (won) return 'dere';
    if (snap.folded) return form === 'choten' ? 'angry' : 'yandere';
    return 'default';
  }
  if (snap.folded) return form === 'choten' ? 'angry' : 'yandere';
  if (snap.allIn) return form === 'choten' ? 'peace' : 'drug';
  if (isToAct) return form === 'choten' ? 'peace' : 'smoking';
  return 'default';
}

/** 실제 카드값이 필요없는 자리를 채우는 가짜 카드 — 호스트가 아직 공개되면 안 되는
 *  카드를 절대 손에 쥐지 않게 하기 위함(내용 자체는 의미 없음, 절대 화면에 안 나옴) */
function makeDummyDeck(n: number): Card[] {
  return Array.from({ length: n }, () => ({ rank: 2 as const, suit: 's' as const }));
}

const HoldemRoomWait = forwardRef<HoldemRoomWaitHandle, Props>(function HoldemRoomWait({ room, myUserId, mascot, applyBalance, onLeave }, ref) {
  // 카지노 테마 화면이라 떠다니는 마스코트는 치운다(홀덤 싱글과 동일 패턴)
  useEffect(() => {
    const m = mascot.current;
    m?.banish();
    return () => { m?.summon(); };
  }, [mascot]);

  const [seats, setSeats] = useState<(Seat | null)[]>(Array(MAX_SEATS).fill(null));
  const [status, setStatus] = useState<'waiting' | 'playing' | 'finished'>('waiting');
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const isHost = seats.find((s) => s?.user_id === myUserId)?.is_host ?? false;
  const humanCount = seats.filter((s) => s && !s.is_bot).length;
  const mySeatIdx = seats.findIndex((s) => s?.user_id === myUserId);
  const mySeat = mySeatIdx === -1 ? null : mySeatIdx;

  // 채널 콜백(broadcast 핸들러)은 room.id 마운트 시 한 번만 만들어져서 클로저가 그
  // 시점 값에 고정된다 — 최신 값이 필요한 것들은 ref로 우회(App.tsx의 기존 패턴과 동일).
  const seatsRef = useRef(seats);
  useEffect(() => { seatsRef.current = seats; }, [seats]);

  // 호스트의 진짜 엔진 상태 — 스트리트가 넘어가거나 쇼다운이 아닌 이상 카드는
  // 전부 더미다. 절대 그대로 broadcast하지 않는다.
  const engineRef = useRef<{ state: HandState; seats: number[]; handNo: number } | null>(null);
  const botTimerRef = useRef<number | null>(null);
  const botCardCacheRef = useRef<Record<number, [Card, Card]>>({}); // denseSeat -> 이번 핸드에서 이미 받은 봇 손패
  const [publicHand, setPublicHand] = useState<PublicHandState | null>(null);
  const [myCards, setMyCards] = useState<Card[] | null>(null);
  const [dealing, setDealing] = useState(false);
  const [rebuying, setRebuying] = useState(false);
  const [handError, setHandError] = useState<string | null>(null);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [seatSpeech, setSeatSpeech] = useState<Record<number, string>>({});
  const seatSpeechTimers = useRef<Record<number, number>>({});

  const loadSeats = useCallback(async () => {
    const { data } = await supabase
      .from('poker_members')
      .select('*')
      .eq('room_id', room.id)
      .is('left_at', null)
      .order('seat_index');
    const next: (Seat | null)[] = Array(MAX_SEATS).fill(null);
    for (const m of (data ?? []) as Seat[]) {
      if (m.seat_index >= 0 && m.seat_index < MAX_SEATS) next[m.seat_index] = m;
    }
    setSeats(next);
  }, [room.id]);

  const loadChat = useCallback(async () => {
    const { data } = await supabase
      .from('poker_chat')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at')
      .limit(100);
    if (data) setChat(data as ChatEntry[]);
  }, [room.id]);

  /** 서버가 준 손패/보드로 공개 스냅샷을 만든다 — 다른 사람 손패는 절대 포함하지 않음 */
  function buildPublicHandState(state: HandState, seatsReal: number[], handNo: number): PublicHandState {
    const players: Record<number, PublicPlayerSnap> = {};
    state.players.forEach((p, denseSeat) => {
      players[seatsReal[denseSeat]] = {
        stack: p.stack, betThisStreet: p.betThisStreet, committed: p.committed, folded: p.folded, allIn: p.allIn,
      };
    });
    let revealedHoleCards: Record<number, [Card, Card]> | undefined;
    if (state.street === 'handEnd') {
      revealedHoleCards = {};
      state.players.forEach((p, denseSeat) => {
        if (p.folded || !p.holeCards) return;
        revealedHoleCards![seatsReal[denseSeat]] = p.holeCards as [Card, Card];
      });
    }
    return {
      handNo,
      seats: seatsReal,
      dealerReal: seatsReal[state.dealerIndex],
      street: state.street,
      toActReal: state.toAct === null ? null : seatsReal[state.toAct],
      board: state.board,
      currentBet: state.currentBet,
      minRaise: state.minRaise,
      players,
      winners: state.winners ? state.winners.map((w) => ({ seat: seatsReal[w.seat], amount: w.amount })) : null,
      revealedHoleCards,
      log: state.log.slice(-6),
    };
  }

  function broadcastPublic(state: HandState, seatsReal: number[], handNo: number) {
    const payload = buildPublicHandState(state, seatsReal, handNo);
    channelRef.current?.send({ type: 'broadcast', event: 'hand_state', payload });
    setPublicHand(payload);
  }

  async function settleHandOnServer(state: HandState, seatsReal: number[], handNo: number) {
    const stacks: Record<string, number> = {};
    state.players.forEach((p, denseSeat) => { stacks[String(seatsReal[denseSeat])] = p.stack; });
    try { await rpc.rpc('poker_settle_hand', { p_room_id: room.id, p_hand_no: handNo, p_stacks: stacks }); }
    catch { /* 실패해도 치명적이지 않음 — 다음 딜 때 최신 스택으로 다시 맞춰짐 */ }
    await loadSeats();
  }

  /** 이 액션을 적용하면 카드가 몇 장 더 공개돼야 하는지 더미 카드로 미리 계산(dry-run)한
   *  뒤, 딱 그만큼만 서버에서 받아 진짜 액션에 꽂아 넣는다 — 호스트도 아직 공개 안 된
   *  카드를 미리 들고 있지 않는다(devtools로도 못 봄). */
  async function applyStreetAware(
    state: HandState, denseSeat: number, action: Action, seatsReal: number[], handNo: number,
  ): Promise<{ ok: boolean; state: HandState; error?: string }> {
    const dryState: HandState = { ...state, deck: makeDummyDeck(10), players: state.players.map((p) => ({ ...p })) };
    const dryRes = applyAction(dryState, denseSeat, action);
    if (!dryRes.ok) return dryRes;

    let working = state;
    const newBoardCount = dryRes.state.board.length - state.board.length;
    if (newBoardCount > 0) {
      const { data, error: err } = await rpc.rpc('poker_reveal_next', { p_room_id: room.id, p_hand_no: handNo, p_count: newBoardCount });
      if (err || !data?.ok) return { ok: false, state, error: data?.error ?? '카드 공개 실패' };
      working = { ...working, deck: (data.cards as string[]).map(parseCard) };
    }

    const showdownNeeded = dryRes.state.street === 'handEnd' && dryRes.state.players.filter((p) => !p.folded).length > 1;
    if (showdownNeeded) {
      const { data, error: err } = await rpc.rpc('poker_reveal_showdown', { p_room_id: room.id, p_hand_no: handNo });
      if (err || !data?.ok) return { ok: false, state, error: data?.error ?? '쇼다운 공개 실패' };
      const holeMap = data.holeCards as Record<string, [string, string]>;
      working = {
        ...working,
        players: working.players.map((p, i) => {
          if (p.folded) return p;
          const codes = holeMap[String(seatsReal[i])];
          return codes ? { ...p, holeCards: codes.map(parseCard) as [Card, Card] } : p;
        }),
      };
    }

    return applyAction(working, denseSeat, action);
  }

  /** 봇 턴이 왔을 때만 그때그때 그 봇의 손패를 받는다(사람 상대 손패는 여기서 절대 안 건드림) */
  async function ensureBotCards(state: HandState, denseSeat: number, realSeat: number, handNo: number): Promise<HandState> {
    let cards = botCardCacheRef.current[denseSeat];
    if (!cards) {
      const { data, error: err } = await rpc.rpc('poker_get_bot_cards', { p_room_id: room.id, p_hand_no: handNo, p_seat: realSeat });
      if (err || !Array.isArray(data)) return state;
      cards = (data as string[]).map(parseCard) as [Card, Card];
      botCardCacheRef.current[denseSeat] = cards;
    }
    return { ...state, players: state.players.map((p, i) => (i === denseSeat ? { ...p, holeCards: cards! } : p)) };
  }

  /** 상태 갱신 + broadcast + (필요하면) 다음 봇 턴 예약까지 한 번에 — 봇 연쇄 액션은
   *  이 함수가 스스로를 재귀 호출하는 방식으로 자연스럽게 이어진다. */
  function applyAndBroadcast(state: HandState, seatsReal: number[], handNo: number) {
    engineRef.current = { state, seats: seatsReal, handNo };
    broadcastPublic(state, seatsReal, handNo);
    if (state.street === 'handEnd') { void settleHandOnServer(state, seatsReal, handNo); return; }
    const denseToAct = state.toAct;
    if (denseToAct === null) return;
    const realSeat = seatsReal[denseToAct];
    const seatInfo = seatsRef.current[realSeat];
    if (!seatInfo?.is_bot || !seatInfo.bot_form) return;
    const personality = seatInfo.bot_form === 'choten' ? CHOTEN_PERSONALITY : AME_PERSONALITY;
    if (botTimerRef.current) window.clearTimeout(botTimerRef.current);
    botTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const withCards = await ensureBotCards(state, denseToAct, realSeat, handNo);
        const action = decideBotAction(withCards, denseToAct, personality);
        const res = await applyStreetAware(withCards, denseToAct, action, seatsReal, handNo);
        if (res.ok) applyAndBroadcast(res.state, seatsReal, handNo);
        else setHandError(res.error ?? null);
      })();
    }, 700 + Math.random() * 500);
  }

  async function applyEngineAction(realSeat: number, action: Action) {
    const eng = engineRef.current;
    if (!eng) return;
    const denseSeat = eng.seats.indexOf(realSeat);
    if (denseSeat === -1 || eng.state.toAct !== denseSeat) return;
    const res = await applyStreetAware(eng.state, denseSeat, action, eng.seats, eng.handNo);
    if (!res.ok) { setHandError(res.error ?? '불가능한 액션'); return; }
    setHandError(null);
    applyAndBroadcast(res.state, eng.seats, eng.handNo);
  }

  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  useEffect(() => {
    void loadSeats();
    void loadChat();

    const ch = supabase.channel(`poker:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poker_members', filter: `room_id=eq.${room.id}` }, () => void loadSeats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poker_rooms', filter: `id=eq.${room.id}` }, (payload) => {
        const row = payload.new as { status?: 'waiting' | 'playing' | 'finished' };
        if (row.status) setStatus(row.status);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poker_chat', filter: `room_id=eq.${room.id}` }, (payload) => {
        setChat((prev) => [...prev, payload.new as ChatEntry].slice(-100));
      })
      .on('broadcast', { event: 'hand_state' }, ({ payload }) => {
        setPublicHand(payload as PublicHandState);
      })
      .on('broadcast', { event: 'action_request' }, ({ payload }) => {
        if (!isHostRef.current) return;
        const { seat, userId, action } = payload as { seat: number; userId: string; action: Action };
        const owner = seatsRef.current[seat];
        if (!owner || owner.user_id !== userId) return; // 가벼운 자기 좌석 검증(놀이용 칩 수준으로 충분)
        void applyEngineAction(seat, action);
      })
      .on('broadcast', { event: 'request_state' }, () => {
        if (isHostRef.current && engineRef.current) {
          const eng = engineRef.current;
          broadcastPublic(eng.state, eng.seats, eng.handNo);
        }
      })
      .subscribe();
    channelRef.current = ch;

    return () => { void supabase.removeChannel(ch); };
  }, [room.id, loadSeats, loadChat]);

  // 재접속/신규 조인 등으로 핸드 진행 중인데 아직 공개 스냅샷을 못 받았으면 호스트에게 재전송 요청
  useEffect(() => {
    if (status !== 'playing' || publicHand || isHost) return;
    const t = window.setTimeout(() => {
      channelRef.current?.send({ type: 'broadcast', event: 'request_state', payload: {} });
    }, 400);
    return () => window.clearTimeout(t);
  }, [status, publicHand, isHost]);

  // 새 핸드가 시작되면(handNo 변경) 내 손패를 내 것만 따로 받아온다
  useEffect(() => {
    if (!publicHand || mySeat === null) { setMyCards(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await rpc.rpc('poker_get_my_cards', { p_room_id: room.id, p_hand_no: publicHand.handNo });
      if (!cancelled && Array.isArray(data)) setMyCards((data as string[]).map(parseCard));
    })();
    return () => { cancelled = true; };
  }, [publicHand?.handNo, mySeat, room.id]);

  // 내 턴이 새로 돌아올 때마다 레이즈 스텝퍼는 최소 레이즈로 리셋
  useEffect(() => {
    if (publicHand && publicHand.toActReal === mySeat) setRaiseAmount(0);
  }, [publicHand?.toActReal, publicHand?.street, mySeat]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  // 새 채팅이 도착하면 보낸 사람 좌석 위에 말풍선으로 잠깐 띄운다(초텐/아메 대사와 같은 방식)
  useEffect(() => {
    const last = chat[chat.length - 1];
    if (!last) return;
    const seat = seatsRef.current.findIndex((s) => s?.user_id === last.user_id);
    if (seat === -1) return;
    setSeatSpeech((s) => ({ ...s, [seat]: last.message }));
    if (seatSpeechTimers.current[seat]) window.clearTimeout(seatSpeechTimers.current[seat]);
    seatSpeechTimers.current[seat] = window.setTimeout(() => {
      setSeatSpeech((s) => { const next = { ...s }; delete next[seat]; return next; });
    }, SPEECH_MS);
  }, [chat]);

  async function dealNextHand() {
    setDealing(true); setHandError(null);
    try {
      const { data, error: err } = await rpc.rpc('poker_deal_hand', { p_room_id: room.id });
      if (err || !data?.ok) throw new Error(data?.error ?? '딜 실패');
      const seatsReal: number[] = data.seats;
      const n = seatsReal.length;
      const dealerDense = seatsReal.indexOf(data.dealerSeat);
      const dummyDeck = makeDummyDeck(2 * n + 5);
      const playerInputs = seatsReal.map((realSeat) => {
        const m = seatsRef.current[realSeat];
        return { id: m?.nickname ?? `좌석${realSeat}`, stack: m?.stack ?? 0 };
      });
      const state = initHandWithDeck(playerInputs, dealerDense, data.smallBlind, data.bigBlind, dummyDeck);
      botCardCacheRef.current = {};
      applyAndBroadcast(state, seatsReal, data.handNo);
    } catch (e) { setHandError((e as Error).message); }
    setDealing(false);
  }

  function submitAction(action: Action) {
    if (mySeat === null) return;
    if (isHostRef.current) {
      void applyEngineAction(mySeat, action);
    } else {
      channelRef.current?.send({ type: 'broadcast', event: 'action_request', payload: { seat: mySeat, userId: myUserId, action } });
    }
  }

  async function rebuy() {
    setRebuying(true); setHandError(null);
    try {
      const { data, error: err } = await rpc.rpc('poker_rebuy', { p_room_id: room.id });
      if (err || !data?.ok) throw new Error(data?.error ?? '재구매 실패');
      applyBalance(data.balance);
      await loadSeats();
    } catch (e) { setHandError((e as Error).message); }
    setRebuying(false);
  }

  async function addBot(form: 'choten' | 'ame') {
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await rpc.rpc('poker_add_bot', { p_room_id: room.id, p_form: form });
      if (err || !data?.ok) throw new Error(data?.error ?? '봇 추가 실패');
      await loadSeats();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function removeBot(seatIndex: number) {
    setBusy(true); setError(null);
    try {
      await rpc.rpc('poker_remove_bot', { p_room_id: room.id, p_seat: seatIndex });
      await loadSeats();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function leaveRoom() {
    try { await rpc.rpc('poker_leave_room', { p_room_id: room.id }); } catch { /* 무시 */ }
    onLeave();
  }

  // 상단 "처음으로" 버튼(App.tsx)에서도 같은 나가기 경로를 타도록 노출
  useImperativeHandle(ref, () => ({ leaveRoom }), [room.id]);

  function sendChat() {
    const m = chatInput.trim();
    if (!m) return;
    setChatInput('');
    void rpc.rpc('poker_send_chat', { p_room_id: room.id, p_message: m });
  }


  // ── 핸드 진행 중 화면 ──────────────────────────────────────────
  if (status === 'playing') {
    const ph = publicHand;
    return (
      <div className="body">
        <section className="panel soup-panel holdem-panel">
          {!ph ? (
            <div className="soup-empty">핸드 정보 받는 중…</div>
          ) : (() => {
            const finished = ph.street === 'handEnd';
            const myPlayer = mySeat !== null ? ph.players[mySeat] : undefined;
            const myTurn = ph.toActReal === mySeat && mySeat !== null;
            const owed = myPlayer ? ph.currentBet - myPlayer.betThisStreet : 0;
            const maxTotal = myPlayer ? myPlayer.betThisStreet + myPlayer.stack : 0;
            const minRaiseTotal = Math.min(ph.currentBet + ph.minRaise, maxTotal);
            const potNow = Object.values(ph.players).reduce((s, p) => s + p.committed, 0);
            const canRaise = minRaiseTotal < maxTotal;
            const raiseClamped = Math.max(minRaiseTotal, Math.min(maxTotal, raiseAmount || minRaiseTotal));
            const otherSeats = ph.seats.filter((s) => s !== mySeat);

            function bumpRaise(delta: number) {
              setRaiseAmount(Math.max(minRaiseTotal, Math.min(maxTotal, (raiseAmount || minRaiseTotal) + delta)));
            }

            return (
              <>
                <div className="holdem-opponents">
                  {otherSeats.map((seat) => {
                    const snap = ph.players[seat];
                    const info = seats[seat];
                    if (!snap || !info) return null;
                    const isToAct = ph.toActReal === seat;
                    const won = finished && (ph.winners?.some((w) => w.seat === seat) ?? false);
                    const shown = finished ? ph.revealedHoleCards?.[seat] : undefined;
                    return (
                      <div key={seat} className="holdem-seat-group">
                        <div className={`holdem-seat${isToAct ? ' is-turn' : ''}${snap.folded ? ' is-folded' : ''}`}>
                          {ph.dealerReal === seat && <span className="holdem-dealer-badge">D</span>}
                          {seatSpeech[seat] && <div className="holdem-speech">{seatSpeech[seat]}</div>}
                          {info.is_bot && info.bot_form ? (
                            <SeatAvatar src={`/char/${info.bot_form}_${botFace(info.bot_form, snap, isToAct, finished, won)}.png`} />
                          ) : (
                            <HumanAvatar nickname={info.nickname} />
                          )}
                          <div className="holdem-seat-name">
                            {info.nickname} · 칩 {snap.stack}{snap.allIn && !finished ? ' (올인)' : ''}
                            {snap.betThisStreet > 0 ? ` · 베팅 ${snap.betThisStreet}` : ''}
                          </div>
                          <div className="holdem-seat-cards">
                            <PixelCard card={shown?.[0]} hidden={!shown} />
                            <PixelCard card={shown?.[1]} hidden={!shown} />
                          </div>
                        </div>
                        <ChipStack amount={snap.stack} />
                      </div>
                    );
                  })}
                </div>

                <div className="holdem-board">
                  {ph.board.map((c, i) => <PixelCard key={i} card={c} />)}
                  {Array.from({ length: 5 - ph.board.length }).map((_, i) => <PixelCard key={`e${i}`} />)}
                  <div className="holdem-pot">팟 {potNow}</div>
                </div>

                {mySeat !== null && myPlayer ? (
                  <div className="holdem-seat-group">
                    <div className={`holdem-seat holdem-me${myTurn ? ' is-turn' : ''}${myPlayer.folded ? ' is-folded' : ''}`}>
                      {ph.dealerReal === mySeat && <span className="holdem-dealer-badge">D</span>}
                      {seatSpeech[mySeat] && <div className="holdem-speech">{seatSpeech[mySeat]}</div>}
                      <div className="holdem-seat-name">
                        {seats[mySeat]?.nickname} · 칩 {myPlayer.stack}{myPlayer.allIn && !finished ? ' (올인)' : ''}
                        {myPlayer.betThisStreet > 0 ? ` · 베팅 ${myPlayer.betThisStreet}` : ''}
                      </div>
                      <div className="holdem-seat-cards">
                        <PixelCard card={myCards?.[0]} big />
                        <PixelCard card={myCards?.[1]} big />
                      </div>
                    </div>
                    <ChipStack amount={myPlayer.stack} />
                  </div>
                ) : mySeat !== null ? (
                  <div className="soup-result">
                    <div className="soup-empty">칩이 부족해서 이번 핸드는 관전 중이야.</div>
                    <div className="restart-btns">
                      <button className="btn btn-primary" disabled={rebuying} onClick={() => void rebuy()}>
                        {rebuying ? '구매 중…' : '🃏 칩 재구매'}
                      </button>
                      <button className="btn" onClick={() => void leaveRoom()}>나가기</button>
                    </div>
                  </div>
                ) : (
                  <div className="soup-empty">관전 중이야.</div>
                )}

                {handError && <div style={{ fontSize: 11, color: '#c03060' }}>{handError}</div>}

                {!finished && myTurn && myPlayer && !myPlayer.folded && !myPlayer.allIn && (
                  <div className="holdem-actions">
                    <div className="holdem-actions-row">
                      <button className="btn btn-warn" onClick={() => submitAction({ type: 'fold' })}>폴드</button>
                      <button className="btn" onClick={() => submitAction(owed > 0 ? { type: 'call' } : { type: 'check' })}>
                        {owed > 0 ? `콜 (${Math.min(owed, myPlayer.stack)})` : '체크'}
                      </button>
                      <button
                        className="btn"
                        disabled={!canRaise}
                        onClick={() => submitAction({ type: 'raiseTo', amount: Math.min(ph.currentBet + potNow, maxTotal) })}
                      >
                        팟 베팅
                      </button>
                      <button className="btn btn-lav" onClick={() => submitAction({ type: 'allin' })}>올인 ({maxTotal})</button>
                    </div>
                    {canRaise && (
                      <div className="holdem-raise-row">
                        <button className="btn btn-xs" onClick={() => bumpRaise(-50)}>-50</button>
                        <button className="btn btn-xs" onClick={() => bumpRaise(-10)}>-10</button>
                        <span className="holdem-raise-amount">{raiseClamped}</span>
                        <button className="btn btn-xs" onClick={() => bumpRaise(10)}>+10</button>
                        <button className="btn btn-xs" onClick={() => bumpRaise(50)}>+50</button>
                        <button className="btn btn-primary" onClick={() => submitAction({ type: 'raiseTo', amount: raiseClamped })}>
                          레이즈
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {!finished && !myTurn && ph.toActReal !== null && (
                  <div className="soup-empty">{seats[ph.toActReal]?.nickname ?? '?'}의 차례…</div>
                )}

                {finished && (
                  <div className="soup-result">
                    <div className="soup-result-head">
                      {ph.winners?.map((w) => `${seats[w.seat]?.nickname ?? '?'} +${w.amount}`).join(' · ')}
                    </div>
                    {ph.revealedHoleCards && (
                      <div className="holdem-showdown">
                        {Object.entries(ph.revealedHoleCards).map(([seatStr, cards]) => {
                          const seat = Number(seatStr);
                          const hv = evaluate7([...cards, ...ph.board]);
                          return `${seats[seat]?.nickname ?? '?'}: ${handSummary(hv)}`;
                        }).join(' · ')}
                      </div>
                    )}
                    <div className="restart-btns">
                      {isHost ? (
                        <button className="btn btn-primary" disabled={dealing} onClick={() => void dealNextHand()}>
                          {dealing ? '준비 중…' : '▶ 다음 핸드'}
                        </button>
                      ) : (
                        <div className="soup-empty">호스트가 다음 핸드를 준비하는 중…</div>
                      )}
                      <button className="btn" onClick={() => void leaveRoom()}>나가기</button>
                    </div>
                  </div>
                )}

                <div ref={chatContainerRef} className="sunken" style={{ minHeight: 64, maxHeight: 110, overflowY: 'auto', padding: 4, fontSize: 11 }}>
                  {chat.map((c, i) => (
                    <div key={i} style={{ color: c.user_id === myUserId ? 'var(--magenta-d)' : 'var(--ink)' }}>
                      <b>{c.nickname}</b>: {c.message}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input className="sunken" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendChat(); }}
                    placeholder="채팅…" style={{ flex: 1, fontSize: 11, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
                  <button className="btn btn-xs" onClick={sendChat}>전송</button>
                </div>
              </>
            );
          })()}
        </section>
      </div>
    );
  }

  // ── 대기실(좌석 배정) 화면 ─────────────────────────────────────
  return (
    <div className="body">
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div className="panel-title">
          <span>◆ {room.hostNickname}의 테이블</span>
          <span className="soup-hint-counter">{status === 'waiting' ? '대기 중' : '종료'}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {seats.map((s, i) => (
            <div key={i} className="raised" style={{ padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--ink-soft)', width: 14 }}>{i + 1}</span>
              {s ? (
                <>
                  <span style={{ flex: 1, fontSize: 12 }}>
                    {s.is_bot ? (s.bot_form === 'choten' ? '🌸 ' : '🖤 ') : ''}{s.nickname}
                    {s.user_id === myUserId ? ' (나)' : ''}{s.is_host ? ' 👑' : ''}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>칩 {s.stack}</span>
                  {isHost && s.is_bot && (
                    <button className="btn btn-xs btn-warn" disabled={busy} onClick={() => void removeBot(i)}>빼기</button>
                  )}
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-soft)' }}>빈 자리</span>
                  {isHost && (
                    <>
                      <button className="btn btn-xs" disabled={busy} onClick={() => void addBot('choten')}>+초텐쨩</button>
                      <button className="btn btn-xs" disabled={busy} onClick={() => void addBot('ame')}>+아메</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}
        {handError && <div style={{ fontSize: 11, color: '#c03060' }}>{handError}</div>}

        <div ref={chatContainerRef} className="sunken" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 4, fontSize: 11 }}>
          {chat.map((c, i) => (
            <div key={i} style={{ color: c.user_id === myUserId ? 'var(--magenta-d)' : 'var(--ink)' }}>
              <b>{c.nickname}</b>: {c.message}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="sunken" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendChat(); }}
            placeholder="채팅…" style={{ flex: 1, fontSize: 12, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
          <button className="btn btn-xs" onClick={sendChat}>전송</button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {isHost ? (
            <button
              className="btn btn-primary" style={{ flex: 1 }}
              disabled={dealing || humanCount < 1 || seats.filter(Boolean).length < 2}
              onClick={() => void dealNextHand()}
            >
              {dealing ? '준비 중…' : '▶ 게임 시작'}
            </button>
          ) : (
            <div className="soup-empty" style={{ flex: 1 }}>호스트가 시작하길 기다리는 중…</div>
          )}
          <button className="btn" onClick={() => void leaveRoom()}>나가기</button>
        </div>
      </div>
    </div>
  );
});

export default HoldemRoomWait;
