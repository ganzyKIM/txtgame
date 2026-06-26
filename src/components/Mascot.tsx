import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* ════════════════════════════════════════════════════════════════════
   Mascot — 쵸텐(천사쨩) ⟷ 아메, 퀴즈 진행자
   ════════════════════════════════════════════════════════════════════ */

export type Form = 'choten' | 'ame';
export type LineKind = 'intro' | 'hint' | 'correct' | 'wrong' | 'eliminated' | 'win' | 'idle' | 'loading' | 'judging' | 'close'
  | 'soup_intro' | 'soup_yes' | 'soup_no' | 'soup_irrelevant' | 'soup_solve' | 'soup_reveal' | 'soup_hint';

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
    intro:          '/char/choten_default.png',
    hint:           '/char/choten_peace.png',
    correct:        '/char/choten_dere.png',
    wrong:          '/char/choten_angry.png',
    eliminated:     '/char/choten_angry.png',
    win:            '/char/choten_dere.png',
    idle:           '/char/choten_vape.png',
    loading:        '/char/choten_vape.png',
    judging:        '/char/choten_dere.png',
    close:          '/char/choten_angry.png',
    soup_intro:     '/char/choten_default.png',
    soup_yes:       '/char/choten_dere.png',
    soup_no:        '/char/choten_angry.png',
    soup_irrelevant:'/char/choten_vape.png',
    soup_solve:     '/char/choten_dere.png',
    soup_reveal:    '/char/choten_angry.png',
    soup_hint:      '/char/choten_peace.png',
  },
  ame: {
    intro:          '/char/ame_default.png',
    hint:           '/char/ame_smoking.png',
    correct:        '/char/ame_dere.png',
    wrong:          '/char/ame_yandere.png',
    eliminated:     '/char/ame_yandere.png',
    win:            '/char/ame_dere.png',
    idle:           '/char/ame_smoking.png',
    loading:        '/char/ame_smoking.png',
    judging:        '/char/ame_drug.png',
    close:          '/char/ame_drug.png',
    soup_intro:     '/char/ame_default.png',
    soup_yes:       '/char/ame_dere.png',
    soup_no:        '/char/ame_yandere.png',
    soup_irrelevant:'/char/ame_smoking.png',
    soup_solve:     '/char/ame_dere.png',
    soup_reveal:    '/char/ame_yandere.png',
    soup_hint:      '/char/ame_drug.png',
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
      '뭐해뭐해?! 천사쨩이 여기 있잖아~♡',
      '퀴즈 한 판 해봐! 천사쨩이 기다리고 있어♡',
      '심심하면 문제 풀자구! 재밌는 거 있어♡',
      'P~ 빨리 시작해! 천사쨩이 낼게♡',
      '천사쨩 여기 있어용~ 말 걸어줘서 기뻐♡',
      '오늘도 잘 부탁해요~ 천사쨩이에요♡',
      '오늘은 어떤 문제 풀지 기대돼!♡',
      '천사쨩이랑 퀴즈왕 되어보자구♡',
      '말 걸어줬다!! 천사쨩 기뻐서 날아갈 것 같아♡',
      '심심하지? 천사쨩이 있잖아~♡',
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
    close: [
      '안 돼~!! 내 허락 없인 절대 못 나가!♡',
      '잠깐!! 우리 아직 덜 놀았잖아~!!♡',
      '어딜 가려고~? 천사쨩이 허락해야 나갈 수 있어!♡',
    ],
    soup_intro: [
      '이 수수께끼, 왜 그런 일이 생겼는지 알겠어?♡ 예/아니오로 물어봐!',
      '자자자!! 비밀이 숨어있어~ 천사쨩한테 질문해봐♡',
      '겉만 보면 이상하지? 진상은 아주 납득이 가는 거야♡ 캐내봐!',
      '수수께끼~ 어떤 트릭이 숨어있을까♡ 천천히 파헤쳐봐!',
      '힌트는 예/아니오로만이야! 핵심을 꿰뚫어봐♡',
    ],
    soup_yes: [
      '맞아맞아!! 예!!♡',
      '오~ 정확해! 예야!♡',
      '그래! 잘 잡아냈어♡',
      '예!! 날카로운데?♡',
      '딩동~ 맞아!! 가까워지고 있어♡',
    ],
    soup_no: [
      '아니야~! 다른 방향으로 생각해봐♡',
      '땡— 아니야!♡ 다시 생각해봐!',
      '으흠… 그건 아니라구!',
      '아니아니~ 다른 시각으로 봐봐♡',
      '노노노! 관점을 바꿔봐야 해♡',
    ],
    soup_irrelevant: [
      '그건 이 사건이랑 별로 상관없어~ 다른 걸 물어봐♡',
      '흠~ 관련은 없지만 좋은 시도야♡ 핵심을 파봐!',
      '상관없는 거야~ 더 중요한 걸 찾아봐♡',
      '음… 그건 그다지 중요하지 않아! 다른 방향으로!♡',
    ],
    soup_solve: [
      '정답이이이야!!!♡♡ 진상을 완전히 꿰뚫었어!!',
      '오오오!! 맞혔어!!! 천사쨩 감동받았어♡',
      '완벽해!! 그게 진상이야!! 대천재♡',
      '맞아맞아맞아!!! 훌륭해!! 박수박수!!♡',
    ],
    soup_reveal: [
      '에이~ 포기야? 그럼 진상 알려줄게. 잘 들어봐♡',
      '아쉬워라… 다음엔 꼭 맞혀!♡ 진상은~',
      '으음~ 이번엔 어려웠나봐. 진상 공개!♡',
      '포기는 아쉽지만~ 납득이 가는 진상이야, 봐봐♡',
    ],
    soup_hint: [
      '알겠어~ 살짝만 알려줄게♡ 잘 들어봐!',
      '힌트 공개! 이걸로 감 잡아봐♡',
      '으음… 특별히 알려줄게! 천사쨩의 힌트야♡',
      '힌트 줄게~ 이거 보고 다시 생각해봐!♡',
      '여기서 힌트! 잘 활용해봐♡',
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
      '…뭐. 보고 싶었어?',
      '퀴즈나 하자. 어차피 할 거잖아.',
      '…심심해? 같이 있어줄게.',
      '빨리 문제 골라. 기다리는 거 별로 안 좋아.',
      '…나한테 말 거는 거야. 뭔데.',
      '하루종일 여기 있을 건데. …같이 해.',
      '…별로 안 기다린 거야. 그냥 있었을 뿐.',
      '…퀴즈, 아직 안 했잖아. 해.',
      '말 걸지 마— …아니, 말 걸어도 돼. 조금.',
      '…여기 있어. 언제든지.',
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
    close: [
      '…어딜. 내 허락 없이는 못 나가.',
      '나가고 싶으면 나한테 물어봐. 아직 안 돼.',
      '…닫지 마. 우리 아직 안 끝났거든.',
    ],
    soup_intro: [
      '…이 상황, 뭔가 이상하지? 찾아봐.',
      '비밀이 있어. 질문으로 캐내봐.',
      '…진상은 꽁꽁 숨겨뒀어. 각오해.',
      '수수께끼야. …예/아니오로만 물어봐.',
      '…잘 생각해. 보이는 게 전부가 아니야.',
    ],
    soup_yes: [
      '…맞아.',
      '예. …예리하네.',
      '그래. …계속해.',
      '…맞아. 가까워지고 있어.',
      '예. …좋은 질문이었어.',
    ],
    soup_no: [
      '…아니야.',
      '아니오. …방향이 틀렸어.',
      '…아니라니까.',
      '다시 생각해. …아니야.',
      '…아니야. 착각하지 마.',
    ],
    soup_irrelevant: [
      '…그건 관계없어.',
      '상관없어. 핵심을 찾아.',
      '…그건 중요하지 않아.',
      '…질문 방향을 바꿔.',
    ],
    soup_solve: [
      '…맞혔어. 대단해, 진짜로.',
      '정답이야. …인정할게. 훌륭했어.',
      '…꿰뚫었네. 나도 놀랐어.',
      '…맞아. 그게 진상이야. 잘했어.',
    ],
    soup_reveal: [
      '…포기야? 그럼 진상 알려줄게.',
      '아쉽네. …잘 들어.',
      '…진상이야. 납득이 가지?',
      '…포기하는 거야. 알려줄게.',
    ],
    soup_hint: [
      '…힌트야. 잘 써.',
      '어쩔 수 없네. …들어.',
      '…살짝만 알려줄게.',
      '힌트. …이걸로 생각해봐.',
      '…도움이 됐으면 해.',
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
