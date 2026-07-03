import { supabase } from '../lib/supabase';
import type { TextTier } from '../types';

/** Gemini contents 한 줄 (user/model 교대) */
export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/** Edge Function 오류 응답에서 사람이 읽을 메시지를 추출 */
async function readError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    } catch {
      /* 본문 파싱 실패는 무시 */
    }
  }
  return (error as Error)?.message ?? '알 수 없는 오류가 발생했습니다.';
}

export interface TextResult {
  text: string;
  /** 차감 후 남은 크레딧 잔액 */
  balance: number;
}

// supabase.functions.invoke는 자체 타임아웃이 없다 — Edge Function이나 Gemini 응답이
// 멈추면 이 호출이 영원히 안 끝나서 출제(generatePuzzle)가 "무한 로딩"에 빠진다.
// 클라이언트 쪽에서 강제로 끊어 에러로 던지면, 호출부의 기존 try/catch가
// "출제 실패, 다시 시도해줘" 흐름으로 정상 복구한다.
const TEXT_TIMEOUT_MS = 45000;

/**
 * 서버 프록시를 통한 텍스트 생성.
 * 클라이언트는 모델 tier와 메시지만 보내고, 실제 Gemini 호출/키/차감은 서버가 한다.
 */
export async function proxyGenerateText(
  tier: TextTier,
  messages: ChatMessage[],
  opts: { system?: string; temperature?: number } = {},
): Promise<TextResult> {
  const { data, error } = await Promise.race([
    supabase.functions.invoke('generate-text', {
      body: { tier, messages, system: opts.system, temperature: opts.temperature },
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('응답이 너무 오래 걸려서 중단했어. 다시 시도해줘.')), TEXT_TIMEOUT_MS)),
  ]);
  if (error) throw new Error(await readError(error));
  if (data?.error) throw new Error(data.error);
  return { text: data.text, balance: data.balance };
}

export interface ImageResult {
  /** base64 PNG (data: 접두사 제외) */
  image: string;
  balance: number;
}

/** 서버 프록시를 통한 이미지 생성 */
export async function proxyGenerateImage(prompt: string): Promise<ImageResult> {
  const { data, error } = await supabase.functions.invoke('generate-image', {
    body: { prompt },
  });
  if (error) throw new Error(await readError(error));
  if (data?.error) throw new Error(data.error);
  return { image: data.image, balance: data.balance };
}
