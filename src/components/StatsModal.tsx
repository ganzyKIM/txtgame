import { useEffect, useState } from 'react';
import { getMyStats, type MyStats } from '../save/cloudSave';

interface Props {
  onClose: () => void;
}

/* 편차치 색 — 서비스 이름이 "편차치 99"라 이 숫자가 전적의 얼굴이다 */
function hensachiColor(v: number): string {
  if (v >= 70) return '#d619a6';
  if (v >= 60) return '#7b34c1';
  if (v >= 50) return '#1a7a64';
  if (v >= 40) return '#a06030';
  return '#888';
}

/* 게임별 칭호 — 숫자 나열보다 이 한 줄이 재도전 동기를 만든다.
   달성 조건이 보이도록 바로 위 단계 이름은 UI에 안 숨긴다(다음 목표는 궁금해야 재밌다). */
function gomokuTitle(g: MyStats['gomoku']): string | null {
  if (g.hard_wins > 0) return '진심 브레이커';
  if (g.wins >= 10) return '동네 고수';
  if (g.wins > 0) return '오목 입문';
  return null;
}
function holdemTitle(h: MyStats['holdem']): string | null {
  if (h.best_pot >= 2000) return '하이롤러';
  if (h.wins >= 30) return '테이블의 상어';
  if (h.wins > 0) return '포커페이스';
  return null;
}
function soupTitle(s: MyStats['soup']): string | null {
  if (s.no_hint >= 3) return '명탐정';
  if (s.solved > 0) return '수프 감별사';
  return null;
}

function Cell({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}{unit && <small> {unit}</small>}
      </div>
    </div>
  );
}

function Section({ icon, title, badge, empty, children }: {
  icon: string; title: string; badge: string | null; empty: boolean; children: React.ReactNode;
}) {
  return (
    <div className="modal-section">
      <div className="modal-section-title">
        ▌{icon} {title}
        {badge && <span className="stats-title-badge">★ {badge}</span>}
      </div>
      {empty
        ? <div className="rank-sub" style={{ padding: '8px 0' }}>아직 기록이 없어 — 한번 도전해봐!</div>
        : <div className="stats-grid">{children}</div>}
    </div>
  );
}

export default function StatsModal({ onClose }: Props) {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyStats().then((s) => { setStats(s); setLoading(false); });
  }, []);

  const topPercent = stats && stats.players > 0
    ? Math.max(1, 100 - Math.round((stats.beaten / stats.players) * 100))
    : 100;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-titlebar">
          <span className="modal-title">◆ 나의 전적 ★</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="modal-spinner">불러오는 중… ♡</div>
          ) : !stats ? (
            <div className="rank-sub" style={{ padding: '12px 0' }}>
              전적을 불러올 수 없어요. (SQL 마이그레이션 033 필요)
            </div>
          ) : (
            <>
              {/* 편차치 헤드라인 — 센터시험 기준, 서버가 계산해서 내려준다 */}
              <div className="modal-section">
                <div className="modal-section-title">▌🎯 센터시험 편차치</div>
                {stats.hensachi === null ? (
                  <div className="rank-sub" style={{ padding: '10px 0' }}>
                    센터시험(10문제)을 치르면 편차치가 나와. 첫 도전 가봐!
                  </div>
                ) : (
                  <>
                    <div className="hensachi-wrap">
                      <div className="hensachi-label">편차치</div>
                      <div className="hensachi-value" style={{ color: hensachiColor(stats.hensachi) }}>
                        {stats.hensachi}
                      </div>
                      <div className="hensachi-sub">상위 {topPercent}%</div>
                    </div>
                    <div className="rank-bar-wrap">
                      <div className="rank-bar-bg">
                        <div className="rank-bar-fill" style={{ width: `${100 - topPercent}%` }} />
                        <div className="rank-bar-label">
                          최고 {stats.center.best}점 · 전체 {stats.players}명 중 {stats.beaten}명을 제쳤어
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <Section icon="🎯" title="퀴즈" badge={null} empty={stats.center.runs === 0 && stats.quiz.plays === 0}>
                <Cell label="센터 응시" value={stats.center.runs} unit="회" />
                <Cell label="센터 최고" value={stats.center.best} unit="점" />
                <Cell label="모의 클리어" value={`${stats.quiz.wins}/${stats.quiz.plays}`} />
              </Section>

              <Section icon="⚫" title="오목" badge={gomokuTitle(stats.gomoku)} empty={stats.gomoku.plays === 0}>
                <Cell label="승리" value={`${stats.gomoku.wins}/${stats.gomoku.plays}`} />
                <Cell label="진심 격파" value={stats.gomoku.hard_wins} unit="회"
                      color={stats.gomoku.hard_wins > 0 ? '#d619a6' : undefined} />
                <Cell label="멀티 승" value={stats.gomoku.multi_wins} unit="회" />
              </Section>

              <Section icon="🃏" title="홀덤" badge={holdemTitle(stats.holdem)} empty={stats.holdem.hands === 0}>
                <Cell label="핸드 승" value={`${stats.holdem.wins}/${stats.holdem.hands}`} />
                <Cell label="최대 팟" value={stats.holdem.best_pot} unit="칩"
                      color={stats.holdem.best_pot >= 2000 ? '#d619a6' : undefined} />
                <Cell label="멀티 승" value={stats.holdem.multi_wins} unit="회" />
              </Section>

              <Section icon="🐢" title="바다거북 수프" badge={soupTitle(stats.soup)} empty={stats.soup.plays === 0}>
                <Cell label="해결" value={`${stats.soup.solved}/${stats.soup.plays}`} />
                <Cell label="노히트 해결" value={stats.soup.no_hint} unit="회"
                      color={stats.soup.no_hint >= 3 ? '#d619a6' : undefined} />
                <Cell label="해결률"
                      value={stats.soup.plays > 0 ? Math.round((stats.soup.solved / stats.soup.plays) * 100) : 0}
                      unit="%" />
              </Section>

              <button className="btn" onClick={onClose} style={{ alignSelf: 'flex-end' }}>닫기</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
