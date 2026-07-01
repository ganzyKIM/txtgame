/**
 * Wikipedia API를 통한 정답 실존 검증.
 * 브라우저에서 직접 CORS 호출 가능(origin=*), 무료·무크레딧.
 * ko → en 순으로 시도. 둘 다 없으면 false(환각 판정).
 * 타임아웃·네트워크 실패 시 fail-open(true) — 검증 때문에 출제가 막히면 안 됨.
 */
const TIMEOUT_MS = 4500;

/**
 * 한 번에 여러 타이틀 변형을 파이프(|)로 묶어 조회.
 * 하나라도 문서가 존재하면 true.
 * Wikipedia API: titles=A|B|C, redirects=1
 */
async function queryWikiMulti(base: string, titles: string[]): Promise<boolean> {
  try {
    const joined = titles.map(encodeURIComponent).join('%7C'); // %7C = |
    const url = `${base}?action=query&titles=${joined}&format=json&origin=*&redirects=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return false;
    const data = await res.json() as { query?: { pages?: Record<string, object> } };
    const pages = data?.query?.pages ?? {};
    return Object.values(pages).some(p => !('missing' in p));
  } catch {
    return false;
  }
}

/**
 * AI가 생성한 제목은 위키 실제 표기와 부제 구분자가 다를 수 있다.
 * 예) "뉴 단간론파 V3 -모두의 살인 신학기-" → 실제: "뉴 단간론파 V3: 모두의 살인 신학기"
 *
 * 원본 + 변형 후보를 생성해 한 번에 조회하면 API 호출 수를 늘리지 않고 커버 가능.
 */
function titleVariants(title: string): string[] {
  const result = new Set<string>([title]);

  // " -부제-" → ": 부제"  (단간론파 V3 -모두의 살인 신학기-)
  const hyphen = title.replace(/\s*-([^-]+)-\s*$/, ': $1').trim();
  if (hyphen !== title) result.add(hyphen);

  // "～부제～" 또는 "~부제~"
  const tilde = title.replace(/[～~]([^～~]+)[～~]\s*$/, ': $1').trim();
  if (tilde !== title) result.add(tilde);

  // 부제 전체 제거 (콜론·하이픈·물결 앞 베이스 제목만)
  const base = title.split(/\s*[-:～~]\s/)[0].trim();
  if (base.length >= 2 && base !== title) result.add(base);

  return [...result];
}

export async function checkWikipedia(answer: string): Promise<boolean> {
  try {
    const variants = titleVariants(answer);
    // ko / en 각각 변형 전체를 한 번에 조회 — 추가 API 호출 없이 커버
    if (await queryWikiMulti('https://ko.wikipedia.org/w/api.php', variants)) return true;
    return await queryWikiMulti('https://en.wikipedia.org/w/api.php', variants);
  } catch {
    return true; // fail-open
  }
}
