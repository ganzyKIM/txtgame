import { HAND_CATEGORY_LABEL } from '../game/poker/handRank';
import { HAND_CATEGORY, type HandCategory } from '../game/poker/types';

interface Props { onClose: () => void; }

/** 강한 순서대로 나열 — HAND_CATEGORY는 숫자가 클수록 강하다(handRank.ts 참고) */
const RANKS_DESC: HandCategory[] = [
  HAND_CATEGORY.STRAIGHT_FLUSH,
  HAND_CATEGORY.FOUR_KIND,
  HAND_CATEGORY.FULL_HOUSE,
  HAND_CATEGORY.FLUSH,
  HAND_CATEGORY.STRAIGHT,
  HAND_CATEGORY.THREE_KIND,
  HAND_CATEGORY.TWO_PAIR,
  HAND_CATEGORY.ONE_PAIR,
  HAND_CATEGORY.HIGH_CARD,
];

const RANK_DESC_TEXT: Record<HandCategory, string> = {
  [HAND_CATEGORY.STRAIGHT_FLUSH]: '같은 무늬로 숫자가 5장 연속(A-K-Q-J-10이면 로열플러시).',
  [HAND_CATEGORY.FOUR_KIND]: '같은 숫자 카드 4장.',
  [HAND_CATEGORY.FULL_HOUSE]: '같은 숫자 3장 + 다른 같은 숫자 2장.',
  [HAND_CATEGORY.FLUSH]: '무늬가 전부 같은 5장(숫자는 안 이어져도 됨).',
  [HAND_CATEGORY.STRAIGHT]: '무늬 상관없이 숫자가 5장 연속(A는 2-3-4-5의 1로도, 10-J-Q-K-A의 14로도 쓰임).',
  [HAND_CATEGORY.THREE_KIND]: '같은 숫자 카드 3장.',
  [HAND_CATEGORY.TWO_PAIR]: '숫자가 같은 카드 2장짜리 페어가 2세트.',
  [HAND_CATEGORY.ONE_PAIR]: '같은 숫자 카드 2장.',
  [HAND_CATEGORY.HIGH_CARD]: '위 조합이 하나도 안 되면 가장 높은 카드로 승부.',
};

export default function HoldemRulesModal({ onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-titlebar">
          <span className="modal-title">◆ 텍사스 홀덤 규칙 &amp; 족보</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-title">▌기본 진행</div>
            <ul className="soup-rules">
              <li>모두 손패(홀카드) 2장씩 받고, 테이블 중앙에 커뮤니티 카드 5장이 순서대로 공개돼(플랍 3장 → 턴 1장 → 리버 1장).</li>
              <li>내 손패 2장 + 커뮤니티 카드 5장 중 가장 좋은 5장 조합으로 승부해.</li>
              <li>매 핸드 시작 전 SB(스몰블라인드)·BB(빅블라인드) 두 좌석이 강제로 돈을 걸고 시작해.</li>
              <li>공개 단계마다 폴드(포기) / 체크·콜(따라가기) / 레이즈(더 걸기) / 올인 중 하나를 골라 베팅해.</li>
              <li>끝까지 남은 사람들끼리 손패를 공개(쇼다운)해서 가장 좋은 족보가 팟을 가져가.</li>
              <li>중간에 나만 빼고 전부 폴드하면 쇼다운 없이 바로 팟을 가져가(이때는 패를 안 까도 됨).</li>
            </ul>
          </div>
          <div className="modal-section">
            <div className="modal-section-title">▌족보 순위 (위가 더 강함)</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {RANKS_DESC.map((cat) => (
                <li key={cat} style={{ fontSize: 12 }}>
                  <b>{HAND_CATEGORY_LABEL[cat]}</b>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{RANK_DESC_TEXT[cat]}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
