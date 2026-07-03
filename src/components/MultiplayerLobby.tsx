import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CATEGORIES, DIFFICULTIES } from '../game/puzzle';
import type { Difficulty } from '../game/types';
import type { MpRoom } from '../game/multiplayer';

export interface JoinedRoom {
  id: string;
  category_key: string; category_label: string; category_prompt: string;
  difficulty: Difficulty;
  host_id: string; host_nickname: string;
}

interface Props {
  myUserId: string;
  myNickname: string;
  onJoin: (room: JoinedRoom) => void;
  onBack: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

export default function MultiplayerLobby({ myUserId, myNickname, onJoin, onBack }: Props) {
  const [rooms, setRooms] = useState<(MpRoom & { mp_members?: { user_id: string }[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [catKey, setCatKey] = useState(CATEGORIES[0].key);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [joining, setJoining] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    const { data } = await supabase
      .from('mp_rooms')
      .select('*, mp_members(user_id)')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setRooms(data as typeof rooms);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRooms();
    const t = window.setInterval(() => void loadRooms(), 5000);
    return () => window.clearInterval(t);
  }, [loadRooms]);

  async function handleCreate() {
    const cat = CATEGORIES.find(c => c.key === catKey) ?? CATEGORIES[0];
    setCreating(true); setError(null);
    try {
      const { data: roomId, error: err } = await rpc.rpc('mp_create_room', {
        p_category_key: cat.key, p_category_label: cat.label,
        p_category_prompt: cat.prompt, p_difficulty: difficulty, p_nickname: myNickname,
      });
      if (err || !roomId) throw err ?? new Error('방 생성 실패');
      onJoin({ id: roomId, category_key: cat.key, category_label: cat.label, category_prompt: cat.prompt, difficulty, host_id: myUserId, host_nickname: myNickname });
    } catch (e) { setError((e as Error)?.message ?? '방 생성 실패'); setCreating(false); }
  }

  async function handleDelete(roomId: string) {
    setDeleting(roomId); setError(null);
    try {
      await rpc.rpc('mp_delete_room', { p_room_id: roomId });
      await loadRooms();
    } catch (e) { setError((e as Error)?.message ?? '삭제 실패'); }
    setDeleting(null);
  }

  async function handleJoin(room: MpRoom) {
    setJoining(room.id); setError(null);
    try {
      const { data, error: err } = await rpc.rpc('mp_join_room', { p_room_id: room.id, p_nickname: myNickname });
      if (err || !data?.ok) throw new Error(data?.error ?? '참가 실패');
      onJoin({ id: room.id, category_key: room.category_key, category_label: room.category_label, category_prompt: room.category_prompt, difficulty: room.difficulty as Difficulty, host_id: room.host_id, host_nickname: room.host_nickname });
    } catch (e) { setError((e as Error)?.message ?? '참가 실패'); setJoining(null); }
  }

  return (
    <div className="body">
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        <div className="panel-title">
          <span>◆ 대합전 — 대기실</span>
          <button className="btn btn-xs" onClick={onBack}>← 돌아가기</button>
        </div>

        {showCreate ? (
          <div className="sunken" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 'bold' }}>방 개설 설정</div>
            <select
              value={catKey} onChange={e => setCatKey(e.target.value)}
              style={{ fontSize: 12, padding: '3px 4px', background: 'var(--win-bg)', color: 'var(--ink)', border: '1px solid var(--bevel-dk)', fontFamily: 'inherit' }}
            >
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
            </select>
            <div className="seg">
              {DIFFICULTIES.map(d => (
                <button key={d.key} className={`seg-btn ${difficulty === d.key ? 'active' : ''}`} onClick={() => setDifficulty(d.key as Difficulty)}>{d.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-xs" style={{ flex: 1 }} disabled={creating} onClick={() => void handleCreate()}>{creating ? '생성 중…' : '◆ 개설하기'}</button>
              <button className="btn btn-xs" onClick={() => setShowCreate(false)}>취소</button>
            </div>
          </div>
        ) : (
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowCreate(true)}>+ 방 개설하기</button>
        )}

        {error && <div style={{ fontSize: 11, color: '#c03060' }}>{error}</div>}

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>불러오는 중…</div>
        ) : rooms.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 24 }}>대기 중인 방이 없어. 먼저 개설해봐! ♡</div>
        ) : rooms.map(room => (
          <div key={room.id} className="raised" style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 'bold' }}>{CATEGORIES.find(c => c.key === room.category_key)?.emoji} {room.category_label}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-soft)', marginLeft: 6 }}>{room.difficulty}</span>
              <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                {room.host_nickname} · {room.mp_members?.length ?? '?'}/{room.max_players}명
              </div>
            </div>
            {room.host_id === myUserId
              ? <>
                  <button className="btn btn-xs btn-lav" disabled>내 방</button>
                  <button className="btn btn-xs btn-warn" disabled={deleting === room.id} onClick={() => void handleDelete(room.id)}>{deleting === room.id ? '…' : '삭제'}</button>
                </>
              : <button className="btn btn-xs" disabled={joining === room.id || (room.mp_members?.length ?? 0) >= room.max_players} onClick={() => void handleJoin(room)}>{joining === room.id ? '…' : '참가'}</button>
            }
          </div>
        ))}
      </div>
    </div>
  );
}
