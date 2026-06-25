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

/**
 * 서버 프록시를 통한 텍스트 생성.
 * 클라이언트는 모델 tier와 메시지만 보내고, 실제 Gemini 호출/키/차감은 서버가 한다.
 */
export async function proxyGenerateText(
  tier: TextTier,
  messages: ChatMessage[],
  opts: { system?: string; temperature?: number } = {},
): Promise<TextResult> {
  const { data, error } = await supabase.functions.invoke('generate-text', {
    body: { tier, messages, system: opts.system, temperature: opts.temperature },
  });
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
