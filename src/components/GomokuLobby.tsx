import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { MascotHandle } from './Mascot';

/* ════════════════════════════════════════════════════════════════════
   오목 멀티 — 대기실(방 목록)

   구조는 퀴즈·홀덤 멀티와 동일하게 맞췄다: 방 목록은 폴링으로 갱신,
   대기실 공용 채팅은 기록을 남기지 않는 broadcast, 이미 앉아있던 방은
   "들어가기"로 그냥 복귀한다(오목은 칩 구매가 없어 홀덤보다 단순하다).
   ════════════════════════════════════════════════════════════════════ */

export interface GomokuRoomRow {
  id: string;
  host_id: string;
  host_nickname: string;
  status: string;
  turn_seconds: number;
  gomoku_members?: { seat_index: number; left_at: string | null; user_id: string | null }[];
}

export interface JoinedGomokuRoom {
  id: string;
  hostId: string;
  hostNickname: string;
}

interface LobbyChatEntry { user_id: string; nickname: string; message: string; ts: number }

interface Props {
  myUserId: string;
  myNickname: string;
  mascot: RefObject<MascotHandle | null>;
  onJoin: (room: JoinedGomokuRoom) => void;
  onExit: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

/** 제한시간 선택지 — 요청대로 10초 단위 */
const TURN_SECONDS_CHOICES = [10, 20, 30, 60, 120] as const;

/**
 * 초대 링크(?gomoku_room=<id>)로 들어왔을 때 App.tsx가 호출한다.
 * 방 목록 화면을 거치지 않고 방 정보 조회 + 참가를 한 번에 처리한다.
 */
export async function joinGomokuRoomById(
  roomId: string, nickname: string,
): Promise<{ ok: true; room: JoinedGomokuRoom } | { ok: false; error: string }> {
  const { data: roomData, error: roomErr } = await supabase
    .from('gomoku_rooms')
    .select('id, host_id, host_nickname')
    .eq('id', roomId)
    .maybeSingle();
  const roomRow = roomData as { id: string; host_id: string; host_nickname: string } | null;
  if (roomErr || !roomRow) return { ok: false, error: '방을 찾을 수 없어 (이미 끝났거나 삭제됐을 수 있어)' };

  const { data, error: err } = await rpc.rpc('gomoku_join_room', { p_room_id: roomId, p_nickname: nickname });
  if (err || !data?.ok) return { ok: false, error: data?.error ?? err?.message ?? '참가 실패' };

  return { ok: true, room: { id: roomRow.id, hostId: roomRow.host_id, hostNickname: roomRow.host_nickname } };
}

export default function GomokuLobby({ myUserId, myNickname, mascot, onJoin, onExit }: Props) {
  // 퀴즈대합전 멀티와 같은 규칙 — 멀티 화면에서 마스코트는 대국자가 아니라
  // 옆에서 응원하는 관전자로 남는다(GomokuRoom과 동일). 캐릭터가 게임판의
  // 일부인 화면(홀덤 테이블·설득·오목 싱글)에서만 치운다.
  useEffect(() => {
    const m = mascot.current;
    m?.setCostume('kimono');       // 오목 화면에서는 기모노 차림으로만 나온다
    m?.event('omok_mp_lobby');
    return () => m?.setCostume(null);
  }, [mascot]);

  const [rooms, setRooms] = useState<GomokuRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnSeconds, setTurnSeconds] = useState<number>(30);

  const [chat, setChat] = useState<LobbyChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const ch = supabase.channel('gomoku:lobby', { config: { broadcast: { self: true } } });
    channelRef.current = ch;
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => {
      setChat((prev) => [...prev, payload as LobbyChatEntry].slice(-50));
    }).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  function handleSendChat() {
    const m = chatInput.trim();
    if (!m) return;
    setChatInput('');
    channelRef.current?.send({
      type: 'broadcast', event: 'chat',
      payload: { user_id: myUserId, nickname: myNickname, message: m, ts: Date.now() },
    });
  }

  const loadRooms = useCallback(async () => {
    const { data } = await supabase
      .from('gomoku_rooms')
      .select('*, gomoku_members(seat_index, left_at, user_id)')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setRooms(data as GomokuRoomRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRooms();
    const t = window.setInterval(() => void loadRooms(), 5000);
    return () => window.clearInterval(t);
  }, [loadRooms]);

  function seatCount(room: GomokuRoomRow): number {
    return room.gomoku_members?.filter((m) => !m.left_at).length ?? 0;
  }

  /** 내가 이미 이 방에 앉아있는지 — 새로고침 후 복귀 판단용 */
  function isMine(room: GomokuRoomRow): boolean {
    return room.gomoku_members?.some((m) => !m.left_at && m.user_id === myUserId) ?? false;
  }

  async function handleCreate() {
    setCreating(true); setError(null);
    try {
      const { data: roomId, error: err } = await rpc.rpc('gomoku_create_room', {
        p_nickname: myNickname, p_turn_seconds: turnSeconds,
      });
      if (err || !roomId) throw err ?? new Error('방 생성 실패');
      onJoin({ id: roomId, hostId: myUserId, hostNickname: myNickname });
    } catch (e) { setError((e as Error)?.message ?? '방 생성 실패'); setCreating(false); }
  }

  async function handleJoin(room: GomokuRoomRow) {
    setJoining(room.id); setError(null);
    try {
      const { data, error: err } = await rpc.rpc('gomoku_join_room', {
        p_room_id: room.id, p_nickname: myNickname,
      });
      if (err || !data?.ok) throw new Error(data?.error ?? err?.message ?? '참가 실패');
      onJoin({ id: room.id, hostId: room.host_id, hostNickname: room.host_nickname });
    } catch (e) { setError((e as Error)?.message ?? '참가 실패'); setJoining(null); }
  }

  return (
    <div className="body">
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div className="panel-title">
          <span>◆ 오목 — 멀티 대기실</span>
        </div>

        <div className="soup-rules" style={{ fontSize: 11, margin: 0 }}>
          2인 대국이야. 방을 만들 때 <b>한 수 제한시간</b>을 정할 수 있고, 시간을 넘기면 상대가 이겨.
          렌주 룰(흑 금수)이 적용돼.
        </div>

        <div className="gomoku-create-row">
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>제한시간</span>
          <div className="seg">
            {TURN_SECONDS_CHOICES.map((s) => (
              <button
                key={s}
                className={`seg-btn ${turnSeconds === s ? 'active' : ''}`}
                onClick={() => setTurnSeconds(s)}
              >
                {s}초
              </button>
            ))}
          </div>
          <button className="btn" disabled={creating} onClick={() => void handleCreate()}>
            {creating ? '만드는 중…' : '+ 방 만들기'}
          </button>
        </div>

        {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>불러오는 중…</div>
          ) : rooms.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 24 }}>
              대기 중인 방이 없어. 먼저 만들어봐!
            </div>
          ) : rooms.map((room) => (
            <div key={room.id} className="raised" style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 'bold' }}>⚫ {room.host_nickname}의 대국</span>
                <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                  {seatCount(room)}/2명 · 한 수 {room.turn_seconds}초
                </div>
              </div>
              {isMine(room)
                ? <button className="btn btn-xs btn-lav" onClick={() => onJoin({ id: room.id, hostId: room.host_id, hostNickname: room.host_nickname })}>
                    들어가기
                  </button>
                : <button
                    className="btn btn-xs"
                    disabled={joining === room.id || seatCount(room) >= 2}
                    onClick={() => void handleJoin(room)}
                  >
                    {joining === room.id ? '…' : '참가'}
                  </button>
              }
            </div>
          ))}
        </div>

        <div ref={chatContainerRef} className="sunken" style={{ maxHeight: 100, overflowY: 'auto', padding: 4, fontSize: 11 }}>
          {chat.map((c, i) => (
            <div key={i} style={{ color: c.user_id === myUserId ? 'var(--magenta-d)' : 'var(--ink)' }}>
              <b>{c.nickname}</b>: {c.message}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="sunken" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSendChat(); }}
            placeholder="채팅…" style={{ flex: 1, fontSize: 12, padding: '3px 6px', background: 'var(--win-bg)', color: 'var(--ink)' }} />
          <button className="btn btn-xs" onClick={handleSendChat}>전송</button>
        </div>
        <button className="btn" onClick={onExit}>↩ 오목 첫화면으로</button>
      </div>
    </div>
  );
}
