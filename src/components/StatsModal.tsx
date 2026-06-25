import { useEffect, useState } from 'react';
import { getStats, getRanking, type Stats, type Ranking } from '../save/cloudSave';

interface Props {
  userId: string;
  onClose: () => void;
}

const RANK_COLOR: Record<string, string> = {
  S: '#d619a6', A: '#7b34c1', B: '#1a7a64', C: '#a06030',
};

export default function StatsModal({ userId, onClose }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStats(userId), getRanking(userId)]).then(([s, r]) => {
      setStats(s);
      setRanking(r);
      setLoading(false);
    });
  }, [userId]);

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
              {/* 개인 전적 */}
              <div className="modal-section">
                <div className="modal-section-title">▌나의 전적</div>
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
                    <div className="rank-top" style={{ color: RANK_COLOR[stats?.bestRank ?? ''] ?? 'var(--magenta-d)' }}>
                      상위 {ranking.topPercent}%
                    </div>
                    <div className="rank-sub">
                      전체 {ranking.totalPlayers}명 중 {ranking.beaten}명보다 높은 점수
                    </div>
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
                  </>
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
