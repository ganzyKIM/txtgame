import { BLACK, WHITE, type Board, type Forbidden } from '../game/gomoku/engine';

/* ════════════════════════════════════════════════════════════════════
   오목 판 — 싱글/멀티가 공유하는 순수 표시 컴포넌트.
   게임 진행 규칙은 전혀 모르고, 주어진 판과 표시 정보만 그린다.
   ════════════════════════════════════════════════════════════════════ */

/** 화점(별점) — 실제 바둑판처럼 위치 감각을 주는 표시 */
const STAR_POINTS = new Set(['3,3', '3,11', '11,3', '11,11', '7,7']);

/** 금수 칸에 마우스를 올렸을 때 뜨는 설명 */
export const FORBIDDEN_TITLE: Record<Forbidden, string> = {
  overline:    '금수: 장목(6목 이상)',
  doubleFour:  '금수: 사사(4-4)',
  doubleThree: '금수: 삼삼(3-3)',
};

interface Props {
  board: Board;
  lastMove: { r: number; c: number } | null;
  /** 이긴 5목 좌표 (강조 표시) */
  winLine: [number, number][] | null;
  /** 흑의 금수 자리 — 비어 있으면 아무것도 표시하지 않는다 */
  forbidden?: Map<string, Forbidden>;
  /** true면 착수 불가 (상대 차례·생각 중·대국 종료 등) */
  locked: boolean;
  onCellClick: (r: number, c: number) => void;
}

export default function GomokuBoard({ board, lastMove, winLine, forbidden, locked, onCellClick }: Props) {
  const winSet = new Set((winLine ?? []).map(([r, c]) => `${r},${c}`));

  return (
    <div className={`gomoku-board${locked ? ' is-locked' : ''}`}>
      {board.map((row, r) => row.map((cell, c) => {
        const key = `${r},${c}`;
        const banned = forbidden?.get(key);
        const cls = [
          'gomoku-cell',
          STAR_POINTS.has(key) ? 'is-star' : '',
          cell === BLACK ? 'has-black' : cell === WHITE ? 'has-white' : '',
          lastMove?.r === r && lastMove?.c === c ? 'is-last' : '',
          winSet.has(key) ? 'is-win' : '',
          banned ? 'is-forbidden' : '',
        ].filter(Boolean).join(' ');

        return (
          <button
            key={key}
            className={cls}
            onClick={() => onCellClick(r, c)}
            // 금수 자리는 일부러 활성 상태로 둔다 — 눌러봤을 때 왜 안 되는지
            // 알려주는 편이 그냥 안 눌리는 것보다 규칙 학습에 좋다
            disabled={cell !== -1 || locked}
            title={banned ? FORBIDDEN_TITLE[banned] : undefined}
            aria-label={`${r + 1}행 ${c + 1}열${banned ? ' (금수)' : ''}`}
          >
            {cell !== -1 && <span className="gomoku-stone" />}
          </button>
        );
      }))}
    </div>
  );
}
