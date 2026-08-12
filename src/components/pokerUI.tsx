/* ════════════════════════════════════════════════════════════════════
   홀덤 싱글/멀티가 공유하는 순수 표시용 조각들(카드·칩스택·아바타).
   게임 상태를 전혀 모른다 — 그냥 주어진 값을 그린다.
   ════════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
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

// 캐릭터 원본은 400×658 — 좌석 아바타(130×88)처럼 훨씬 작은 박스에 그대로
// CSS로 축소하면(특히 크롬) 머리카락·리본 같은 가는 선이 무아레로 깨져 보인다.
// 캔버스로 고품질 리샘플링(imageSmoothingQuality:'high')한 결과를 캐싱해 쓴다.
// 전신(400×658)을 잘라내지 않고 통째로 줄이므로 원본과 같은 비율로 잡는다
const AVATAR_W = 130;
const AVATAR_H = 214;
const avatarCache = new Map<string, string>();

export function useDownsizedAvatar(src: string): string | null {
  const [url, setUrl] = useState<string | null>(() => avatarCache.get(src) ?? null);
  useEffect(() => {
    const cached = avatarCache.get(src);
    if (cached) { setUrl(cached); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(AVATAR_W * dpr);
      const ch = Math.round(AVATAR_H * dpr);
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // 기존 CSS object-fit:cover + object-position:50% 0% 크롭과 동일한 계산
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - drawW) / 2, 0, drawW, drawH);
      const dataUrl = canvas.toDataURL('image/png');
      avatarCache.set(src, dataUrl);
      if (!cancelled) setUrl(dataUrl);
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return url;
}

/** 아바타 전용 — 리샘플 결과가 준비되기 전까지는 원본을 그대로 보여주다 교체 */
export function SeatAvatar({ src }: { src: string }) {
  const dataUrl = useDownsizedAvatar(src);
  return (
    <div className="holdem-seat-avatar">
      <img src={dataUrl ?? src} alt="" draggable={false} />
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
