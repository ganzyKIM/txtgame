import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { MascotHandle } from './Mascot';

export interface PokerRoomRow {
  id: string;
  host_id: string;
  host_nickname: string;
  status: string;
  max_players: number;
  poker_members?: { seat_index: number; left_at: string | null; user_id: string | null }[];
}

export interface JoinedPokerRoom {
  id: string;
  hostId: string;
  hostNickname: string;
}

interface LobbyChatEntry { user_id: string; nickname: string; message: string; ts: number }

interface Props {
  myUserId: string;
  myNickname: string;
  mascot: RefObject<MascotHandle | null>;
  onJoin: (room: JoinedPokerRoom) => void;
  onExit: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

export default function HoldemLobby({ myUserId, myNickname, mascot, onJoin, onExit }: Props) {
  // 카지노 테마 화면이라 떠다니는 마스코트는 치운다(홀덤 싱글과 동일 패턴)
  useEffect(() => {
    const m = mascot.current;
    m?.banish();
    return () => { m?.summon(); };
  }, [mascot]);

  const [rooms, setRooms] = useState<PokerRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chat, setChat] = useState<LobbyChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const ch = supabase.channel('poker:lobby', { config: { broadcast: { self: true } } });
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
      .from('poker_rooms')
      .select('*, poker_members(seat_index, left_at, user_id)')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setRooms(data as PokerRoomRow[]);
    setLoading(false);
  }, []);

  /** 내가 이미 이 방의 활성 좌석에 앉아있는지(호스트 포함) — 새로고침 후 재입장 판단용 */
  function isMine(room: PokerRoomRow): boolean {
    return room.poker_members?.some((m) => !m.left_at && m.user_id === myUserId) ?? false;
  }

  useEffect(() => {
    void loadRooms();
    const t = window.setInterval(() => void loadRooms(), 5000);
    return () => window.clearInterval(t);
  }, [loadRooms]);

  function seatCount(room: PokerRoomRow): number {
    return room.poker_members?.filter((m) => !m.left_at).length ?? 0;
  }

  /** 방 만들기/참가 전에 항상 먼저 칩을 구매해서 스택을 만든다(싱글과 동일한 RPC) */
  async function buyChips(): Promise<number> {
    const { data, error: err } = await rpc.rpc('poker_buy_in');
    if (err || !data?.ok) throw new Error(data?.error ?? err?.message ?? '칩 구매 실패');
    return data.chips as number;
  }

  async function handleCreate() {
    setCreating(true); setError(null);
    try {
      const chips = await buyChips();
      const { data: roomId, error: err } = await rpc.rpc('poker_create_room', { p_nickname: myNickname, p_stack: chips });
      if (err || !roomId) throw err ?? new Error('방 생성 실패');
      onJoin({ id: roomId, hostId: myUserId, hostNickname: myNickname });
    } catch (e) { setError((e as Error)?.message ?? '방 생성 실패'); setCreating(false); }
  }

  async function handleJoin(room: PokerRoomRow) {
    setJoining(room.id); setError(null);
    try {
      const chips = await buyChips();
      const { data, error: err } = await rpc.rpc('poker_join_room', { p_room_id: room.id, p_nickname: myNickname, p_stack: chips });
      if (err || !data?.ok) throw new Error(data?.error ?? '참가 실패');
      onJoin({ id: room.id, hostId: room.host_id, hostNickname: room.host_nickname });
    } catch (e) { setError((e as Error)?.message ?? '참가 실패'); setJoining(null); }
  }

  /** 이미 앉아있던 방으로 돌아가기 — 새로고침/재접속 시. 칩을 또 사지 않는다(RPC조차 안 부름) */
  function handleRejoin(room: PokerRoomRow) {
    onJoin({ id: room.id, hostId: room.host_id, hostNickname: room.host_nickname });
  }

  return (
    <div className="body">
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div className="panel-title">
          <span>◆ 텍사스 홀덤 — 멀티 대기실</span>
        </div>

        <div className="soup-rules" style={{ fontSize: 11, margin: 0 }}>
          방을 만들거나 참가하면 <b>칩 구매(크레딧 소모)</b>가 먼저 진행돼. 최대 4인, 빈 자리는 방장이 초텐쨩·아메로 채울 수 있어.
        </div>

        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={creating} onClick={() => void handleCreate()}>
          {creating ? '준비 중…' : '+ 방 만들기'}
        </button>

        {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>불러오는 중…</div>
          ) : rooms.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 24 }}>대기 중인 방이 없어. 먼저 만들어봐!</div>
          ) : rooms.map((room) => (
            <div key={room.id} className="raised" style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 'bold' }}>🃏 {room.host_nickname}의 테이블</span>
                <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{seatCount(room)}/{room.max_players}석</div>
              </div>
              {isMine(room)
                ? <button className="btn btn-xs btn-lav" onClick={() => handleRejoin(room)}>들어가기</button>
                : <button className="btn btn-xs" disabled={joining === room.id || seatCount(room) >= room.max_players} onClick={() => void handleJoin(room)}>
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
        <button className="btn" onClick={onExit}>↩ 카테고리로</button>
      </div>
    </div>
  );
}
