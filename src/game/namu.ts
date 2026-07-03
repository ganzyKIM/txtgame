/**
 * 나무위키 프록시 클라이언트.
 * 나무위키는 CORS 미지원 → supabase Edge Function(namu-fetch)을 경유.
 *
 * 존재 확인: checkNamuWiki — Wikipedia 탈락 후 오타쿠 계열 보조 검증
 * 내용 fetch: fetchNamuContent — 힌트 생성 컨텍스트 주입용 (뱅크 재사용 경로)
 */
import { supabase } from '../lib/supabase';

interface NamuResult {
  exists: boolean;
  content?: string;
}

// supabase.functions.invoke 자체엔 타임아웃이 없다 — Edge Function이나 나무위키 원격
// 요청이 멈추면 이 호출이 영원히 안 끝나서 generatePuzzle 전체가 "무한 로딩"에 빠진다.
// 클라이언트 쪽에서 강제로 끊어서 fail-closed(exists:false)로 폴백시킨다.
const TIMEOUT_MS = 6000;

async function callNamuFetch(title: string): Promise<NamuResult> {
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke('namu-fetch', { body: { title } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('namu-fetch timeout')), TIMEOUT_MS)),
    ]);
    if (error || !data) return { exists: false };
    return data as NamuResult;
  } catch {
    return { exists: false };
  }
}

/** 나무위키에 해당 제목의 문서가 존재하는지 확인. fail-open(true 아님)이므로 false = 없음. */
export async function checkNamuWiki(answer: string): Promise<boolean> {
  const r = await callNamuFetch(answer);
  return r.exists;
}

/**
 * 나무위키 문서 앞부분(최대 2500자)을 가져온다.
 * 없거나 실패 시 null 반환 — 호출부는 null을 gracefully 처리해야 한다.
 */
export async function fetchNamuContent(answer: string): Promise<string | null> {
  const r = await callNamuFetch(answer);
  return r.exists ? (r.content ?? null) : null;
}
