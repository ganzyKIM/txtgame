import { useEffect, useState } from 'react';
import { getStats, getRanking, getSoupStats, getRunStats, type Stats, type Ranking, type SoupStats, type RunStats } from '../save/cloudSave';

interface Props {
  userId: string;
  onClose: () => void;
}

const RANK_COLOR: Record<string, string> = {
  S: '#d619a6', A: '#7b34c1', B: '#1a7a64', C: '#a06030',
};

/** Acklam의 역정규분포 근사 (probit) */
function probit(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
              -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
              3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function toHensachi(beaten: number, totalPlayers: number): number {
  if (totalPlayers < 2) return 50;
  const p = Math.max(0.005, Math.min(0.995, beaten / totalPlayers));
  return Math.round(50 + 10 * probit(p));
}

function hensachiColor(v: number): string {
  if (v >= 70) return '#d619a6';
  if (v >= 60) return '#7b34c1';
  if (v >= 50) return '#1a7a64';
  if (v >= 40) return '#a06030';
  return '#888';
}

export default function StatsModal({ userId, onClose }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [soupStats, setSoupStats] = useState<SoupStats | null>(null);
  const [runStats, setRunStats] = useState<RunStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStats(userId), getRanking(userId), getSoupStats(userId), getRunStats(userId)]).then(([s, r, ss, rs]) => {
      setStats(s);
      setRanking(r);
      setSoupStats(ss);
      setRunStats(rs);
      setLoading(false);
    });
  }, [userId]);

  const hensachi = ranking && ranking.totalPlayers > 1
    ? toHensachi(ranking.beaten, ranking.totalPlayers)
    : null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-titlebar">
          <span className="modal-title">◆ 나의 전적 &amp; 랭킹 ★</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="modal-spinner">불러오는 중… ♡</div>
          ) : (
            <>
              {/* 🎯 센터시험 전적 (10문제 총점) */}
              <div className="modal-section">
                <div className="modal-section-title">▌🎯 센터시험 전적 (10문제 총점)</div>
                {runStats && runStats.runs > 0 ? (
                  <div className="stats-grid">
                    <div className="stat-cell">
                      <div className="stat-label">응시 횟수</div>
                      <div className="stat-value">{runStats.runs}<small> 회</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">최고 총점</div>
                      <div className="stat-value">{runStats.bestTotal}<small> 점</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">평균 총점</div>
                      <div className="stat-value">{runStats.avgTotal}<small> 점</small></div>
                    </div>
                  </div>
                ) : (
                  <div className="rank-sub" style={{ padding: '10px 0' }}>
                    아직 센터시험 기록이 없어. 🎯 10문제에 도전해봐!
                  </div>
                )}
              </div>

              {/* 📝 모의시험(개별 문제) 전적 */}
              <div className="modal-section">
                <div className="modal-section-title">▌📝 모의시험 전적 (개별 문제)</div>
                <div className="stats-grid">
                  <div className="stat-cell">
                    <div className="stat-label">총 플레이</div>
                    <div className="stat-value">{stats?.plays ?? 0}<small> 회</small></div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-label">클리어</div>
                    <div className="stat-value">{stats?.wins ?? 0}<small> 회</small></div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-label">승률</div>
                    <div className="stat-value">{stats?.winRate ?? 0}<small> %</small></div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-label">최고 점수</div>
                    <div className="stat-value">{stats?.bestScore ?? 0}<small> 점</small></div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-label">평균 점수</div>
                    <div className="stat-value">{stats?.avgScore ?? 0}<small> 점</small></div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-label">최고 등급</div>
                    <div className="stat-value" style={{ color: RANK_COLOR[stats?.bestRank ?? ''] }}>
                      {stats?.bestRank ?? '-'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 글로벌 랭킹 */}
              <div className="modal-section">
                <div className="modal-section-title">▌글로벌 랭킹</div>
                {ranking === null || ranking.totalPlayers === 0 ? (
                  <div className="rank-sub" style={{ padding: '12px 0' }}>
                    {ranking === null
                      ? '랭킹 데이터를 불러올 수 없어요. (SQL 마이그레이션 005 필요)'
                      : '아직 전 세계 데이터가 없어요. 첫 도전자가 되어봐!'}
                  </div>
                ) : (
                  <>
                    {/* 편차치 메인 표시 */}
                    <div className="hensachi-wrap">
                      <div className="hensachi-label">편차치</div>
                      <div
                        className="hensachi-value"
                        style={{ color: hensachiColor(hensachi ?? 50) }}
                      >
                        {hensachi ?? 50}
                      </div>
                      <div className="hensachi-sub">상위 {ranking.topPercent}%</div>
                    </div>

                    {/* 진행 바 */}
                    <div className="rank-bar-wrap">
                      <div className="rank-bar-bg">
                        <div
                          className="rank-bar-fill"
                          style={{ width: `${100 - ranking.topPercent}%` }}
                        />
                        <div className="rank-bar-label">
                          상위 {ranking.topPercent}% · 최고점 {ranking.myBestScore}점
                        </div>
                      </div>
                    </div>
                    <div className="rank-sub" style={{ marginTop: 6 }}>
                      전체 {ranking.totalPlayers}명 중 {ranking.beaten}명보다 높은 점수
                    </div>
                  </>
                )}
              </div>

              {/* 🐢 수프 전적 */}
              <div className="modal-section">
                <div className="modal-section-title">▌🐢 바다거북 수프 전적</div>
                {soupStats && soupStats.plays > 0 ? (
                  <div className="stats-grid">
                    <div className="stat-cell">
                      <div className="stat-label">총 플레이</div>
                      <div className="stat-value">{soupStats.plays}<small> 회</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">진상 해결</div>
                      <div className="stat-value">{soupStats.solved}<small> 회</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">해결률</div>
                      <div className="stat-value">{soupStats.solveRate}<small> %</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">평균 질문수</div>
                      <div className="stat-value">{soupStats.avgQuestions}<small> 개</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">평균 힌트수</div>
                      <div className="stat-value">{soupStats.avgHints}<small> 개</small></div>
                    </div>
                    <div className="stat-cell">
                      <div className="stat-label">힌트 없이 해결</div>
                      <div className="stat-value">{soupStats.noHintSolves}<small> 회</small></div>
                    </div>
                  </div>
                ) : (
                  <div className="rank-sub" style={{ padding: '10px 0' }}>
                    아직 수프 기록이 없어. 🐢 한번 도전해봐!
                  </div>
                )}
              </div>

              <button className="btn" onClick={onClose} style={{ alignSelf: 'flex-end' }}>닫기</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
