import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  FORMS, LINES, IDLE_VARIANTS, TRANSFORM_LINE, pickLine,
  lineImage, costumeBaseImage, costumeTouchImages,
  type Form, type LineKind, type Costume,
} from '../game/mascotLines';

/* ════════════════════════════════════════════════════════════════════
   Mascot — 쵸텐(초텐쨩) ⟷ 아메, 게임 진행자 겸 오목 상대

   대사·표정 데이터는 전부 src/game/mascotLines.ts로 분리했다.
   이 파일은 "언제 무엇을 띄울지"(말풍선 타이밍·변신 연출·드래그·강림)만
   담당한다. 대사를 추가하려면 mascotLines.ts만 건드리면 된다.
   ════════════════════════════════════════════════════════════════════ */

// 기존 import 경로(./Mascot)를 쓰는 파일들이 많아 타입은 여기서 그대로 재수출한다
export type { Form, LineKind, Costume };

export interface MascotHandle {
  say: (text: string, holdMs?: number) => void;
  event: (kind: LineKind) => void;
  summon: () => void;
  banish: () => void;
  transform: () => void;
  isSummoned: () => boolean;
  /**
   * 가만히 있을 때 저절로 나오는 대사의 종류를 바꾼다.
   * 기본값은 퀴즈용 'idle'인데, 오목처럼 마스코트가 그 게임의 상대로
   * 등장하는 화면에서는 "퀴즈 하자" 같은 엉뚱한 대사가 나오면 안 된다.
   * 화면을 벗어날 때 null로 되돌릴 것.
   */
  setIdleKind: (kind: LineKind | null) => void;
  /**
   * 마스코트에게 의상을 입힌다. 오목 화면에서는 두 캐릭터가 기모노 차림으로만
   * 나와야 해서 쓴다. 화면을 벗어날 때 null로 되돌릴 것.
   */
  setCostume: (costume: Costume | null) => void;
}

const Mascot = forwardRef<MascotHandle>(function Mascot(_props, ref) {
  const rootRef   = useRef<HTMLDivElement>(null);
  const imgRef    = useRef<HTMLImageElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const formRef   = useRef<Form>('choten');
  const summonedRef   = useRef(false);
  const bubbleTimer   = useRef<number | null>(null);
  const idleTimer     = useRef<number | null>(null);
  const idleKindRef   = useRef<LineKind>('idle');
  const costumeRef    = useRef<Costume | null>(null);

  const [renderTick, setRenderTick] = useState(0);

  function setImg(kind: LineKind) {
    if (imgRef.current) {
      imgRef.current.src = lineImage(formRef.current, kind, costumeRef.current);
    }
  }

  function say(text: string, holdMs = 3200) {
    const bubble = bubbleRef.current;
    if (!bubble || !text) return;
    bubble.textContent = text;
    bubble.hidden = false;
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => { bubble.hidden = true; }, holdMs);
  }

  function event(kind: LineKind) {
    setImg(kind);
    const bank = LINES[formRef.current][kind] ?? LINES[formRef.current].idle;
    say(pickLine(bank));
    // 방금 말했으면 "가만히 있네" 타이머는 다시 처음부터 — 대화 중에 엉뚱하게
    // 심심하다는 대사가 끼어드는 걸 막는다
    bumpIdle();
  }

  function bumpIdle() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (summonedRef.current) event(idleKindRef.current);
    }, 45000);
  }

  function setForm(name: Form) {
    formRef.current = name;
    if (imgRef.current) {
      imgRef.current.src = costumeRef.current
        ? costumeBaseImage(name, costumeRef.current)
        : FORMS[name].img;
    }
    document.body.classList.toggle('mode-ame', name === 'ame');
    setRenderTick((n) => n + 1);
  }

  function transform() {
    const root = rootRef.current;
    if (!root || root.classList.contains('transforming')) return;
    const next: Form = formRef.current === 'choten' ? 'ame' : 'choten';
    root.classList.add('transforming');
    if (bubbleRef.current) bubbleRef.current.hidden = true;
    window.setTimeout(() => { setForm(next); say(TRANSFORM_LINE[next], 3400); }, 480);
    window.setTimeout(() => root.classList.remove('transforming'), 1300);
  }

  function summon() {
    if (summonedRef.current) return;
    summonedRef.current = true;
    const root = rootRef.current;
    if (root) {
      root.classList.add('descending');
      window.setTimeout(() => root.classList.remove('descending'), 700);
    }
    bumpIdle();
    setRenderTick((n) => n + 1);
  }

  function banish() {
    if (!summonedRef.current) return;
    summonedRef.current = false;
    const root = rootRef.current;
    if (root) {
      root.classList.remove('descending');
      root.classList.add('ascending');
      window.setTimeout(() => {
        root.classList.remove('ascending');
        if (bubbleRef.current) bubbleRef.current.hidden = true;
      }, 480);
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setRenderTick((n) => n + 1);
  }

  useImperativeHandle(ref, () => ({
    say, event, summon, banish, transform,
    isSummoned: () => summonedRef.current,
    setIdleKind: (kind: LineKind | null) => { idleKindRef.current = kind ?? 'idle'; },
    setCostume: (costume: Costume | null) => {
      costumeRef.current = costume;
      // 지금 떠 있는 그림도 바로 갈아입힌다 (다음 대사까지 기다리지 않게)
      if (imgRef.current) {
        imgRef.current.src = costume
          ? costumeBaseImage(formRef.current, costume)
          : FORMS[formRef.current].img;
      }
    },
  }));

  // 마운트 시 자동 강림
  useEffect(() => { summon(); }, []);

  // 드래그 이동 — pointerdown에서 위치를 바꾸지 않고 실제 이동 시작(6px) 때만 인라인 스타일 적용
  useEffect(() => {
    const root = rootRef.current;
    const img  = imgRef.current;
    if (!root || !img) return;

    let drag: {
      sx: number; sy: number;
      startRight: number; startBottom: number;
      moved: boolean;
    } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const r  = root.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      drag = {
        sx: e.clientX, sy: e.clientY,
        startRight:  vw - r.right,
        startBottom: vh - r.bottom,
        moved: false,
      };
      img.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) {
        drag.moved = true;
        // 처음 움직일 때만 인라인 스타일로 전환 (클릭만 할 때는 위치 변경 없음)
        root.style.left = 'auto'; root.style.top = 'auto';
        root.style.right  = drag.startRight  + 'px';
        root.style.bottom = drag.startBottom + 'px';
      }
      if (!drag.moved) return;
      const w = root.offsetWidth, h = root.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let nr = drag.startRight  - dx;
      let nb = drag.startBottom - dy;
      nr = Math.max(-(w * 0.5), Math.min(vw - w * 0.5, nr));
      nb = Math.max(-(h * 0.6), Math.min(vh - h,       nb));
      root.style.right  = nr + 'px';
      root.style.bottom = nb + 'px';
    };

    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      root.classList.remove('dragging');
      try { img.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      if (!moved && !root.classList.contains('transforming') && summonedRef.current) {
        const variants = IDLE_VARIANTS[formRef.current];
        const v = variants[Math.floor(Math.random() * variants.length)];
        // 대사는 그대로 쓰되, 의상 차림이면 그림만 그 옷 것으로 바꾼다
        if (imgRef.current) {
          const costume = costumeRef.current;
          if (costume) {
            const imgs = costumeTouchImages(formRef.current, costume);
            imgRef.current.src = imgs[Math.floor(Math.random() * imgs.length)];
          } else {
            imgRef.current.src = v.img;
          }
        }
        say(v.text);
        bumpIdle();
      }
    };

    img.addEventListener('pointerdown', onDown);
    img.addEventListener('pointermove', onMove);
    img.addEventListener('pointerup',   onUp);
    const onErr  = () => root.classList.add('img-missing');
    const onLoad = () => root.classList.remove('img-missing');
    img.addEventListener('error', onErr);
    img.addEventListener('load',  onLoad);
    return () => {
      img.removeEventListener('pointerdown', onDown);
      img.removeEventListener('pointermove', onMove);
      img.removeEventListener('pointerup',   onUp);
      img.removeEventListener('error', onErr);
      img.removeEventListener('load',  onLoad);
    };
  }, []);

  const form = formRef.current;
  void renderTick; // re-render trigger
  return (
    <div ref={rootRef} className={`mascot ${FORMS[form].cls}${summonedRef.current ? '' : ' mascot-hidden'}`} data-form={form}>
      <div ref={bubbleRef} className="mascot-bubble" hidden />
      <div className="mascot-stack">
        <div className="mascot-fx" aria-hidden="true">
          <span className="fx-flash" />
          <span className="fx-ring" /><span className="fx-ring fx-ring2" />
          <span className="fx-spark s1">✦</span><span className="fx-spark s2">✧</span>
          <span className="fx-spark s3">★</span><span className="fx-spark s4">✦</span>
          <span className="fx-spark s5">✧</span><span className="fx-spark s6">❤</span>
        </div>
        <img ref={imgRef} className="mascot-img" src={FORMS.choten.img} alt="마스코트" draggable={false} />
        <div className="mascot-fallback">
          초텐쨩 (이미지 없음)<small>public/char/ 에 넣어주세요</small>
        </div>
      </div>
    </div>
  );
});

export default Mascot;
