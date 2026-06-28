import type { TextTier } from '../types';

export interface TextTierInfo {
  tier: TextTier;
  /** UI에 노출되는 모델명 */
  label: string;
  /** 가격 안내 문구 */
  priceNote: string;
}

/**
 * 유저가 고르는 두 가지 텍스트 모델.
 * 실제 Gemini 모델 ID와 단가는 서버(config 테이블)에서 매핑/차감하며,
 * 여기서는 화면 표시와 선택값(tier)만 다룬다. (txtrpg와 동일한 Edge Function)
 */
export const TEXT_TIERS: TextTierInfo[] = [
  {
    tier: 'quiz_gen',
    label: 'Pro (고품질)',
    priceNote: '더 까다로운 출제·판정',
  },
];

export const DEFAULT_TEXT_TIER: TextTier = 'quiz_gen';

export function tierLabel(tier: TextTier): string {
  return TEXT_TIERS.find((t) => t.tier === tier)?.label ?? tier;
}
