import type { Difficulty } from './types';

export const MP_TOTAL_ROUNDS = 10;
export const MP_HINT_INTERVAL_MS = 7000;
export const MP_LAST_HINT_GRACE_MS = 15000; // 마지막 힌트 후 전원 포기 대기

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface MpRoom {
  id: string;
  host_id: string;
  host_nickname: string;
  status: RoomStatus;
  category_key: string;
  category_label: string;
  category_prompt: string;
  difficulty: Difficulty;
  max_players: number;
  current_round: number;
  total_rounds: number;
  created_at: string;
  started_at: string | null;
  member_count?: number; // 조회 시 JOIN
}

export interface MpMember {
  room_id: string;
  user_id: string;
  nickname: string;
  is_host: boolean;
  score: number;
  rounds_won: number;
  left_at: string | null;
}

/** Supabase Realtime Broadcast 이벤트 타입 */
export type BroadcastEvent =
  | { type: 'round_start';  payload: RoundStartPayload }
  | { type: 'hint_advance'; payload: HintAdvancePayload }
  | { type: 'gave_up';      payload: GaveUpPayload }
  | { type: 'round_end';    payload: RoundEndPayload }
  | { type: 'game_end';     payload: GameEndPayload }
  | { type: 'chat';         payload: ChatPayload }
  | { type: 'game_start';   payload: Record<string, never> };

export interface RoundStartPayload {
  round_num: number;
  hints: string[];      // 전체 힌트 (정답 미포함)
  max_hints: number;
  started_at: string;   // ISO timestamp — 클라이언트 타이머 기준점
}

export interface HintAdvancePayload {
  hint_index: number;   // 이제 몇 번째 힌트까지 공개
}

export interface GaveUpPayload {
  user_id: string;
  nickname: string;
}

export interface RoundEndPayload {
  round_num: number;
  winner_id: string | null;
  winner_nickname: string | null;
  answer: string;
  scores: { user_id: string; nickname: string; score: number; rounds_won: number }[];
}

export interface GameEndPayload {
  scores: { user_id: string; nickname: string; score: number; rounds_won: number }[];
}

export interface ChatPayload {
  user_id: string;
  nickname: string;
  message: string;
  ts: number;
}

/** 라운드 중 클라이언트 상태 */
export interface RoundState {
  round_num: number;
  hints: string[];
  max_hints: number;
  started_at: Date;
  revealed_count: number;   // 현재 공개된 힌트 수
  gave_up_ids: Set<string>; // 이번 힌트 구간에서 포기한 유저 목록
  ended: boolean;
  winner_id: string | null;
  winner_nickname: string | null;
  answer: string | null;    // 라운드 종료 후 공개
}
