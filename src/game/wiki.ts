/**
 * Wikipedia API를 통한 정답 실존 검증.
 * 브라우저에서 직접 CORS 호출 가능(origin=*), 무료·무크레딧.
 * ko → en 순으로 시도. 둘 다 없으면 false(환각 판정).
 * 타임아웃·네트워크 실패 시 fail-open(true) — 검증 때문에 출제가 막히면 안 됨.
 */
const TIMEOUT_MS = 4500;

async function queryWiki(base: string, title: string): Promise<boolean> {
  try {
    const url = `${base}?action=query&titles=${encodeURIComponent(title)}&format=json&origin=*&redirects=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return false;
    const data = await res.json() as { query?: { pages?: Record<string, object> } };
    const pages = data?.query?.pages ?? {};
    return Object.values(pages).some(p => !('missing' in p));
  } catch {
    return false;
  }
}

export async function checkWikipedia(answer: string): Promise<boolean> {
  try {
    if (await queryWiki('https://ko.wikipedia.org/w/api.php', answer)) return true;
    return await queryWiki('https://en.wikipedia.org/w/api.php', answer);
  } catch {
    return true; // fail-open
  }
}
