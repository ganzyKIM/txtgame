import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { supabase } from '../lib/supabase';
import {
  BLACK, createBoard, findWinLine, forbiddenPoints, checkForbidden, FORBIDDEN_LABEL, opponentOf, applyMove,
  type Board, type Forbidden, type GomokuState, type Player,
} from '../game/gomoku/engine';
import { requestAiMove, warmUpAiWorker, terminateAiWorker } from '../game/gomoku/aiClient';
import GomokuBoard from './GomokuBoard';
import type { JoinedGomokuRoom } from './GomokuLobby';
import type { MascotHandle, LineKind } from './Mascot';

/** 봇은 테스트 목적이라 난이도 선택 없이 고정 — 필요해지면 나중에 노출 */
const BOT_DIFFICULTY = 'normal' as const;

/* ════════════════════════════════════════════════════════════════════
   오목 멀티 — 대기실 + 대국 화면

   오목은 숨길 정보가 없어서 홀덤 멀티처럼 "호스트가 계산해서 뿌리는"
   구조가 필요 없다. 착수는 전부 서버(gomoku_place)가 차례·빈칸·제한시간·
   승리를 검증하고 gomoku_moves에 쌓고, 양쪽 클라이언트는 그 목록을 읽어
   판을 재구성한다 — 그래서 이 컴포넌트는 "서버 상태를 그리는" 역할만 한다.

   렌주 금수만 클라이언트가 막는다(자세한 이유는 마이그레이션 029 주석 참고).
   ════════════════════════════════════════════════════════════════════ */

interface Seat {
  seat_index: number;
  user_id: string | null;
  nickname: string;
  is_host: boolean;
  is_bot: boolean;
  bot_form: 'choten' | 'ame' | null;
}

interface RoomRow {
  status: 'waiting' | 'playing' | 'finished';
  turn_seconds: number;
  turn_started_at: string | null;
  winner_seat: number | null;
  result: string | null;
  host_id: string;
}

interface MoveRow { move_no: number; seat_index: number; r: number; c: number }
interface ChatEntry { user_id: string | null; nickname: string; message: string; created_at: string }

interface Props {
  room: JoinedGomokuRoom;
  myUserId: string;
  mascot: RefObject<MascotHandle | null>;
  onLeave: () => void;
}

export interface GomokuRoomHandle {
  leaveRoom: () => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

const SEAT_LABEL: Record<number, string> = { 0: '흑 ● (선공)', 1: '백 ○ (후공)' };

const GomokuRoom = forwardRef<GomokuRoomHandle, Props>(function GomokuRoom({ room, myUserId, mascot, onLeave }, ref) {
  // 퀴즈대합전 멀티와 같은 방식 — 마스코트는 대국자가 아니라 P를 응원하는
  // 관전자로 화면에 남아있고, 국면이 바뀔 때마다 상황에 맞는 대사를 한다.
  useEffect(() => {
    mascot.current?.event('omok_mp_lobby');
  }, [mascot]);

  const [seats, setSeats] = useState<(Seat | null)[]>([null, null]);
  const [roomRow, setRoomRow] = useState<RoomRow | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 1초마다 갱신되는 표시용 시계 (남은 시간 계산 트리거)
  const [nowTick, setNowTick] = useState(() => Date.now());
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const timeoutClaimedFor = useRef<string | null>(null);
  // 호스트가 봇 턴을 대신 둘 때, 같은 국면에 대해 두 번 요청하지 않게 하는 표식
  const botRequestedAt = useRef(-1);
  // 마스코트 대사 트리거용 — 이전 대국 상태 / 이미 반응한 착수 수
  const prevStatusRef = useRef<RoomRow['status'] | undefined>(undefined);
  const mascotMoveBaseline = useRef<number | null>(null);

  // 봇이 있으면 호스트 브라우저가 탐색을 돌린다 — 첫 봇 턴에서 워커 로딩 지연이
  // 안 보이도록 미리 띄워두고, 화면을 벗어나면 정리
  useEffect(() => {
    warmUpAiWorker();
    return () => terminateAiWorker();
  }, []);

  const loadSeats = useCallback(async () => {
    const { data } = await supabase
      .from('gomoku_members')
      .select('seat_index, user_id, nickname, is_host, is_bot, bot_form')
      .eq('room_id', room.id)
      .is('left_at', null)
      .order('seat_index');
    const next: (Seat | null)[] = [null, null];
    for (const m of (data ?? []) as Seat[]) {
      if (m.seat_index === 0 || m.seat_index === 1) next[m.seat_index] = m;
    }
    setSeats(next);
  }, [room.id]);

  const loadRoom = useCallback(async () => {
    const { data } = await supabase
      .from('gomoku_rooms')
      .select('status, turn_seconds, turn_started_at, winner_seat, result, host_id')
      .eq('id', room.id)
      .maybeSingle();
    if (data) setRoomRow(data as RoomRow);
  }, [room.id]);

  const loadMoves = useCallback(async () => {
    const { data } = await supabase
      .from('gomoku_moves')
      .select('move_no, seat_index, r, c')
      .eq('room_id', room.id)
      .order('move_no');
    setMoves((data ?? []) as MoveRow[]);
  }, [room.id]);

  const loadChat = useCallback(async () => {
    const { data } = await supabase
      .from('gomoku_chat')
      .select('user_id, nickname, message, created_at')
      .eq('room_id', room.id)
      .order('created_at')
      .limit(100);
    if (data) setChat(data as ChatEntry[]);
  }, [room.id]);

  useEffect(() => {
    void loadSeats(); void loadRoom(); void loadMoves(); void loadChat();

    const ch = supabase.channel(`gomoku:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gomoku_members', filter: `room_id=eq.${room.id}` },
        () => void loadSeats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gomoku_rooms', filter: `id=eq.${room.id}` },
        () => void loadRoom())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gomoku_moves', filter: `room_id=eq.${room.id}` },
        // 재대국 시 착수가 전부 삭제되므로 INSERT만 보지 않고 매번 다시 읽는다
        () => { void loadMoves(); void loadRoom(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gomoku_chat', filter: `room_id=eq.${room.id}` },
        (payload) => setChat((prev) => [...prev, payload.new as ChatEntry].slice(-100)))
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [room.id, loadSeats, loadRoom, loadMoves, loadChat]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  // 남은 시간 표시용 1초 타이머
  useEffect(() => {
    if (roomRow?.status !== 'playing') return;
    const t = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [roomRow?.status]);

  // ── 서버 착수 목록에서 판을 재구성 ───────────────────────────
  const board: Board = useMemo(() => {
    const b = createBoard();
    for (const m of moves) b[m.r][m.c] = m.seat_index as Player;
    return b;
  }, [moves]);

  const mySeat: Player | null = useMemo(() => {
    const found = seats.find((s) => s?.user_id === myUserId);
    return found ? (found.seat_index as Player) : null;
  }, [seats, myUserId]);

  const toAct: Player = (moves.length % 2) as Player;
  const isMyTurn = roomRow?.status === 'playing' && mySeat !== null && toAct === mySeat;
  const finished = roomRow?.status === 'finished';
  const isHost = roomRow?.host_id === myUserId;
  const lastMove = moves.length > 0 ? { r: moves[moves.length - 1].r, c: moves[moves.length - 1].c } : null;

  // 대국 시작 / 종료(승·패·무) — 상태 전이 시 한 번씩만 반응한다
  useEffect(() => {
    const status = roomRow?.status;
    if (status === undefined) return;
    const prev = prevStatusRef.current;
    if (prev === 'waiting' && status === 'playing') {
      mascot.current?.event('omok_mp_start');
    }
    if (prev !== undefined && prev !== 'finished' && status === 'finished' && roomRow && mySeat !== null) {
      if (roomRow.result === 'draw') mascot.current?.event('omok_mp_draw');
      else if (roomRow.winner_seat === mySeat) mascot.current?.event('omok_mp_win');
      else if (roomRow.winner_seat !== null) mascot.current?.event('omok_mp_lose');
    }
    prevStatusRef.current = status;
  }, [roomRow, mySeat, mascot]);

  // 위협수/차단 — 새로 들어온 착수마다 P(나) 기준으로 상황을 판단해 반응한다.
  // 처음 로드 시점의 과거 기보는 흘려보내고, 그 이후 새로 도착한 수에만 반응한다.
  useEffect(() => {
    if (mascotMoveBaseline.current === null || mySeat === null) {
      mascotMoveBaseline.current = moves.length;
      return;
    }
    const n = moves.length;
    if (n <= mascotMoveBaseline.current) { mascotMoveBaseline.current = n; return; }
    mascotMoveBaseline.current = n;

    const last = moves[n - 1];
    const before = createBoard();
    for (let i = 0; i < n - 1; i++) { const m = moves[i]; before[m.r][m.c] = m.seat_index as Player; }
    const stateBefore: GomokuState = {
      board: before,
      toAct: ((n - 1) % 2) as Player,
      moves: moves.slice(0, n - 1).map((m) => ({ r: m.r, c: m.c, player: m.seat_index as Player })),
      winner: null,
      winLine: null,
      lastMove: n > 1 ? { r: moves[n - 2].r, c: moves[n - 2].c } : null,
      // "AI" 개념을 상대가 아니라 나(mySeat)로 뒤집어서 재사용한다 —
      // 그래야 situation이 "내가 만든 위협/차단" 기준으로 나온다.
      humanSeat: opponentOf(mySeat),
    };
    const res = applyMove(stateBefore, last.r, last.c);
    if (!res.ok || !res.situation) return;

    const kind: LineKind | null =
      res.situation === 'ai_threat' ? 'omok_mp_threat' :
      res.situation === 'player_threat' ? 'omok_mp_opp_threat' :
      res.situation === 'ai_block' ? 'omok_mp_block' :
      res.situation === 'player_block' ? 'omok_mp_opp_block' :
      null; // calm/win/lose/draw는 여기서 다루지 않는다 (승패는 상태 전이 쪽에서 처리)
    if (kind) mascot.current?.event(kind);
  }, [moves, mySeat, mascot]);

  // 승리 라인 — 서버가 승자만 알려주므로 마지막 착수로 라인을 되찾는다
  const winLine = useMemo(() => {
    if (!finished || roomRow?.result !== 'win' || roomRow.winner_seat === null) return null;
    const last = [...moves].reverse().find((m) => m.seat_index === roomRow.winner_seat);
    if (!last) return null;
    return findWinLine(board, last.r, last.c, roomRow.winner_seat as Player);
  }, [finished, roomRow, moves, board]);

  // 금수 표시 — 흑에게만, 그리고 내 차례일 때만
  const forbidden = useMemo<Map<string, Forbidden>>(() => {
    if (roomRow?.status !== 'playing') return new Map();
    if (mySeat !== BLACK || toAct !== BLACK) return new Map();
    return forbiddenPoints(board);
  }, [roomRow?.status, mySeat, toAct, board]);

  // ── 남은 시간 ────────────────────────────────────────────────
  // 서버 시각 기준이라 클라이언트 시계가 조금 어긋나면 표시도 조금 어긋난다.
  // 실제 승패 판정은 서버(gomoku_claim_timeout)가 하므로 표시 오차는 무해하다.
  const remainingMs = useMemo(() => {
    if (roomRow?.status !== 'playing' || !roomRow.turn_started_at) return null;
    const deadline = new Date(roomRow.turn_started_at).getTime() + roomRow.turn_seconds * 1000;
    return Math.max(0, deadline - nowTick);
  }, [roomRow, nowTick]);

  // 상대가 시간을 넘기면 승리를 주장한다 (내 차례가 아닐 때만)
  useEffect(() => {
    if (roomRow?.status !== 'playing' || remainingMs === null) return;
    if (mySeat === null || toAct === mySeat) return;
    if (remainingMs > 0) return;
    // 같은 차례에 대해 한 번만 주장
    const key = `${room.id}:${moves.length}`;
    if (timeoutClaimedFor.current === key) return;
    timeoutClaimedFor.current = key;
    void (async () => {
      // 서버 시계와 살짝 어긋날 수 있으니 여유를 두고 요청
      await new Promise((r) => window.setTimeout(r, 800));
      const { data } = await rpc.rpc('gomoku_claim_timeout', { p_room_id: room.id });
      if (!data?.ok) timeoutClaimedFor.current = null; // 아직 시간이 남았다면 다시 시도 가능
      void loadRoom();
    })();
  }, [roomRow?.status, remainingMs, mySeat, toAct, moves.length, room.id, loadRoom]);

  // ── 봇 턴 자동 진행 (호스트만) ─────────────────────────────────
  // 봇은 세션이 없어서 스스로 gomoku_place를 못 부른다. 호스트 브라우저가
  // 싱글과 같은 엔진(chooseAiMove)으로 수를 계산해 gomoku_place_as_bot으로
  // 대신 제출한다. 렌주 금수 회피도 엔진이 이미 처리해준다(engine.ts 참고).
  useEffect(() => {
    if (roomRow?.status !== 'playing' || !isHost) return;
    const botSeat = toAct;
    const seatInfo = seats[botSeat];
    if (!seatInfo?.is_bot || !seatInfo.bot_form) return;

    const token = moves.length;
    if (botRequestedAt.current === token) return; // 이 국면은 이미 요청했음
    botRequestedAt.current = token;

    let cancelled = false;
    const botState: GomokuState = {
      board,
      toAct: botSeat,
      moves: moves.map((m) => ({ r: m.r, c: m.c, player: m.seat_index as Player })),
      winner: null,
      winLine: null,
      lastMove,
      humanSeat: opponentOf(botSeat),
    };

    void (async () => {
      const move = await requestAiMove(botState, BOT_DIFFICULTY);
      if (cancelled || !move) return;
      const { data, error: err } = await rpc.rpc('gomoku_place_as_bot', {
        p_room_id: room.id, p_seat: botSeat, p_r: move.r, p_c: move.c,
      });
      if (err || !data?.ok) setError(data?.error ?? err?.message ?? '봇 착수 실패');
      void loadMoves(); void loadRoom();
    })();

    return () => { cancelled = true; };
  }, [roomRow?.status, isHost, toAct, seats, moves, board, lastMove, room.id, loadMoves, loadRoom]);

  async function addBot(form: 'choten' | 'ame') {
    setBusy(true); setError(null);
    const { data, error: err } = await rpc.rpc('gomoku_add_bot', { p_room_id: room.id, p_form: form });
    if (err || !data?.ok) setError(data?.error ?? err?.message ?? '봇 추가 실패');
    void loadSeats();
    setBusy(false);
  }

  async function removeBot(seatIndex: number) {
    setBusy(true); setError(null);
    const { error: err } = await rpc.rpc('gomoku_remove_bot', { p_room_id: room.id, p_seat: seatIndex });
    if (err) setError(err.message ?? '봇 제거 실패');
    void loadSeats();
    setBusy(false);
  }

  async function handleCellClick(r: number, c: number) {
    if (!isMyTurn || busy) return;
    if (board[r][c] !== -1) return;

    // 렌주 금수는 클라이언트가 막는다 (서버는 차례·빈칸·승리만 검증)
    if (mySeat === BLACK) {
      const f = checkForbidden(board, r, c);
      if (f) { setError(FORBIDDEN_LABEL[f]); return; }
    }

    setBusy(true); setError(null);
    const { data, error: err } = await rpc.rpc('gomoku_place', { p_room_id: room.id, p_r: r, p_c: c });
    if (err || !data?.ok) setError(data?.error ?? err?.message ?? '착수 실패');
    // 성공하면 realtime이 판을 갱신하지만, 내 화면은 즉시 반영되게 한 번 더 읽는다
    void loadMoves(); void loadRoom();
    setBusy(false);
  }

  async function startGame() {
    setBusy(true); setError(null);
    const { data, error: err } = await rpc.rpc('gomoku_start_game', { p_room_id: room.id });
    if (err || !data?.ok) setError(data?.error ?? err?.message ?? '시작 실패');
    void loadRoom();
    setBusy(false);
  }

  async function rematch() {
    setBusy(true); setError(null);
    const { data, error: err } = await rpc.rpc('gomoku_rematch', { p_room_id: room.id });
    if (err || !data?.ok) setError(data?.error ?? err?.message ?? '재대국 실패');
    timeoutClaimedFor.current = null;
    void loadMoves(); void loadRoom(); void loadSeats();
    setBusy(false);
  }

  async function resign() {
    setBusy(true);
    await rpc.rpc('gomoku_resign', { p_room_id: room.id });
    void loadRoom();
    setBusy(false);
  }

  const leaveRoom = useCallback(async () => {
    try { await rpc.rpc('gomoku_leave_room', { p_room_id: room.id }); } catch { /* 무시 */ }
    onLeave();
  }, [room.id, onLeave]);

  useImperativeHandle(ref, () => ({ leaveRoom }), [leaveRoom]);

  async function sendChat() {
    const m = chatInput.trim();
    if (!m) return;
    setChatInput('');
    const { error: err } = await rpc.rpc('gomoku_send_chat', { p_room_id: room.id, p_message: m });
    if (err) setError(`채팅 전송 실패: ${err.message}`);
  }

  const chatBar = (
    <div style={{ display: 'flex', gap: 4 }}>
      <input className="sunken" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChat(); }}
        placeholder="채팅…" style={{ flex: 1, fontSize: 11, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
      <button className="btn btn-xs" onClick={() => void sendChat()}>전송</button>
    </div>
  );

  const chatLog = (maxHeight: number) => (
    <div ref={chatContainerRef} className="sunken" style={{ minHeight: 52, maxHeight, overflowY: 'auto', padding: 4, fontSize: 11 }}>
      {chat.map((c, i) => (
        <div key={i} style={{ color: c.user_id === myUserId ? 'var(--magenta-d)' : 'var(--ink)' }}>
          <b>{c.nickname}</b>: {c.message}
        </div>
      ))}
    </div>
  );

  // ── 대기실 (아직 시작 전) ────────────────────────────────────
  if (roomRow?.status !== 'playing' && !finished) {
    const filled = seats.filter(Boolean).length;
    return (
      <div className="body">
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div className="panel-title">
            <span>◆ {room.hostNickname}의 대국</span>
            <span className="soup-hint-counter">한 수 {roomRow?.turn_seconds ?? '?'}초</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[0, 1].map((i) => {
              const s = seats[i];
              return (
                <div key={i} className="raised" style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)', width: 74 }}>{SEAT_LABEL[i]}</span>
                  {s ? (
                    <>
                      <span style={{ flex: 1, fontSize: 12 }}>
                        {s.is_bot ? (s.bot_form === 'choten' ? '🌸 ' : '🖤 ') : ''}{s.nickname}
                        {s.user_id === myUserId ? ' (나)' : ''}{s.is_host ? ' 👑' : ''}
                      </span>
                      {isHost && s.is_bot && (
                        <button className="btn btn-xs btn-warn" disabled={busy} onClick={() => void removeBot(i)}>빼기</button>
                      )}
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-soft)' }}>상대를 기다리는 중…</span>
                      {isHost && (
                        <>
                          <button className="btn btn-xs" disabled={busy} onClick={() => void addBot('choten')}>+초텐쨩</button>
                          <button className="btn btn-xs" disabled={busy} onClick={() => void addBot('ame')}>+아메</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="soup-rules" style={{ fontSize: 11, margin: 0 }}>
            렌주 룰이야 — <b>흑에게만 금수</b>(삼삼·사사·장목)가 있고 판에 ✕로 표시돼.
            제한시간을 넘기면 상대가 이겨.
          </div>

          {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}

          {chatLog(160)}
          {chatBar}

          <div style={{ display: 'flex', gap: 6 }}>
            {isHost ? (
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || filled < 2} onClick={() => void startGame()}>
                {filled < 2 ? '상대를 기다리는 중…' : busy ? '시작 중…' : '▶ 대국 시작'}
              </button>
            ) : (
              <div className="soup-empty" style={{ flex: 1 }}>호스트가 시작하길 기다리는 중…</div>
            )}
            <button className="btn" onClick={() => void leaveRoom()}>나가기</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 대국 화면 ────────────────────────────────────────────────
  const opponent = seats.find((s) => s && s.user_id !== myUserId) ?? null;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const lowTime = seconds !== null && seconds <= 5;

  const resultText = !finished ? null
    : roomRow?.result === 'draw' ? '⊙ 무승부 — 판이 꽉 찼어'
    : roomRow?.winner_seat === mySeat
      ? (roomRow?.result === 'timeout' ? '🎉 승리! 상대가 시간을 넘겼어'
        : roomRow?.result === 'resign' ? '🎉 승리! 상대가 기권했어'
        : '🎉 승리! 5개를 먼저 이었어')
      : (roomRow?.result === 'timeout' ? '💧 패배… 시간을 넘겼어'
        : roomRow?.result === 'resign' ? '💧 패배… 기권했어'
        : '💧 패배… 상대가 5개를 이었어');

  const statusText = finished ? '대국 종료'
    : isMyTurn ? `내 차례 (${mySeat === BLACK ? '흑 ●' : '백 ○'})`
    : `${opponent?.nickname ?? '상대'}의 차례…`;

  return (
    <div className="body">
      <section className="panel soup-panel gomoku-panel">
        <div className="gomoku-bar">
          <span className="gomoku-status">{statusText}</span>
          <span className="gomoku-meta">
            {!finished && seconds !== null && (
              <b className={lowTime ? 'gomoku-clock is-low' : 'gomoku-clock'}>{seconds}초</b>
            )}
            {' '}· {moves.length}수
          </span>
        </div>

        <GomokuBoard
          board={board}
          lastMove={lastMove}
          winLine={winLine}
          forbidden={forbidden}
          locked={!isMyTurn || busy || finished}
          onCellClick={(r, c) => void handleCellClick(r, c)}
        />

        {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}

        {finished ? (
          <div className="soup-result">
            <div className="soup-result-head">{resultText}</div>
            <div className="restart-btns">
              {isHost ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => void rematch()}>
                  ▶ 재대국 (흑백 교체)
                </button>
              ) : (
                <div className="soup-empty">호스트가 재대국을 준비하는 중…</div>
              )}
              <button className="btn" onClick={() => void leaveRoom()}>나가기</button>
            </div>
          </div>
        ) : (
          <div className="gomoku-actions">
            <button className="btn btn-xs btn-warn" disabled={busy} onClick={() => void resign()}>기권</button>
            <button className="btn btn-xs" onClick={() => void leaveRoom()}>나가기</button>
          </div>
        )}

        {chatLog(76)}
        {chatBar}
      </section>
    </div>
  );
});

export default GomokuRoom;
