/** 텍스트 모델 등급 — 화면 선택값. 실제 Gemini 모델/단가는 서버 config가 매핑. */
export type TextTier = 'standard' | 'pro';

export interface Settings {
  textTier: TextTier;
}
