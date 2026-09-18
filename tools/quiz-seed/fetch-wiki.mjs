/**
 * 퀴즈 시드 2단계: 후보 정답의 위키 실존 확인 + 근거 본문 수집.
 *
 * 후보 JSON(1단계 산출물)을 읽어:
 *   ① 카테고리 내 중복 제거 (normAnswerKey/baseName — 쉬움>보통>어려움 순으로 먼저 온 것 유지)
 *   ② ko→en→ja 위키백과(고사성어는 ko.위키낱말사전 우선)에서 문서 실존 확인
 *   ③ 문서 도입부(근거 본문)를 함께 저장 — 이후 힌트 작성·검증이 전부 이 본문 기준
 *   ④ 동음이의 문서는 미스로 처리 (엉뚱한 대상에 근거하는 사고 방지)
 * 문서를 못 찾은 후보는 시드에서 탈락한다 (fail-closed — 게임 런타임의 fail-open과 반대).
 *
 * 사용: node tools/quiz-seed/fetch-wiki.mjs --in <candidatesDir> --out <groundedDir>
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'txtgame-quiz-seed/1.0 (offline batch seeding tool; https://github.com/ganzyKIM/txtgame)';
const CONCURRENCY = 5;
const EXCHARS = 1200;
const jitter = () => new Promise(r => setTimeout(r, 80 + Math.random() * 180));

// ── src/game/answerBank.ts · puzzle.ts 포팅 (시드 파이프라인은 브라우저 밖이라 재구현) ──
export function normAnswerKey(s) {
  return s.toLowerCase().replace(/[\s·~!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`'""“”（）【】]/g, '').trim();
}
export function baseName(answer) {
  return answer.replace(/\s*[(（【[][^)）】\]]*[)）】\]]\s*$/, '').trim();
}
function titleVariants(title) {
  const result = new Set([title]);
  const hyphen = title.replace(/\s*-([^-]+)-\s*$/, ': $1').trim();
  if (hyphen !== title) result.add(hyphen);
  const tilde = title.replace(/[～~]([^～~]+)[～~]\s*$/, ': $1').trim();
  if (tilde !== title) result.add(tilde);
  const base = title.split(/\s*[-:～~]\s/)[0].trim();
  if (base.length >= 2 && base !== title) result.add(base);
  return [...result];
}

// ── MediaWiki API ──────────────────────────────────────────────────
async function apiQuery(base, titles, { intro }) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|pageprops',
    ppprop: 'disambiguation',
    explaintext: '1',
    exchars: String(EXCHARS),
    exlimit: 'max',
    redirects: '1',
    format: 'json',
    titles: titles.join('|'),
  });
  if (intro) params.set('exintro', '1');
  const url = `${base}?${params}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await jitter();
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { // 레이트리밋은 200 + 텍스트 본문으로 오기도 한다
        if (/too many requests/i.test(text)) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
        throw new Error('non-JSON response');
      }
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw new Error('rate-limited after retries');
}

// ── 속담 전용: 위키낱말사전 분류(한국어 속담 500+ / 한국어 한자성어 573)를
//    전량 로드해 결정론 대조. normKey → 정식 표제어.
let PROVERB_MAP_PROMISE = null;
async function loadCategoryMembers(cmtitle) {
  const map = new Map();
  let cont = null;
  do {
    const p = new URLSearchParams({ action: 'query', list: 'categorymembers', cmtitle, cmlimit: '500', cmnamespace: '0', format: 'json' });
    if (cont) p.set('cmcontinue', cont);
    const res = await fetch(`https://ko.wiktionary.org/w/api.php?${p}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    for (const m of data?.query?.categorymembers ?? []) {
      const k = normAnswerKey(m.title);
      if (k) map.set(k, m.title);
    }
    cont = data?.continue?.cmcontinue ?? null;
    await new Promise(r => setTimeout(r, 300));
  } while (cont);
  return map;
}
function loadProverbMap() {
  if (!PROVERB_MAP_PROMISE) {
    PROVERB_MAP_PROMISE = (async () => {
      const [sokdam, seongeo] = await Promise.all([
        loadCategoryMembers('분류:한국어 속담'),
        loadCategoryMembers('분류:한국어 한자성어'),
      ]);
      const merged = new Map([...sokdam, ...seongeo]);
      console.log(`  (위키낱말사전 분류 로드: 속담 ${sokdam.size} + 한자성어 ${seongeo.size})`);
      return merged;
    })();
  }
  return PROVERB_MAP_PROMISE;
}

/**
 * 한 사이트에서 타이틀 후보들을 조회해 "실제 문서 + 도입부"를 찾는다.
 * 동음이의 문서와 빈 추출은 미스로 취급.
 * 반환: { title, extract } | null
 */
async function lookupOn(base, titles, { intro }) {
  const uniq = [...new Set(titles.filter(t => t && t.length >= 1))].slice(0, 15);
  if (uniq.length === 0) return null;
  const data = await apiQuery(base, uniq, { intro });
  const pages = Object.values(data?.query?.pages ?? {});
  // 정규화된 요청 순서를 보존하기 위해 요청 타이틀 우선순위로 정렬
  const rank = (t) => { const i = uniq.findIndex(u => u === t); return i === -1 ? 99 : i; };
  const hits = pages
    .filter(p => !('missing' in p) && !('invalid' in p))
    .filter(p => !(p.pageprops && 'disambiguation' in p.pageprops))
    .filter(p => (p.extract ?? '').trim().length >= 40)
    .filter(p => !/동음이의|다음을 가리킨다|曖昧さ回避|may refer to/i.test((p.extract ?? '').slice(0, 200)))
    .sort((a, b) => rank(a.title) - rank(b.title));
  if (hits.length === 0) return null;
  return { title: hits[0].title, extract: hits[0].extract.trim() };
}

/** 컷오프 있는 레벤슈타인 — maxD 초과가 확정되면 조기 반환 */
function editDistance(a, b, maxD) {
  if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxD) return maxD + 1;
    prev = cur;
  }
  return prev[b.length];
}

const SITES = {
  wikiKo: { base: 'https://ko.wikipedia.org/w/api.php', lang: 'ko', site: 'wikipedia', intro: true },
  wikiEn: { base: 'https://en.wikipedia.org/w/api.php', lang: 'en', site: 'wikipedia', intro: true },
  wikiJa: { base: 'https://ja.wikipedia.org/w/api.php', lang: 'ja', site: 'wikipedia', intro: true },
  // 위키낱말사전은 도입부가 비어 있는 경우가 많아 exintro 없이 본문 앞부분을 쓴다
  wiktKo: { base: 'https://ko.wiktionary.org/w/api.php', lang: 'ko', site: 'wiktionary', intro: false },
  // 사자성어 전용: 한국어 위키 계열은 개별 문서 커버리지가 낮지만
  // (화룡점정·온고지신·형설지공 등 유명 성어조차 문서가 없다), 한자문화권 공통이라
  // 한자 표기로 일본어·중국어 위키낱말사전을 찾으면 뜻풀이까지 나온다.
  wiktJa: { base: 'https://ja.wiktionary.org/w/api.php', lang: 'ja', site: 'wiktionary', intro: false },
  wiktZh: { base: 'https://zh.wiktionary.org/w/api.php', lang: 'zh', site: 'wiktionary', intro: false },
  wikiJa2: { base: 'https://ja.wikipedia.org/w/api.php', lang: 'ja', site: 'wikipedia', intro: true },
};

/** 한자만 뽑아낸다 (사자성어 한자 표기 후보 추출용) */
function hanjaForms(cand) {
  const out = new Set();
  const pool = [cand.answer, ...(Array.isArray(cand.acceptable) ? cand.acceptable : []), cand.wikiTitleJa ?? '', cand.note ?? ''];
  for (const s of pool) {
    if (!s) continue;
    // 괄호 안팎 어디에 있든 연속된 한자 덩어리를 모은다
    for (const m of String(s).matchAll(/[一-鿿]{2,}/g)) out.add(m[0]);
  }
  return [...out];
}

/** 후보 하나를 사이트 우선순위대로 조회. 근거를 찾으면 즉시 반환. */
export async function groundOne(cand, categoryKey) {
  return ground(cand, categoryKey);
}

async function ground(cand, categoryKey) {
  const koTitles = [cand.answer, cand.wikiTitle, ...titleVariants(cand.answer), baseName(cand.answer)];
  // acceptable 중 한글 표기는 ko 조회에, 로마자/일본어 표기는 en/ja 조회에 활용
  const acc = Array.isArray(cand.acceptable) ? cand.acceptable : [];
  const koAcc = acc.filter(a => /[가-힣]/.test(a));
  const enTitles = [cand.wikiTitleEn, ...acc.filter(a => /^[\x20-\x7e]+$/.test(a))];
  const jaTitles = [cand.wikiTitleJa, ...acc.filter(a => /[ぁ-んァ-ヶ一-龯]/.test(a))];

  const order = categoryKey === 'proverb'
    ? [['wiktKo', [...koTitles, ...koAcc]], ['wikiKo', [...koTitles, ...koAcc]]]
    : [['wikiKo', [...koTitles, ...koAcc]], ['wikiEn', enTitles], ['wikiJa', jaTitles], ['wiktKo', koTitles]];

  // 속담: 위키낱말사전 분류 대조를 최우선 — 정식 표제어를 찾아 그 항목의 뜻풀이를 근거로 쓴다.
  // 매칭되면 사전 표제어를 정답(answerOverride)으로 승격 — 조사·띄어쓰기 변형은 acceptable로 흡수.
  if (categoryKey === 'proverb') {
    try {
      const map = await loadProverbMap();
      let title = null;
      for (const t of [cand.answer, ...koTitles, ...(Array.isArray(cand.acceptable) ? cand.acceptable : [])]) {
        title = map.get(normAnswerKey(t ?? ''));
        if (title) break;
      }
      // 긴 속담 한정 퍼지 매칭 (조사 하나 차이 등) — 4자 성어엔 위험해서 미적용
      if (!title) {
        const key = normAnswerKey(cand.answer);
        if (key.length >= 8) {
          let best = null, bestD = 3;
          for (const [k, t] of map) {
            if (Math.abs(k.length - key.length) > 2) continue;
            const d = editDistance(key, k, 2);
            if (d < bestD) { bestD = d; best = t; }
          }
          title = best;
        }
      }
      if (title) {
        let hit = null;
        try { hit = await lookupOn(SITES.wiktKo.base, [title], { intro: false }); } catch { /* 폴백 */ }
        const base = hit
          ? { ...hit, title, lang: 'ko', site: 'wiktionary' }
          : { title, extract: `위키낱말사전 '한국어 속담/한자성어' 분류에 등재된 표현: "${title}"`, lang: 'ko', site: 'wiktionary-category' };
        return { ...base, answerOverride: title };
      }

      // 분류에 없는 사자성어: 한자 표기로 일본어·중국어 위키낱말사전 조회.
      // 한국어 위키 계열 커버리지가 낮아 이 폴백이 없으면 유명 성어가 대량 탈락한다.
      const hanja = hanjaForms(cand);
      if (hanja.length > 0) {
        for (const key of ['wiktJa', 'wiktZh', 'wikiJa2']) {
          const s = SITES[key];
          try {
            const hit = await lookupOn(s.base, hanja, { intro: s.intro });
            if (hit) return { ...hit, lang: s.lang, site: s.site };
          } catch { /* 다음 사이트 */ }
        }
      }
    } catch { /* 분류 로드 실패 시 아래 일반 경로로 */ }
  }

  for (const [siteKey, titles] of order) {
    const s = SITES[siteKey];
    try {
      const hit = await lookupOn(s.base, titles, { intro: s.intro });
      if (hit) return { ...hit, lang: s.lang, site: s.site };
    } catch { /* 다음 사이트로 */ }
  }
  return null;
}

// ── 메인 ───────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { inDir: get('--in'), outDir: get('--out'), only: get('--only', '') };
}

async function main() {
  const { inDir, outDir, only } = parseArgs();
  if (!inDir || !outDir) { console.error('usage: --in <dir> --out <dir> [--only cat1,cat2]'); process.exit(1); }
  mkdirSync(outDir, { recursive: true });

  const DIFF_ORDER = { easy: 0, normal: 1, hard: 2 };
  const files = readdirSync(inDir).filter(f => f.endsWith('.json'));
  const byCat = new Map();
  for (const f of files) {
    const m = f.match(/^(.+)_(easy|normal|hard)_([A-Za-z0-9]+)\.json$/);
    if (!m) continue;
    const [, cat, diff] = m;
    if (only && !only.split(',').includes(cat)) continue;
    let arr;
    try { arr = JSON.parse(readFileSync(join(inDir, f), 'utf8')); }
    catch (e) { console.error(`! ${f} 파싱 실패: ${e.message}`); continue; }
    if (!byCat.has(cat)) byCat.set(cat, []);
    for (const c of arr) {
      if (!c || typeof c.answer !== 'string' || !c.answer.trim()) continue;
      byCat.get(cat).push({ ...c, answer: c.answer.trim(), difficulty: diff });
    }
  }

  const report = {};
  for (const [cat, list] of byCat) {
    // ① 중복 제거 — 쉬움 우선 유지 (유명한 것은 쉬움에 속하는 게 맞다)
    list.sort((x, y) => DIFF_ORDER[x.difficulty] - DIFF_ORDER[y.difficulty]);
    const seen = new Set();
    const uniq = [];
    let dupDropped = 0;
    for (const c of list) {
      const keys = [normAnswerKey(c.answer), normAnswerKey(baseName(c.answer))].filter(Boolean);
      if (keys.some(k => seen.has(k))) { dupDropped++; continue; }
      keys.forEach(k => seen.add(k));
      uniq.push(c);
    }

    // ② 실존 확인 + 근거 수집 (동시 CONCURRENCY개)
    const grounded = [];
    const dropped = [];
    let i = 0;
    async function worker() {
      while (i < uniq.length) {
        const c = uniq[i++];
        const g = await ground(c, cat).catch(() => null);
        if (g) {
          const useOverride = g.answerOverride && g.answerOverride !== c.answer;
          const answer = useOverride ? g.answerOverride : c.answer;
          const acceptable = [...new Set([...(c.acceptable ?? []), ...(useOverride ? [c.answer] : [])])].filter(a => a !== answer);
          grounded.push({ categoryKey: cat, difficulty: c.difficulty, answer, acceptable, note: c.note ?? '', sourceTitle: g.title, sourceSite: g.site, sourceLang: g.lang, extract: g.extract });
        } else dropped.push({ answer: c.answer, difficulty: c.difficulty, note: c.note ?? '' });
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // 표제어 승격(canonical collapse)으로 뒤늦게 생긴 중복 제거
    const finalSeen = new Set();
    const finalList = [];
    for (const g of grounded) {
      const k = normAnswerKey(g.answer);
      if (finalSeen.has(k)) continue;
      finalSeen.add(k);
      finalList.push(g);
    }
    grounded.length = 0; grounded.push(...finalList);

    grounded.sort((x, y) => DIFF_ORDER[x.difficulty] - DIFF_ORDER[y.difficulty] || x.answer.localeCompare(y.answer, 'ko'));
    writeFileSync(join(outDir, `${cat}.json`), JSON.stringify(grounded, null, 1));
    writeFileSync(join(outDir, `${cat}.dropped.json`), JSON.stringify(dropped, null, 1));
    report[cat] = {
      input: list.length, dupDropped, checked: uniq.length,
      grounded: grounded.length, wikiDropped: dropped.length,
      byDiff: { easy: grounded.filter(g => g.difficulty === 'easy').length, normal: grounded.filter(g => g.difficulty === 'normal').length, hard: grounded.filter(g => g.difficulty === 'hard').length },
    };
    console.log(`${cat}: 입력 ${list.length} → 중복제거 ${uniq.length} → 근거확보 ${grounded.length} (탈락 ${dropped.length})`);
  }
  writeFileSync(join(outDir, '_report.json'), JSON.stringify(report, null, 2));
  console.log('완료 →', join(outDir, '_report.json'));
}

// 다른 스크립트가 groundOne을 import할 때 main이 돌지 않도록, 직접 실행일 때만 호출한다.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
