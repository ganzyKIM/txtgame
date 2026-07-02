import { useEffect, useRef, useState, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { MpMember, RoomStatus } from '../game/multiplayer';
import { MP_HINT_INTERVAL_MS, MP_LAST_HINT_GRACE_MS } from '../game/multiplayer';

export interface ChatEntry  { user_id: string; nickname: string; message: string; ts: number }
export interface ScoreEntry { user_id: string; nickname: string; score: number; rounds_won: number }

export interface RoundView {
  roundNum: number;
  hints: string[];
  maxHints: number;
  startedAt: Date;
  revealedCount: number;
  gaveUpIds: string[];
  ended: boolean;
  winnerId: string | null;
  winnerNickname: string | null;
  answer: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase as any;

export function useMultiplayerRoom(roomId: string, myUserId: string) {
  const channelRef  = useRef<RealtimeChannel | null>(null);
  const isHostRef   = useRef(false);
  const membersRef  = useRef<MpMember[]>([]);
  const roundRef    = useRef<RoundView | null>(null);
  const gaveUpRef   = useRef<string[]>([]);
  const timerRef    = useRef<number | null>(null);

  const [roomStatus,  setRoomStatus]  = useState<RoomStatus>('waiting');
  const [members,     setMembers]     = useState<MpMember[]>([]);
  const [round,       setRound]       = useState<RoundView | null>(null);
  const [chat,        setChat]        = useState<ChatEntry[]>([]);
  const [finalScores, setFinalScores] = useState<ScoreEntry[] | null>(null);

  // ref mirrors for timer callbacks (no stale closures)
  useEffect(() => { membersRef.current = members; }, [members]);
  useEffect(() => { roundRef.current = round; }, [round]);
  useEffect(() => {
    isHostRef.current = members.find(m => m.user_id === myUserId)?.is_host ?? false;
  }, [members, myUserId]);

  // ── 멤버 목록 DB 로드 ────────────────────────────────────────
  const loadMembers = useCallback(async () => {
    const { data } = await supabase
      .from('mp_members')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at');
    if (data) setMembers(data as MpMember[]);
  }, [roomId]);

  // ── 힌트 어드밴스 (호스트 전용) ────────────────────────────
  const doAdvanceHint = useCallback(() => {
    const r = roundRef.current;
    if (!r || r.ended) return;
    const next = r.revealedCount + 1;
    gaveUpRef.current = [];
    channelRef.current?.send({ type: 'broadcast', event: 'hint_advance', payload: { hint_index: next } });
  }, []);

  // ── 노위너 라운드 종료 (호스트 전용) ────────────────────────
  const doEndRoundNoWinner = useCallback(async () => {
    const r = roundRef.current;
    if (!r || r.ended) return;
    const { data: answer } = await rpc.rpc('mp_end_round', { p_room_id: roomId, p_round_num: r.roundNum });
    const scores = membersRef.current.map(m => ({ user_id: m.user_id, nickname: m.nickname, score: m.score, rounds_won: m.rounds_won }));
    channelRef.current?.send({ type: 'broadcast', event: 'round_end', payload: { round_num: r.roundNum, winner_id: null, winner_nickname: null, answer: answer ?? '?', scores } });
  }, [roomId]);

  // ── 힌트 타이머 (호스트만 구동) ─────────────────────────────
  function scheduleHintTimer() {
    const r = roundRef.current;
    if (!isHostRef.current || !r || r.ended) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);

    if (r.revealedCount >= r.maxHints) {
      // 마지막 힌트 공개됨 → 전원 포기 대기 grace timer
      timerRef.current = window.setTimeout(() => doEndRoundNoWinner(), MP_LAST_HINT_GRACE_MS);
      return;
    }
    const nextRevealAt = r.startedAt.getTime() + r.revealedCount * MP_HINT_INTERVAL_MS;
    const delay = Math.max(200, nextRevealAt - Date.now());
    timerRef.current = window.setTimeout(() => doAdvanceHint(), delay);
  }

  // ── Realtime 채널 구독 ───────────────────────────────────────
  useEffect(() => {
    loadMembers();

    const ch = supabase.channel(`mp:${roomId}`, {
      config: { broadcast: { self: true } },
    });
    channelRef.current = ch;

    ch
      // 게임 시작
      .on('broadcast', { event: 'game_start' }, () => setRoomStatus('playing'))

      // 라운드 시작
      .on('broadcast', { event: 'round_start' }, ({ payload }) => {
        const r: RoundView = {
          roundNum: payload.round_num,
          hints: payload.hints,
          maxHints: payload.max_hints,
          startedAt: new Date(payload.started_at),
          revealedCount: 1,
          gaveUpIds: [],
          ended: false,
          winnerId: null,
          winnerNickname: null,
          answer: null,
        };
        gaveUpRef.current = [];
        setRound(r);
        roundRef.current = r;
        if (timerRef.current) window.clearTimeout(timerRef.current);
        scheduleHintTimer();
      })

      // 힌트 어드밴스 (전원 포기 혹은 타이머)
      .on('broadcast', { event: 'hint_advance' }, ({ payload }) => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        gaveUpRef.current = [];
        if (roundRef.current && !roundRef.current.ended) {
          roundRef.current = { ...roundRef.current, revealedCount: payload.hint_index, gaveUpIds: [] };
        }
        setRound(prev => {
          if (!prev || prev.ended) return prev;
          return { ...prev, revealedCount: payload.hint_index, gaveUpIds: [] };
        });
        scheduleHintTimer();
      })

      // 포기
      .on('broadcast', { event: 'gave_up' }, ({ payload }) => {
        gaveUpRef.current = [...new Set([...gaveUpRef.current, payload.user_id])];
        setRound(prev => prev ? { ...prev, gaveUpIds: gaveUpRef.current } : null);

        if (isHostRef.current && gaveUpRef.current.length >= membersRef.current.length) {
          const r = roundRef.current;
          if (!r || r.ended) return;
          if (timerRef.current) window.clearTimeout(timerRef.current);
          if (r.revealedCount < r.maxHints) {
            doAdvanceHint();
          } else {
            void doEndRoundNoWinner();
          }
        }
      })

      // 라운드 종료
      .on('broadcast', { event: 'round_end' }, ({ payload }) => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        setRound(prev => prev ? { ...prev, ended: true, winnerId: payload.winner_id, winnerNickname: payload.winner_nickname, answer: payload.answer } : null);
        if (payload.scores) setMembers(prev => prev.map(m => { const s = payload.scores.find((e: ScoreEntry) => e.user_id === m.user_id); return s ? { ...m, score: s.score, rounds_won: s.rounds_won } : m; }));
      })

      // 게임 종료
      .on('broadcast', { event: 'game_end' }, ({ payload }) => {
        setFinalScores(payload.scores);
        setRoomStatus('finished');
      })

      // 채팅
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        setChat(prev => [...prev, payload as ChatEntry].slice(-100));
      })

      // DB 변경: 멤버 목록 갱신
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_members', filter: `room_id=eq.${roomId}` }, () => { void loadMembers(); })

      .subscribe();

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void supabase.removeChannel(ch);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── 공개 액션 ────────────────────────────────────────────────
  const startGame = useCallback(async () => {
    await rpc.rpc('mp_start_game', { p_room_id: roomId });
    channelRef.current?.send({ type: 'broadcast', event: 'game_start', payload: {} });
  }, [roomId]);

  const startRound = useCallback(async (roundNum: number, hints: string[], maxHints: number, answer: string, acceptable: string[]) => {
    await rpc.rpc('mp_submit_round', { p_room_id: roomId, p_round_num: roundNum, p_hints: hints, p_max_hints: maxHints, p_answer: answer, p_acceptable: acceptable });
    const started_at = new Date().toISOString();
    channelRef.current?.send({ type: 'broadcast', event: 'round_start', payload: { round_num: roundNum, hints, max_hints: maxHints, started_at } });
  }, [roomId]);

  const giveUp = useCallback(() => {
    const r = roundRef.current;
    if (!r || r.ended) return;
    channelRef.current?.send({ type: 'broadcast', event: 'gave_up', payload: { user_id: myUserId, nickname: members.find(m => m.user_id === myUserId)?.nickname ?? '' } });
  }, [myUserId, members]);

  const submitGuess = useCallback(async (guess: string, hintsUsed: number) => {
    const r = roundRef.current;
    if (!r || r.ended) return { correct: false };
    const { data } = await rpc.rpc('mp_submit_guess', { p_room_id: roomId, p_round_num: r.roundNum, p_guess: guess, p_hints_used: hintsUsed });
    if (data?.correct) {
      // 승자: 최신 멤버 점수 로드 후 round_end 브로드캐스트
      const { data: freshMembers } = await supabase.from('mp_members').select('*').eq('room_id', roomId);
      const scores = (freshMembers ?? membersRef.current).map((m: MpMember) => ({ user_id: m.user_id, nickname: m.nickname, score: m.score, rounds_won: m.rounds_won }));
      channelRef.current?.send({ type: 'broadcast', event: 'round_end', payload: { round_num: r.roundNum, winner_id: myUserId, winner_nickname: members.find(m => m.user_id === myUserId)?.nickname ?? '', answer: data.answer, scores } });
    }
    return { correct: !!data?.correct, answer: data?.answer };
  }, [roomId, myUserId, members]);

  const sendChat = useCallback(async (message: string) => {
    const nick = members.find(m => m.user_id === myUserId)?.nickname ?? '';
    channelRef.current?.send({ type: 'broadcast', event: 'chat', payload: { user_id: myUserId, nickname: nick, message, ts: Date.now() } });
    await rpc.rpc('mp_send_chat', { p_room_id: roomId, p_message: message });
  }, [roomId, myUserId, members]);

  const finishGame = useCallback(async () => {
    await rpc.rpc('mp_finish_game', { p_room_id: roomId });
    const scores = membersRef.current.map(m => ({ user_id: m.user_id, nickname: m.nickname, score: m.score, rounds_won: m.rounds_won }));
    channelRef.current?.send({ type: 'broadcast', event: 'game_end', payload: { scores } });
  }, [roomId]);

  return {
    roomStatus, members, round, chat, finalScores,
    isHost: isHostRef.current,
    startGame, startRound, giveUp, submitGuess, sendChat, finishGame,
  };
}
