/**
 * 점수/등급 산정.
 * 적게 열고(=revealedCount 작음) 오답이 적을수록 고득점.
 * - 기본 1000점에서 사용한 힌트와 오답에 따라 차감.
 */
export interface Score {
  score: number;
  rank: 'S' | 'A' | 'B' | 'C';
}

export function computeScore(
  revealedCount: number,
  maxHints: number,
  wrongGuesses: number,
): Score {
  const base = 1000;
  // 첫 힌트는 무료로 친다(1개는 기본 공개). 그 이후 공개분과 오답에 패널티.
  const hintPenalty = Math.max(0, revealedCount - 1) * Math.ceil(base / (maxHints + 1));
  const wrongPenalty = wrongGuesses * 80;
  const score = Math.max(50, base - hintPenalty - wrongPenalty);

  // 임계값 대비 사용 비율로 등급
  const ratio = revealedCount / Math.max(1, maxHints);
  let rank: Score['rank'];
  if (ratio <= 0.34 && wrongGuesses === 0) rank = 'S';
  else if (ratio <= 0.5) rank = 'A';
  else if (ratio <= 0.8) rank = 'B';
  else rank = 'C';

  return { score, rank };
}

/** 센터시험 한 런(여러 문제)의 총점 → 평균 기반 종합 등급 */
export function runGrade(total: number, questions: number): { rank: Score['rank']; avg: number } {
  const avg = questions > 0 ? Math.round(total / questions) : 0;
  let rank: Score['rank'];
  if (avg >= 850) rank = 'S';
  else if (avg >= 650) rank = 'A';
  else if (avg >= 400) rank = 'B';
  else rank = 'C';
  return { rank, avg };
}
