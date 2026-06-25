import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* ════════════════════════════════════════════════════════════════════
   Mascot — 쵸텐(천사쨩) ⟷ 아메, 퀴즈 진행자
   ════════════════════════════════════════════════════════════════════ */

export type Form = 'choten' | 'ame';
export type LineKind = 'intro' | 'hint' | 'correct' | 'wrong' | 'eliminated' | 'win' | 'idle' | 'loading' | 'judging';

export interface MascotHandle {
  say: (text: string, holdMs?: number) => void;
  event: (kind: LineKind) => void;
  summon: () => void;
  banish: () => void;
  transform: () => void;
  isSummoned: () => boolean;
}

const FORMS: Record<Form, { img: string; name: string; cls: string }> = {
  choten: { img: '/char/choten_default.png', name: '천사쨩', cls: 'form-choten' },
  ame:    { img: '/char/ame_default.png',    name: '아메',   cls: 'form-ame'    },
};

const LINE_IMAGES: Record<Form, Record<LineKind, string>> = {
  choten: {
    intro:      '/char/choten_default.png',
    hint:       '/char/choten_peace.png',
    correct:    '/char/choten_dere.png',
    wrong:      '/char/choten_angry.png',
    eliminated: '/char/choten_angry.png',
    win:        '/char/choten_dere.png',
    idle:       '/char/choten_peace.png',
    loading:    '/char/choten_peace.png',
    judging:    '/char/choten_dere.png',
  },
  ame: {
    intro:      '/char/ame_default.png',
    hint:       '/char/ame_smoking.png',
    correct:    '/char/ame_dere.png',
    wrong:      '/char/ame_yandere.png',
    eliminated: '/char/ame_yandere.png',
    win:        '/char/ame_dere.png',
    idle:       '/char/ame_smoking.png',
    loading:    '/char/ame_smoking.png',
    judging:    '/char/ame_default.png',
  },
};

const LINES: Record<Form, Record<LineKind, string[]>> = {
  choten: {
    intro: [
      '자, P! 천사쨩이 문제 하나 숨겨놨어! 맞혀봐♡',
      '오늘의 정답은 비밀이야~ 힌트 보고 맞혀줘!',
      '준비됐어? 천사쨩이 낸 문제, 적게 보고 맞히면 칭찬해줄게♡',
      '집중집중! 힌트는 조금씩만 열어야 고득점이야!',
    ],
    hint: [
      '힌트 하나 더 줄게~ 잘 봐♡',
      '이거면 감 오지 않아? 천사쨩 친절하지?♡',
      '자, 다음 힌트! 너무 많이 열면 안 돼~',
      '조금씩 가까워지고 있어! 힘내!',
    ],
    correct: [
      '정답이야!! 역시 P 똑똑해!♡',
      '딩동댕~! 천사쨩 감동했어!',
      '맞혔어!! 봤지? 우리 P 천재라니까♡',
      '대단해! 이렇게 빨리 맞히다니!♡',
    ],
    wrong: [
      '땡! 아쉽다… 다시 생각해봐!',
      '음~ 그건 아니야. 힌트 더 볼래?',
      '아깝다! 조금만 더 고민해봐♡',
      '아니야아니야~ 천사쨩 믿고 다시!',
    ],
    eliminated: [
      '으앙… 이번엔 못 맞혔네. 정답 알려줄게…',
      '힌트를 너무 많이 썼어… 다음엔 더 잘하자!',
      '아쉬워라… 그래도 천사쨩이랑 또 하자, 응?',
    ],
    win: [
      '클리어~!♡ 천사쨩이 박수 쳐줄게! 짝짝짝!',
      '해냈다! P 최고야!♡',
      '완벽한 추리였어! 자랑스러워!♡',
    ],
    idle: [
      'P~ 힌트 열거나 정답 말해봐!♡',
      '천천히 생각해도 돼. 천사쨩 기다릴게~',
      '감 왔어? 안 왔으면 힌트 하나 더!',
    ],
    judging: [
      '두근두근… 맞은 거야?! ♡',
      '제발 맞아줘!! 천사쨩 심장 터질 것 같아♡',
      '으으… 긴장돼! 맞았으면 좋겠는데…♡',
      '잠깐만— 확인하는 중이야, 기다려!!♡',
    ],
    loading: [
      '잠깐만~ 천사쨩이 문제 고르는 중이야♡',
      '으음… 어떤 걸 숨길까~ 기대해줘!♡',
      '좋은 힌트 만드는 건 시간이 걸려! 조금만♡',
      '거의 다 됐어! 아마도…♡',
      '뭘 출제할지 고민 중이야~ 잠시만♡',
      '천사쨩 열심히 생각하는 중! 기다려줘♡',
    ],
  },
  ame: {
    intro: [
      '…문제 냈어. 맞혀봐. 별 기대는 안 해.',
      '정답은 숨겨뒀어. …찾을 수 있겠어?',
      '힌트는 조금씩만 줄게. …많이 보면 지는 거야.',
      '…시작할게. 조용히 따라와.',
    ],
    hint: [
      '…힌트. 이걸로 알겠어?',
      '하나 더. …너무 의지하진 마.',
      '…이 정도면 감이 올 텐데.',
      '다음 힌트야. …잘 봐둬.',
    ],
    correct: [
      '…맞았어. 제법이네.',
      '정답. …조금 놀랐어.',
      '…그래, 그거야. 잘했어.',
      '맞혔네. …나쁘지 않아.',
    ],
    wrong: [
      '…아니야. 다시.',
      '틀렸어. …그럴 줄 알았어.',
      '음… 그건 아니야.',
      '…아니라니까. 더 생각해.',
    ],
    eliminated: [
      '…끝났어. 정답은 이거였어.',
      '못 맞혔네. …역시 어려웠나.',
      '…힌트를 다 써버렸어. 정답 알려줄게.',
    ],
    win: [
      '…클리어. 잘했어, 정말.',
      '풀었네. …나도 기뻐. 조금.',
      '…인정할게. 훌륭했어.',
    ],
    idle: [
      '…아직 거기 있어? 정답 말해도 돼.',
      '천천히 해. …기다릴 테니까.',
      '…힌트 열거나, 추측하거나. 골라.',
    ],
    judging: [
      '…맞았어? 제발.',
      '…두근두근. 결과 나오면 바로 알려줄게.',
      '…판정 중. 숨 참아.',
      '…제발 맞아라.',
    ],
    loading: [
      '…생각하는 중이야. 기다려.',
      '…금방 돼. 조용히 있어.',
      '좋은 문제는 쉽지 않아… 잠깐만.',
      '…아직이야. 조금만 더.',
      '힌트 배치하는 중이야… 곧.',
      '…서두르지 마. 제대로 만들어줄게.',
    ],
  },
};

const TRANSFORM_LINE: Record<Form, string> = {
  choten: '변신— ☆ 초절정☆귀염뽀짝☆천사쨩, 등장!♡',
  ame:    '…가면, 벗을게. 이게 진짜 나야.',
};

function pick(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const Mascot = forwardRef<MascotHandle>(function Mascot(_props, ref) {
  const rootRef   = useRef<HTMLDivElement>(null);
  const imgRef    = useRef<HTMLImageElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const formRef   = useRef<Form>('choten');
  const summonedRef   = useRef(false);
  const bubbleTimer   = useRef<number | null>(null);
  const idleTimer     = useRef<number | null>(null);

  const [renderTick, setRenderTick] = useState(0);

  function setImg(kind: LineKind) {
    if (imgRef.current) {
      imgRef.current.src = LINE_IMAGES[formRef.current][kind];
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
    say(pick(bank));
  }

  function bumpIdle() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (summonedRef.current) { event('idle'); bumpIdle(); }
    }, 45000);
  }

  function setForm(name: Form) {
    formRef.current = name;
    if (imgRef.current) imgRef.current.src = FORMS[name].img;
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
        event('idle');
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
          천사쨩 (이미지 없음)<small>public/char/ 에 넣어주세요</small>
        </div>
      </div>
    </div>
  );
});

export default Mascot;
