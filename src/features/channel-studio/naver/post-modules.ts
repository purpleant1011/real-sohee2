export const POST_FORMAT_IDS = [
  'information',
  'faq',
  'comparison',
  'consultation',
  'photo_story',
  'process',
  'place_tour',
] as const;

export type PostFormatId = (typeof POST_FORMAT_IDS)[number];

export type PostFormatModule = Readonly<{
  id: PostFormatId;
  label: string;
  summary: string;
  imageMin: number;
  imageMax: number;
  imageDefault: number;
  textDensity: 'rich' | 'balanced' | 'light';
  structureGuidance: readonly string[];
}>;

export const POST_FORMAT_MODULES: readonly PostFormatModule[] = [
  {
    id: 'information',
    label: '정보형',
    summary: '핵심 팁과 정보를 깊이 있게 전달하는 표준 글',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 4,
    textDensity: 'rich',
    structureGuidance: [
      '도입부에서 독자가 공감할 만한 일상 속 궁금증이나 상황을 제시합니다.',
      '본문은 2~3개의 소제목으로 명확히 구분하여 실질적인 지식과 도움말을 정리합니다.',
      '각 문단 사이에 관련 사진을 배치하고, 설명글은 4~6줄 내외로 충실하게 서술합니다.',
      '마무리에서는 핵심 요약과 함께 독자가 참고할 수 있는 팁을 정리합니다.',
    ],
  },
  {
    id: 'faq',
    label: 'FAQ형',
    summary: '고객이 자주 묻는 질문을 문답 형태로 명쾌하게 정리한 글',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 4,
    textDensity: 'rich',
    structureGuidance: [
      '도입부에서 매장을 찾는 분들이 자주 궁금해하시는 대표 질문을 소개합니다.',
      '소제목마다 명확한 질문(Q)을 달고 그에 대한 친절한 답변(A)을 단계적으로 설명합니다.',
      '질문별 핵심 맥락을 뒷받침하는 시각 자료나 사진을 하나씩 배치합니다.',
      '끝맺음에서는 추가로 궁금한 점을 편하게 남길 수 있도록 유도합니다.',
    ],
  },
  {
    id: 'comparison',
    label: '비교형',
    summary: '상황별 선택 기준이나 차이점을 알기 쉽게 짚어주는 글',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 4,
    textDensity: 'balanced',
    structureGuidance: [
      '도입부에서 선택을 앞두고 고민하는 상황을 친근하게 짚어줍니다.',
      '각 선택지의 특징, 어울리는 상황, 체크포인트를 균형 잡힌 시각으로 비교합니다.',
      '선택지별 대표 장면이나 차이점을 보여주는 사진을 나란히 배치합니다.',
      '본인에게 잘 맞는 방식을 선택하도록 기준을 안내하며 마무리합니다.',
    ],
  },
  {
    id: 'consultation',
    label: '상담형',
    summary: '실제 고민 사례와 해결 접근 방식을 공감하며 들려주는 글',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 4,
    textDensity: 'balanced',
    structureGuidance: [
      '방문 전 독자들이 흔히 겪는 고민 사례를 따뜻하고 섬세한 어조로 시작합니다.',
      '어떤 과정을 거쳐 맞춤형으로 안내하고 진행했는지 단계별로 풀어냅니다.',
      '단계마다 실제 진행 맥락이나 분위기를 보여주는 사진을 더합니다.',
      '비슷한 고민을 가진 분들에게 도움이 되는 조언을 전하며 마무리합니다.',
    ],
  },
  {
    id: 'photo_story',
    label: '포토스토리',
    summary: '많은 사진과 2~3줄의 짧은 코멘트로 시선을 사로잡는 시각 중심 글',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 12,
    textDensity: 'light',
    structureGuidance: [
      '도입 2~3줄 → 사진 → 120자 이내 한마디를 반복하는 리듬감 있는 구성을 유지합니다.',
      '글 전체에서 긴 설명문 대신 사진을 보는 맛을 살리고 소제목은 0~3개로 최소화합니다.',
      '사진마다 현장감 있는 디테일과 감상을 2~3줄 내외로 간결하게 붙입니다.',
      '마무리는 산뜻한 짧은 한마디 소감으로 담백하게 마칩니다.',
    ],
  },
  {
    id: 'process',
    label: '과정 소개형',
    summary: '정성스러운 작업 순서와 제작 과정을 단계별로 보여주는 글',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 6,
    textDensity: 'balanced',
    structureGuidance: [
      '도입부에서 해당 작업이나 메뉴를 준비하게 된 계기를 밝힙니다.',
      '순서(1단계, 2단계 등)에 따라 단계별 사진과 함께 2~4줄의 짧은 설명을 배치합니다.',
      '각 단계에서 정성을 쏟는 포인트나 노하우를 솔직하게 들려줍니다.',
      '완성된 결과물 사진과 함께 정성을 전하며 마무리합니다.',
    ],
  },
  {
    id: 'place_tour',
    label: '공간 둘러보기',
    summary: '입구부터 내부, 아늑한 포인트까지 걸어가듯 보여주는 랜선 투어',
    imageMin: 1,
    imageMax: 20,
    imageDefault: 8,
    textDensity: 'light',
    structureGuidance: [
      '입구와 외관부터 시작해 내부 공간, 세부 포인트 순으로 발걸음 닿듯 이동합니다.',
      '사진 위주로 공간의 무드와 편안함을 보여주며 설명은 사진 아래 1~3줄로 가볍게 적습니다.',
      '매장 구석구석 정성이 담긴 소품이나 분위기 있는 공간을 조명합니다.',
      '방문 시 편하게 머물 수 있는 동선이나 시간대를 살짝 일러주며 마칩니다.',
    ],
  },
] as const;

export const POST_REACTION_IDS = [
  'inquiry',
  'save_share',
  'visit',
  'trust',
  'comment',
] as const;

export type PostReactionId = (typeof POST_REACTION_IDS)[number];

export type PostReactionModule = Readonly<{
  id: PostReactionId;
  label: string;
  summary: string;
  ctaGuidance: string;
  closingGuidance: readonly string[];
}>;

export const POST_REACTION_MODULES: readonly PostReactionModule[] = [
  {
    id: 'inquiry',
    label: '문의·상담 유도',
    summary: '자연스러운 질문이나 궁금한 점을 편하게 남기도록 안내',
    ctaGuidance: '자연스러운 문의 한 번으로 이어지도록 편안한 소통 창구를 안내합니다.',
    closingGuidance: [
      '글을 읽고 더 알고 싶은 부분이 있다면 언제든 편하게 질문을 남겨달라고 전합니다.',
      '톡톡이나 유선 상담을 통해 상세한 안내를 받을 수 있음을 차분하게 덧붙입니다.',
    ],
  },
  {
    id: 'save_share',
    label: '저장·공유하고 싶은 정보',
    summary: '나중에 다시 찾아보거나 주변에 알려주고 싶은 실속 정보',
    ctaGuidance: '필요할 때 다시 꺼내보거나 지인에게 공유하기 좋은 유용한 내용임을 짚어줍니다.',
    closingGuidance: [
      '나중에 찾아볼 수 있도록 글을 스크랩하거나 저장해두면 편리하다는 점을 권합니다.',
      '비슷한 정보를 찾는 주변 분들에게도 도움이 될 수 있음을 조용히 전합니다.',
    ],
  },
  {
    id: 'visit',
    label: '방문 유도',
    summary: '매장의 위치와 따뜻한 분위기를 전해 직접 발걸음하도록 유도',
    ctaGuidance: '방문 시 편안하게 머무르실 수 있도록 찾아오는 길과 위치를 안내합니다.',
    closingGuidance: [
      '지하철역이나 주변 랜드마크 기준 찾아오시는 경로를 자연스럽게 덧붙입니다.',
      '매장에 발걸음하셨을 때 편안한 시간을 보내실 수 있도록 반갑게 맞이하겠다는 온도를 전합니다.',
    ],
  },
  {
    id: 'trust',
    label: '신뢰·이해 쌓기',
    summary: '사장님의 철학과 일에 대한 진정성으로 신뢰를 다지는 소통',
    ctaGuidance: '원칙과 기준을 솔직하게 나누어 자연스럽게 믿음을 쌓습니다.',
    closingGuidance: [
      '늘 한결같은 마음으로 정성을 다하겠다는 사장님의 소신을 솔직하게 나눕니다.',
      '글에 담긴 원칙을 지키며 정직하게 운영해나가겠다는 약속을 전합니다.',
    ],
  },
  {
    id: 'comment',
    label: '댓글·소통 유도',
    summary: '독자의 생각이나 경험을 묻고 댓글로 대화를 시작',
    ctaGuidance: '독자의 일상 경험이나 취향을 가볍게 묻고 댓글 소통을 제안합니다.',
    closingGuidance: [
      '독자분들은 어떤 방식을 더 선호하시는지 질문을 남겨달라고 요청합니다.',
      '공감되는 부분이나 더 나누고 싶은 이야기가 있다면 편안하게 댓글을 적어달라고 전합니다.',
    ],
  },
] as const;

export const POST_IMAGE_STYLE_IDS = [
  'bright_space',
  'detail_closeup',
  'process_shot',
  'mood_portrait',
  'store_photo',
] as const;

export type PostImageStyleId = (typeof POST_IMAGE_STYLE_IDS)[number];

export type PostImageStyleModule = Readonly<{
  id: PostImageStyleId;
  label: string;
  summary: string;
  promptHint: string;
  source: 'ai' | 'place';
}>;

export const POST_IMAGE_STYLE_MODULES: readonly PostImageStyleModule[] = [
  {
    id: 'bright_space',
    label: '밝은 공간',
    summary: '자연광이 가득하고 깔끔하며 쾌적한 매장 공간 연출',
    promptHint: 'Bright and airy space with natural sunlight, clean modern interior, warm welcoming ambience.',
    source: 'ai',
  },
  {
    id: 'detail_closeup',
    label: '디테일 클로즈업',
    summary: '질감과 재료, 세밀한 만듦새를 생생하게 포착한 컷',
    promptHint: 'Close-up detail shot highlighting texture, craftsmanship, and delicate materials in soft lighting.',
    source: 'ai',
  },
  {
    id: 'process_shot',
    label: '과정 컷',
    summary: '정성을 다해 다듬고 작업하는 생생한 현장 손길',
    promptHint: 'Hands-on preparation and craftsmanship process shot, authentic and natural movement.',
    source: 'ai',
  },
  {
    id: 'mood_portrait',
    label: '분위기 있는 인물 컷',
    summary: '단정하고 편안한 미소로 신뢰를 주는 인물과 공간',
    promptHint: 'Warm and natural portrait in work environment, gentle candid expression, pleasant tone.',
    source: 'ai',
  },
  {
    id: 'store_photo',
    label: '우리 매장 실제 사진',
    summary: '실제 등록된 매장 사진을 우선 활용하는 진정성 있는 컷',
    promptHint: 'Authentic store photograph showcasing real physical space and equipment.',
    source: 'place',
  },
] as const;

export type PostPlan = Readonly<{
  format: PostFormatId;
  reaction: PostReactionId;
  imageStyle: PostImageStyleId;
  imageCount: number;
}>;

export function getPostFormat(id: string): PostFormatModule | undefined {
  return POST_FORMAT_MODULES.find((m) => m.id === id);
}

export function getPostReaction(id: string): PostReactionModule | undefined {
  return POST_REACTION_MODULES.find((m) => m.id === id);
}

export function getPostImageStyle(id: string): PostImageStyleModule | undefined {
  return POST_IMAGE_STYLE_MODULES.find((m) => m.id === id);
}

export function isPhotoHeavy(formatId: string): boolean {
  return formatId === 'photo_story' || formatId === 'place_tour';
}

export function clampImageCount(formatId: string, count: number): number {
  const format = getPostFormat(formatId);
  const min = format ? format.imageMin : 1;
  const max = format ? format.imageMax : 20;

  if (Number.isNaN(count) || count < min) {
    return min;
  }
  if (count > max) {
    return max;
  }
  return Math.floor(count);
}

export function defaultPostPlan(): PostPlan {
  const defaultFormat = POST_FORMAT_MODULES[0];
  const defaultReaction = POST_REACTION_MODULES[0];
  const defaultImageStyle = POST_IMAGE_STYLE_MODULES[0];

  return {
    format: defaultFormat.id,
    reaction: defaultReaction.id,
    imageStyle: defaultImageStyle.id,
    imageCount: defaultFormat.imageDefault,
  };
}

export function resolvePostPlan(partial?: Partial<PostPlan> | null): PostPlan {
  const defaults = defaultPostPlan();
  const formatId = partial?.format && getPostFormat(partial.format) ? partial.format : defaults.format;
  const format = getPostFormat(formatId)!;

  const reaction = partial?.reaction && getPostReaction(partial.reaction) ? partial.reaction : defaults.reaction;
  const imageStyle = partial?.imageStyle && getPostImageStyle(partial.imageStyle)
    ? partial.imageStyle
    : defaults.imageStyle;

  const rawCount = partial?.imageCount !== undefined ? partial.imageCount : format.imageDefault;
  const imageCount = clampImageCount(formatId, rawCount);

  return {
    format: formatId,
    reaction,
    imageStyle,
    imageCount,
  };
}

export function buildPlanPromptGuidance(plan: PostPlan): readonly string[] {
  const format = getPostFormat(plan.format) ?? getPostFormat('information')!;
  const reaction = getPostReaction(plan.reaction) ?? getPostReaction('inquiry')!;
  const imageStyle = getPostImageStyle(plan.imageStyle) ?? getPostImageStyle('bright_space')!;

  const lines: string[] = [
    `[글 구조 지침: ${format.label} (${format.textDensity} 모드)]`,
    ...format.structureGuidance,
    `[독자 반응 유도 지침: ${reaction.label}]`,
    reaction.ctaGuidance,
    ...reaction.closingGuidance,
    `[이미지 연출 스타일 지침: ${imageStyle.label}]`,
    `이미지 연출 방향: ${imageStyle.promptHint}`,
  ];

  return lines;
}
