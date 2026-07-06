import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* ════════════════════════════════════════════════════════════════════
   Mascot — 쵸텐(초텐쨩) ⟷ 아메, 퀴즈 진행자
   ════════════════════════════════════════════════════════════════════ */

export type Form = 'choten' | 'ame';
export type LineKind = 'intro' | 'hint' | 'correct' | 'wrong' | 'eliminated' | 'win' | 'idle' | 'loading' | 'judging' | 'close'
  | 'soup_intro' | 'soup_yes' | 'soup_no' | 'soup_irrelevant' | 'soup_solve' | 'soup_reveal' | 'soup_hint'
  | 'mp_lobby' | 'mp_start' | 'mp_round' | 'mp_correct' | 'mp_rival_correct' | 'mp_timeout' | 'mp_lasthint' | 'mp_loading' | 'mp_win' | 'mp_rank' | 'mp_allgiveup'
  | 'office_exit';

export interface MascotHandle {
  say: (text: string, holdMs?: number) => void;
  event: (kind: LineKind) => void;
  summon: () => void;
  banish: () => void;
  transform: () => void;
  isSummoned: () => boolean;
}

const FORMS: Record<Form, { img: string; name: string; cls: string }> = {
  choten: { img: '/char/choten_default.png', name: '초텐쨩', cls: 'form-choten' },
  ame:    { img: '/char/ame_default.png',    name: '아메',   cls: 'form-ame'    },
};

const LINE_IMAGES: Record<Form, Record<LineKind, string>> = {
  choten: {
    intro:            '/char/choten_default.png',
    hint:             '/char/choten_peace.png',
    correct:          '/char/choten_dere.png',
    wrong:            '/char/choten_angry.png',
    eliminated:       '/char/choten_angry.png',
    win:              '/char/choten_dere.png',
    idle:             '/char/choten_vape.png',
    loading:          '/char/choten_vape.png',
    judging:          '/char/choten_dere.png',
    close:            '/char/choten_angry.png',
    soup_intro:       '/char/choten_default.png',
    soup_yes:         '/char/choten_dere.png',
    soup_no:          '/char/choten_angry.png',
    soup_irrelevant:  '/char/choten_vape.png',
    soup_solve:       '/char/choten_dere.png',
    soup_reveal:      '/char/choten_angry.png',
    soup_hint:        '/char/choten_peace.png',
    mp_lobby:         '/char/choten_default.png',
    mp_start:         '/char/choten_peace.png',
    mp_round:         '/char/choten_peace.png',
    mp_correct:       '/char/choten_dere.png',
    mp_rival_correct: '/char/choten_angry.png',
    mp_timeout:       '/char/choten_vape.png',
    mp_lasthint:      '/char/choten_angry.png',
    mp_loading:       '/char/choten_vape.png',
    mp_win:           '/char/choten_dere.png',
    mp_rank:          '/char/choten_peace.png',
    mp_allgiveup:     '/char/choten_default.png',
    office_exit:      '/char/choten_angry.png',
  },
  ame: {
    intro:            '/char/ame_default.png',
    hint:             '/char/ame_smoking.png',
    correct:          '/char/ame_dere.png',
    wrong:            '/char/ame_yandere.png',
    eliminated:       '/char/ame_yandere.png',
    win:              '/char/ame_dere.png',
    idle:             '/char/ame_smoking.png',
    loading:          '/char/ame_smoking.png',
    judging:          '/char/ame_drug.png',
    close:            '/char/ame_drug.png',
    soup_intro:       '/char/ame_default.png',
    soup_yes:         '/char/ame_dere.png',
    soup_no:          '/char/ame_yandere.png',
    soup_irrelevant:  '/char/ame_smoking.png',
    soup_solve:       '/char/ame_dere.png',
    soup_reveal:      '/char/ame_yandere.png',
    soup_hint:        '/char/ame_drug.png',
    mp_lobby:         '/char/ame_default.png',
    mp_start:         '/char/ame_smoking.png',
    mp_round:         '/char/ame_smoking.png',
    mp_correct:       '/char/ame_dere.png',
    mp_rival_correct: '/char/ame_yandere.png',
    mp_timeout:       '/char/ame_smoking.png',
    mp_lasthint:      '/char/ame_yandere.png',
    mp_loading:       '/char/ame_smoking.png',
    mp_win:           '/char/ame_dere.png',
    mp_rank:          '/char/ame_drug.png',
    mp_allgiveup:     '/char/ame_drug.png',
    office_exit:      '/char/ame_yandere.png',
  },
};

/** 터치(클릭) 시 대사별로 다른 이미지를 보여주기 위한 idle 전용 변형 */
const IDLE_VARIANTS: Record<Form, { text: string; img: string }[]> = {
  choten: [
    { text: '뭐해뭐해?! 초텐쨩이 여기 있잖아~♡',          img: '/char/choten_default.png' },
    { text: '퀴즈 한 판 해봐! 초텐쨩이 기다리고 있어♡',    img: '/char/choten_peace.png'   },
    { text: '심심하면 문제 풀자구! 재밌는 거 있어♡',        img: '/char/choten_peace.png'   },
    { text: 'P~ 빨리 시작해! 초텐쨩이 낼게♡',              img: '/char/choten_angry.png'   },
    { text: '초텐쨩 여기 있어용~ 말 걸어줘서 기뻐♡',       img: '/char/choten_dere.png'    },
    { text: '오늘도 잘 부탁해요~ 초텐쨩이에요♡',           img: '/char/choten_default.png' },
    { text: '오늘은 어떤 문제 풀지 기대돼!♡',              img: '/char/choten_dere.png'    },
    { text: '초텐쨩이랑 퀴즈왕 되어보자구♡',               img: '/char/choten_peace.png'   },
    { text: '말 걸어줬다!! 초텐쨩 기뻐서 날아갈 것 같아♡', img: '/char/choten_dere.png'    },
    { text: '심심하지? 초텐쨩이 있잖아~♡',                 img: '/char/choten_vape.png'    },
  ],
  ame: [
    { text: '…뭐. 보고 싶었어?',                      img: '/char/ame_default.png'  },
    { text: '퀴즈나 하자. 어차피 할 거잖아.',          img: '/char/ame_smoking.png'  },
    { text: '…심심해? 같이 있어줄게.',                 img: '/char/ame_default.png'  },
    { text: '빨리 문제 골라. 기다리는 거 별로 안 좋아.', img: '/char/ame_yandere.png' },
    { text: '…나한테 말 거는 거야. 뭔데.',             img: '/char/ame_smoking.png'  },
    { text: '하루종일 여기 있을 건데. …같이 해.',      img: '/char/ame_dere.png'     },
    { text: '…별로 안 기다린 거야. 그냥 있었을 뿐.',   img: '/char/ame_dere.png'     },
    { text: '…퀴즈, 아직 안 했잖아. 해.',              img: '/char/ame_yandere.png'  },
    { text: '말 걸지 마— …아니, 말 걸어도 돼. 조금.', img: '/char/ame_drug.png'     },
    { text: '…여기 있어. 언제든지.',                   img: '/char/ame_smoking.png'  },
  ],
};

const LINES: Record<Form, Record<LineKind, string[]>> = {
  choten: {
    intro: [
      '자, P! 초텐쨩이 문제 하나 숨겨놨어! 맞혀봐♡',
      '오늘의 정답은 비밀이야~ 힌트 보고 맞혀줘!',
      '준비됐어? 초텐쨩이 낸 문제, 적게 보고 맞히면 칭찬해줄게♡',
      '집중집중! 힌트는 조금씩만 열어야 고득점이야!',
    ],
    hint: [
      '힌트 하나 더 줄게~ 잘 봐♡',
      '이거면 감 오지 않아? 초텐쨩 친절하지?♡',
      '자, 다음 힌트! 너무 많이 열면 안 돼~',
      '조금씩 가까워지고 있어! 힘내!',
    ],
    correct: [
      '정답이야!! 역시 P 똑똑해!♡',
      '딩동댕~! 초텐쨩 감동했어!',
      '맞혔어!! 봤지? 우리 P 천재라니까♡',
      '대단해! 이렇게 빨리 맞히다니!♡',
    ],
    wrong: [
      '땡! 아쉽다… 다시 생각해봐!',
      '음~ 그건 아니야. 힌트 더 볼래?',
      '아깝다! 조금만 더 고민해봐♡',
      '아니야아니야~ 초텐쨩 믿고 다시!',
    ],
    eliminated: [
      '으앙… 이번엔 못 맞혔네. 정답 알려줄게…',
      '힌트를 너무 많이 썼어… 다음엔 더 잘하자!',
      '아쉬워라… 그래도 초텐쨩이랑 또 하자, 응?',
    ],
    win: [
      '클리어~!♡ 초텐쨩이 박수 쳐줄게! 짝짝짝!',
      '해냈다! P 최고야!♡',
      '완벽한 추리였어! 자랑스러워!♡',
    ],
    idle: [
      '뭐해뭐해?! 초텐쨩이 여기 있잖아~♡',
      '퀴즈 한 판 해봐! 초텐쨩이 기다리고 있어♡',
      '심심하면 문제 풀자구! 재밌는 거 있어♡',
      'P~ 빨리 시작해! 초텐쨩이 낼게♡',
      '초텐쨩 여기 있어용~ 말 걸어줘서 기뻐♡',
      '오늘도 잘 부탁해요~ 초텐쨩이에요♡',
      '오늘은 어떤 문제 풀지 기대돼!♡',
      '초텐쨩이랑 퀴즈왕 되어보자구♡',
      '말 걸어줬다!! 초텐쨩 기뻐서 날아갈 것 같아♡',
      '심심하지? 초텐쨩이 있잖아~♡',
    ],
    judging: [
      '두근두근… 맞은 거야?! ♡',
      '제발 맞아줘!! 초텐쨩 심장 터질 것 같아♡',
      '으으… 긴장돼! 맞았으면 좋겠는데…♡',
      '잠깐만— 확인하는 중이야, 기다려!!♡',
    ],
    loading: [
      '잠깐만~ 초텐쨩이 문제 고르는 중이야♡',
      '으음… 어떤 걸 숨길까~ 기대해줘!♡',
      '좋은 힌트 만드는 건 시간이 걸려! 조금만♡',
      '거의 다 됐어! 아마도…♡',
      '뭘 출제할지 고민 중이야~ 잠시만♡',
      '초텐쨩 열심히 생각하는 중! 기다려줘♡',
    ],
    close: [
      '안 돼~!! 내 허락 없인 절대 못 나가!♡',
      '잠깐!! 우리 아직 덜 놀았잖아~!!♡',
      '어딜 가려고~? 초텐쨩이 허락해야 나갈 수 있어!♡',
    ],
    soup_intro: [
      '이 수수께끼, 왜 그런 일이 생겼는지 알겠어?♡ 예/아니오로 물어봐!',
      '자자자!! 비밀이 숨어있어~ 초텐쨩한테 질문해봐♡',
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
      '오오오!! 맞혔어!!! 초텐쨩 감동받았어♡',
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
      '으음… 특별히 알려줄게! 초텐쨩의 힌트야♡',
      '힌트 줄게~ 이거 보고 다시 생각해봐!♡',
      '여기서 힌트! 잘 활용해봐♡',
    ],
    mp_lobby: [
      '대합전이다~!! 초텐쨩이랑 같이 싸워봐!♡',
      '다같이 문제 푸는 거야? 신나~!♡',
      '대합전 참가 완료~! 모두 반가워요♡',
      '라이벌들 모였네! 지지 않을 거야~!!♡',
    ],
    mp_start: [
      '자자자~ 게임 시작!! 빠르게 맞히는 사람이 이기는 거야!♡',
      '라운드 1, 개시~!! 집중집중! 초텐쨩이 응원할게♡',
      '드디어 시작이야~!! 파이팅!! 초텐쨩도 두근두근♡',
    ],
    mp_round: [
      '다음 라운드~!! 분발해봐!♡',
      '새 문제 출제! 이번엔 꼭 먼저 맞혀~!♡',
      '다음 라운드 가자! 포기하지 마~♡',
      '기회가 또 왔어! 이번엔 놓치지 마!♡',
    ],
    mp_correct: [
      '정답~!! 역시 우리 P!!! 초텐쨩 감동받았어♡♡',
      '이겼다이겼다~!!! 이번 라운드 완전 우리 거야!!♡',
      '완벽해~!! 역시 최고야!! 초텐쨩이 젤 좋아해♡',
    ],
    mp_rival_correct: [
      '앗… 다른 사람이 먼저 맞혔어! 억울하다!! 다음 라운드 가자!♡',
      '에이~ 아깝다!! 한 발 늦었어!! 다음엔 반드시~!!♡',
      '빼앗겼어… 분해!! 다음 거 꼭 먼저 맞힐 거야!!♡',
    ],
    mp_timeout: [
      '이번엔 아무도 못 맞혔네… 어려웠나봐! 다음 가자♡',
      '전원 탈락~! 이런 문제도 있는 거야! 정답 공개!♡',
      '아쉽다~ 다음 라운드 더 잘하자!♡',
    ],
    mp_lasthint: [
      '마지막 힌트야~!! 지금 아니면 끝이야!! 집중!!♡',
      '마지막 기회~!! 이거 보고 반드시 맞혀줘!!♡',
      '라스트 힌트 공개!! 다 쏟아부어~!!♡',
    ],
    mp_loading: [
      '다음 문제 만드는 중~ 잠깐 기다려줘!♡',
      '좋은 문제 고르는 중이야~ 기대해봐!♡',
      '다음 라운드 준비 중… 마음의 준비 해놔!♡',
      '거의 다 됐어~ 조금만~!♡',
    ],
    mp_win: [
      '우우승~!!!!♡♡ 최고야 최고!! 초텐쨩이 젤 좋아하는 결과야~!!♡',
      '1등이다~!! 박수박수박수!!♡♡♡ 역시 P 천재라니까!!',
      '퀴즈왕 등극~!! 이 기쁨 초텐쨩이랑 나눠~!!♡',
    ],
    mp_rank: [
      '고생했어~ 다음엔 더 잘할 수 있을 거야! 초텐쨩이 믿어♡',
      '아쉬웠지만 재밌었지?♡ 다음엔 반드시 우승하자!',
      '오늘은 졌지만 초텐쨩이랑 다음에 또 하자, 응?♡',
    ],
    mp_allgiveup: [
      '전원 포기~!? 어쩔 수 없네! 바로 다음 힌트 가자!♡',
      '다들 포기했어? 그럼 빨리 다음 힌트 공개~!♡',
      '전원 기권! 어렵긴 했나봐~ 힌트 더 줄게!♡',
    ],
    office_exit: [
      '뭐야뭐야, 나 숨기고 있었어?! 부끄러웠던 거야?! ...그래도 다시 만나서 좋아♡',
      '혹시 초텐쨩 창피해서 감췄던 거야?! 삐질 거야!! ...근데 반가운 건 반가운 거♡',
      '사회인 흉내 내는 동안 초텐쨩은 안 보이는 데 처박혀 있었잖아! 서운했어!! 그래도 좋아♡',
      '나 숨겨놨었지?! 다 알아!! ...흥, 봐줄게. 왜냐면 좋아하니까♡',
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
    mp_lobby: [
      '…대합전이야. 상대가 있는 건 좀 다르네.',
      '여럿이 하는 거야? …흥미롭네.',
      '…경쟁. 별로 지고 싶지 않아.',
      '…다들 만만하게 보지 마.',
    ],
    mp_start: [
      '…시작한다. 방심하지 마.',
      '게임 시작이야. …집중해.',
      '…손 빠른 사람이 이기는 거야. 준비해.',
    ],
    mp_round: [
      '…다음 라운드야. 계속해.',
      '새 문제가 나온다. …이번엔 먼저 맞혀.',
      '…포기하지 마. 아직 끝 아니야.',
      '다음 기회야. …잡아.',
    ],
    mp_correct: [
      '…맞혔어. 잘했어, 진짜로.',
      '정답이야. …나도 기뻐. 조금.',
      '…이번 라운드, 네 거야. 잘했어.',
    ],
    mp_rival_correct: [
      '…빼앗겼네. 다음엔 먼저 맞혀.',
      '다른 사람이 맞혔어. …분해.',
      '…졌어. 다음 라운드. 집중해.',
    ],
    mp_timeout: [
      '…아무도 못 맞혔어. 어렵긴 했나봐.',
      '다들 포기했네. …어쩔 수 없어. 정답 알려줄게.',
      '…이번엔 어려웠어. 다음 라운드.',
    ],
    mp_lasthint: [
      '…마지막 힌트야. 지금이야.',
      '마지막이야. …집중해. 놓치지 마.',
      '…이게 마지막 기회야. 잘 봐.',
    ],
    mp_loading: [
      '…다음 문제 만드는 중. 기다려.',
      '잠깐. …좋은 문제 고르는 중이야.',
      '…금방 돼. 그냥 있어.',
      '…서두르지 마. 제대로 만들어줄게.',
    ],
    mp_win: [
      '…1등. 역시 그렇게 됐군.',
      '이겼어. …솔직히 기뻐. 꽤.',
      '…잘했어. 나도 만족했어.',
    ],
    mp_rank: [
      '…아쉬웠어. 다음엔 이길게.',
      '졌네. …별로 안 아쉽다고 하면 거짓말이야.',
      '…다음엔 더 잘하자. 같이.',
    ],
    mp_allgiveup: [
      '…전원 포기야. 다음 힌트 간다.',
      '다들 포기했어. …어쩔 수 없네. 힌트 더 줄게.',
      '…전원 기권. 계속 가자.',
    ],
    office_exit: [
      '…숨겼던 거야? 부끄러웠어? …흥, 그래도 돌아왔네.',
      '…나 창피해서 감췄지. 순순히 인정해.',
      '…어디 숨어있었냐고 안 물을게. 대신 이제 안 놔줄 거야.',
      '…혼자 처박아두고 미안한 줄은 아나 몰라. …그래도, 왔네.',
    ],
  },
};

const TRANSFORM_LINE: Record<Form, string> = {
  choten: '변신— ☆ 초절정☆귀염뽀짝☆초텐쨩, 등장!♡',
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
        const variants = IDLE_VARIANTS[formRef.current];
        const v = variants[Math.floor(Math.random() * variants.length)];
        if (imgRef.current) imgRef.current.src = v.img;
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
