import { useState } from 'react';
import { CATEGORIES, DIFFICULTIES } from '../game/puzzle';
import type { Difficulty, ExamMode } from '../game/types';
import { CENTER_QUESTIONS } from '../game/types';
import { TEXT_TIERS } from '../config/models';
import type { TextTier } from '../types';

export interface StartConfig {
  categoryLabel: string;
  /** 프리셋 카테고리의 상세 출제 범위 (자유 입력이면 빈 문자열) */
  categoryPrompt: string;
  theme: string;
  difficulty: Difficulty;
  tier: TextTier;
  /** center: 10문제 센터시험(총점) / mock: 무제한 모의시험 */
  examMode: ExamMode;
}

interface Props {
  busy: boolean;
  onStart: (cfg: StartConfig) => void;
}

const CUSTOM_KEY = '__custom__';

export default function StartScreen({ busy, onStart }: Props) {
  const [catKey, setCatKey] = useState<string>(CATEGORIES[0].key);
  const [customCat, setCustomCat] = useState('');
  const [theme, setTheme] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [tier, setTier] = useState<TextTier>('quiz_gen');

  const isCustom = catKey === CUSTOM_KEY;
  const categoryLabel = isCustom
    ? customCat.trim() || '자유 주제'
    : CATEGORIES.find((c) => c.key === catKey)?.label ?? '인물';
  const categoryPrompt = isCustom
    ? ''
    : CATEGORIES.find((c) => c.key === catKey)?.prompt ?? '';

  const canStart = !busy && (!isCustom || customCat.trim().length > 0);

  function start(examMode: ExamMode) {
    if (!canStart) return;
    onStart({ categoryLabel, categoryPrompt, theme: theme.trim(), difficulty, tier, examMode });
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
              onKeyDown={(e) => { if (e.key === 'Enter') start('center'); }}
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

          <div className="start-modes">
            <button className="btn btn-primary" onClick={() => start('center')} disabled={!canStart}>
              {busy ? '천사쨩이 문제 내는 중… ✦' : `🎯 센터시험 (${CENTER_QUESTIONS}문제 총점)`}
            </button>
            <button className="btn btn-lav start-mock-btn" onClick={() => start('mock')} disabled={!canStart}>
              📝 모의시험 (자유 연습)
            </button>
          </div>
          <small className="note">
            🎯 센터시험: {CENTER_QUESTIONS}문제를 연속으로 풀어 <b>총점·편차치</b>로 기록 (중간에 나가면 기록 안 됨).
            📝 모의시험: 한 문제씩 자유롭게, 기록은 개별 전적에만.
          </small>
        </div>

      </div>
    </div>
  );
}
