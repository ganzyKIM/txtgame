/**
 * 힌트 결정론 린트 — src/game/puzzle.ts lintHints() 포팅 + 시드용 스키마 검사.
 * AI 없이 즉시 실행되는 하드 게이트. 반환: 문제 목록(빈 배열 = 통과).
 */
export function normKey(s) {
  return s.toLowerCase().replace(/[\s·~!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`'""“”（）【】]/g, '').trim();
}
export function baseName(answer) {
  return answer.replace(/\s*[(（【[][^)）】\]]*[)）】\]]\s*$/, '').trim();
}

/** 게임 코드와 동일한 스포일러·중복 검사 (+ 고사성어 2글자 조각 검사) */
export function lintHints(q, categoryKey) {
  const issues = [];
  const ansKey = normKey(q.answer);
  const baseKey = normKey(baseName(q.answer));
  const ansTokens = q.answer.split(/[\s·]/).map(normKey).filter(t => t.length >= 3);
  const ansBigrams = categoryKey === 'proverb' && ansKey.length >= 4
    ? Array.from({ length: ansKey.length - 1 }, (_, i) => ansKey.slice(i, i + 2))
    : [];

  const seen = new Set();
  (q.hints ?? []).forEach((hint, i) => {
    const hk = normKey(hint);
    if (ansKey.length >= 2 && hk.includes(ansKey)) issues.push(`힌트${i + 1}: 정답 이름 직접 노출`);
    else if (baseKey.length >= 2 && baseKey !== ansKey && hk.includes(baseKey)) issues.push(`힌트${i + 1}: 정답 기본명 노출`);
    else if (ansTokens.some(t => t.length >= 4 && hk.includes(t))) issues.push(`힌트${i + 1}: 정답 토큰 노출 가능성`);
    else if (ansBigrams.some(g => hk.includes(g))) issues.push(`힌트${i + 1}: 정답 음절 일부 노출`);
    if (seen.has(hk)) issues.push(`힌트${i + 1}: 중복 힌트`);
    seen.add(hk);
  });
  return issues;
}

/** 시드 항목 스키마·형식 검사 */
export function lintSchema(q) {
  const issues = [];
  if (!q.answer || typeof q.answer !== 'string') issues.push('answer 누락');
  if (!Array.isArray(q.hints) || q.hints.length < 5 || q.hints.length > 8) issues.push(`힌트 개수 ${q.hints?.length ?? 0} (5~8 필요)`);
  if ((q.hints ?? []).some(h => typeof h !== 'string' || h.trim().length < 8)) issues.push('너무 짧거나 잘못된 힌트');
  if ((q.hints ?? []).some(h => h.length > 200)) issues.push('200자 초과 힌트');
  const mh = Number(q.maxHints);
  if (!Number.isFinite(mh) || mh < 2 || mh > (q.hints?.length ?? 0)) issues.push(`maxHints 부적절 (${q.maxHints})`);
  if (!Array.isArray(q.acceptable)) issues.push('acceptable 배열 아님');
  if (!['easy', 'normal', 'hard'].includes(q.difficulty)) issues.push(`difficulty 부적절 (${q.difficulty})`);
  // 반말·감탄형 어미 소프트 검사: 마지막 어절이 존댓말 평서문인지
  const informal = (q.hints ?? []).filter(h => !/(습니다|입니다|합니다|됩니다|있습니다|없습니다|졌습니다|랍니다|웠습니다|났습니다|왔습니다|렸습니다|았습니다|었습니다|니다)[.!?…"']*\s*$/.test(h.trim()));
  if (informal.length > 0) issues.push(`존댓말 평서문 아님 ${informal.length}개`);
  return issues;
}

export function lintAll(q, categoryKey) {
  return [...lintSchema(q), ...lintHints(q, categoryKey)];
}
