/** 텍스트 모델 티어 — 서버 config.models[tier]로 실제 Gemini 모델/단가가 매핑된다.
 *  txtrpg(pro/standard)와 완전 분리하기 위해 txtgame 전용 키를 쓴다:
 *  quiz_gen = 출제(퀴즈·수프 시나리오), quiz_judge = 판정(정답·예/아니오·힌트). */
export type TextTier = 'quiz_gen' | 'quiz_judge';

export interface Settings {
  textTier: TextTier;
}
