import { useState } from 'react';
import { CATEGORIES, DIFFICULTIES } from '../game/puzzle';
import type { Difficulty } from '../game/types';
import { TEXT_TIERS } from '../config/models';
import type { TextTier } from '../types';

export interface StartConfig {
  categoryLabel: string;
  theme: string;
  difficulty: Difficulty;
  tier: TextTier;
}

interface Props {
  busy: boolean;
  onStart: (cfg: StartConfig) => void;
  onStartSoup: () => void;
}

const CUSTOM_KEY = '__custom__';

export default function StartScreen({ busy, onStart, onStartSoup }: Props) {
  const [catKey, setCatKey] = useState<string>(CATEGORIES[0].key);
  const [customCat, setCustomCat] = useState('');
  const [theme, setTheme] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [tier, setTier] = useState<TextTier>('pro');

  const isCustom = catKey === CUSTOM_KEY;
  const categoryLabel = isCustom
    ? customCat.trim() || '자유 주제'
    : CATEGORIES.find((c) => c.key === catKey)?.label ?? '인물';

  const canStart = !busy && (!isCustom || customCat.trim().length > 0);

  function start() {
    if (!canStart) return;
    onStart({ categoryLabel, theme: theme.trim(), difficulty, tier });
  }

  return (
    <div className="body">
      <div className="start-body">

        {/* 왼쪽: 카테고리 선택 */}
        <div className="start-cat">
          <div className="ctl-group">
            <label className="ctl-label">◆ 카테고리를 골라줘 <b>♡</b></label>
            <div className="cat-grid">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  className={`cat-btn ${catKey === c.key ? 'active' : ''}`}
                  onClick={() => setCatKey(c.key)}
                >
                  <span className="cat-emoji">{c.emoji}</span>
                  {c.label}
                </button>
              ))}
              <button
                className={`cat-btn ${isCustom ? 'active' : ''}`}
                onClick={() => setCatKey(CUSTOM_KEY)}
              >
                <span className="cat-emoji">✏️</span>
                직접 입력
              </button>
            </div>
            {isCustom && (
              <input
                className="text-input"
                style={{ marginTop: 8 }}
                placeholder="예) K-POP 아이돌, 그리스 신화, 마블 히어로…"
                value={customCat}
                onChange={(e) => setCustomCat(e.target.value)}
              />
            )}
          </div>

          <button className="soup-launch" onClick={onStartSoup} disabled={busy}>
            <span className="soup-launch-emoji">🐢</span>
            <span className="soup-launch-text">
              <b>바다거북 수프 게임</b>
              <small>예/아니오 질문으로 진상을 추리하는 수평사고 퀴즈!</small>
            </span>
          </button>
        </div>

        {/* 오른쪽: 세부 설정 + 시작 */}
        <div className="start-settings">
          <div className="ctl-group">
            <label className="ctl-label">◆ 세부 주제·컨셉 (선택)</label>
            <input
              className="text-input"
              placeholder="비워두면 천사쨩이 알아서 골라줘!"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
            />
          </div>

          <div className="ctl-group">
            <label className="ctl-label">◆ 난이도</label>
            <div className="seg">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.key}
                  className={`seg-btn ${difficulty === d.key ? 'active' : ''}`}
                  onClick={() => setDifficulty(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <small className="note">{DIFFICULTIES.find((d) => d.key === difficulty)?.note}</small>
          </div>

          {TEXT_TIERS.length > 1 && (
            <div className="ctl-group">
              <label className="ctl-label">◆ 출제 모델</label>
              <div className="seg">
                {TEXT_TIERS.map((t) => (
                  <button
                    key={t.tier}
                    className={`seg-btn ${tier === t.tier ? 'active' : ''}`}
                    onClick={() => setTier(t.tier)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <small className="note">{TEXT_TIERS.find((t) => t.tier === tier)?.priceNote}</small>
            </div>
          )}

          <button className="btn btn-primary" onClick={start} disabled={!canStart}>
            {busy ? '천사쨩이 문제 내는 중… ✦' : '✞ 퀴즈 스타-토 ✞'}
          </button>
        </div>

      </div>
    </div>
  );
}
