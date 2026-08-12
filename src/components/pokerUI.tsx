/* ════════════════════════════════════════════════════════════════════
   홀덤 싱글/멀티가 공유하는 순수 표시용 조각들(카드·칩스택·아바타).
   게임 상태를 전혀 모른다 — 그냥 주어진 값을 그린다.
   ════════════════════════════════════════════════════════════════════ */
import { cardLabel } from '../game/poker/deck';
import type { Card } from '../game/poker/types';

export function PixelCard({ card, hidden, big }: { card?: Card; hidden?: boolean; big?: boolean }) {
  if (hidden || !card) return <div className={`pcard pcard-back${big ? ' pcard-lg' : ''}`} />;
  const isRed = card.suit === 'h' || card.suit === 'd';
  const label = cardLabel(card);
  return (
    <div className={`pcard ${isRed ? 'pcard-red' : 'pcard-black'}${big ? ' pcard-lg' : ''}`}>
      <span className="pcard-rank">{label.slice(0, -1)}</span>
      <span className="pcard-suit">{label.slice(-1)}</span>
    </div>
  );
}

const CHIP_UNIT = 100;
const CHIP_MAX = 18;

/** 보유 칩을 실제로 쌓인 더미처럼 보여준다 — 세로가 아니라 좌석 옆 여유 공간을 쓰므로
 *  화면 높이는 전혀 잡아먹지 않는다(스크롤 금지 제약과 무관). */
export function ChipStack({ amount }: { amount: number }) {
  if (amount <= 0) return <div className="chipstack" />;
  const count = Math.max(1, Math.min(CHIP_MAX, Math.round(amount / CHIP_UNIT)));
  return (
    <div className="chipstack">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`chip chip-t${i % 3}`} />
      ))}
    </div>
  );
}

/** 좌석 아바타 — 원본(400×658)을 그대로 쓴다. 예전엔 130px대 박스에 맞춰
 *  캔버스 리샘플링을 했지만, 지금은 좌석이 화면 높이를 꽉 채워 표시 크기가
 *  원본에 가깝기 때문에 작은 축소본을 다시 확대하면 오히려 흐려진다. */
export function SeatAvatar({ src }: { src: string }) {
  return (
    <div className="holdem-seat-avatar">
      <img src={src} alt="" draggable={false} />
    </div>
  );
}

/** 사람 좌석용 — 캐릭터 스프라이트가 없으니 닉네임 이니셜을 색상 원으로 보여준다(멀티 전용) */
export function HumanAvatar({ nickname }: { nickname: string }) {
  const initial = nickname.trim().slice(0, 1) || '?';
  return (
    <div className="holdem-seat-avatar holdem-human-avatar">
      <span>{initial}</span>
    </div>
  );
}
