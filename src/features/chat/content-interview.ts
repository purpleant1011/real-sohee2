import { z } from 'zod'
import { marketingStrategyReferenceSchema } from './marketing-strategy-schema'
import type { ConversationPostPurpose } from './conversation-post-intent'

export const INTERVIEW_INTRODUCTION =
  '안녕하세요, 대표님. 원하는 방향을 정확히 이해하기 위해 몇 가지만 여쭤볼게요.'

export const EVENT_FACTS_QUESTION_TEXT = '이벤트(프로모션) 정보를 알려 주세요'
export const EVENT_FACTS_PLACEHOLDER = '예) 가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의'
export const UNKNOWN_INFO_INSTRUCTION =
  '이벤트 상세 정보(기간·혜택·참여 방법)가 제공되지 않은 경우, 날짜·가격·혜택을 임의로 지어내지 말고 점주에게 질문하거나 말을 걸지 마세요. 확인된 매장 정보만으로 사실적인 티저 문안을 작성하고, 사실 입력이 필요한 위치에만 [이벤트 기간]과 같이 명확한 대괄호 슬롯을 사용하세요.'

export const INTERVIEW_CHANNELS = [
  'instagram',
  'threads',
  'naver_blog',
  'daangn_business',
] as const

export type InterviewChannel = (typeof INTERVIEW_CHANNELS)[number]
export type InterviewStep = 1 | 2 | 3 | 4
export type InterviewQuestionKey = 'goal' | 'audience' | 'structure' | 'visualCta'
export type InterviewGroupKey = 'imageMood' | 'callToAction'

export type ImagePreferences = Readonly<{
  templateId: string
  modelAge: '20s' | '30s' | '40s' | '50plus'
  framing: 'face' | 'upper_body' | 'full_body'
  pose: 'front' | 'side' | 'explaining' | 'consulting' | 'relaxed'
  background: 'bright_studio' | 'warm_studio' | 'treatment_room' | 'natural_light' | 'product_space'
  textOverlay: 'none' | 'short_copy' | 'information'
  extraDirection?: string
  /** 사장님이 등록한 기준 사진 중 이번 글에 참고할 것(비우면 전체). */
  styleReferenceIds?: readonly string[]
}>

export type ImageTemplate = Readonly<{
  id: string
  label: string
  description: string
  imageSrc: string
  recommended: boolean
  defaults: Omit<ImagePreferences, 'templateId' | 'extraDirection'>
}>

export type ContentInterviewControl = Readonly<{
  kind: 'content_interview_control'
  action: 'start_generation' | 'quick_generate' | 'edit'
  step?: InterviewStep
}>

export type InterviewAnswer = Readonly<{
  value: string
  customText?: string
  source: 'option' | 'free_text'
}>

export type ContentVisualCtaAnswer = Readonly<{
  image: InterviewAnswer
  callToAction: InterviewAnswer
  imagePreferences?: ImagePreferences
}>

export type ContentBrief = Readonly<{
  channels: readonly InterviewChannel[]
  goal: Readonly<{ value: string; customText?: string }>
  audience: Readonly<{ value: string; customText?: string }>
  audienceProblem: string
  textDirection: Readonly<{
    structure: Readonly<{ value: string; customText?: string }>
    tone: string
    messageAngle: string
  }>
  imageDirection: Readonly<{
    mood: Readonly<{ value: string; customText?: string }>
    composition: string
    sceneRoles: readonly string[]
    avoid: readonly string[]
    templateId?: string
    modelAge?: ImagePreferences['modelAge']
    framing?: ImagePreferences['framing']
    pose?: ImagePreferences['pose']
    background?: ImagePreferences['background']
    textOverlay?: ImagePreferences['textOverlay']
    extraDirection?: string
    styleReferenceIds?: readonly string[]
  }>
  callToAction: Readonly<{ value: string; customText?: string }>
  mustInclude: readonly string[]
  mustAvoid: readonly string[]
  referenceMediaIds: readonly string[]
  eventFacts?: string
}>

export type ContentInterviewState = Readonly<{
  kind: 'content_interview'
  status: 'collecting' | 'ready_to_generate' | 'completed' | 'cancelled'
  step: InterviewStep
  originalPrompt: string
  channels: readonly InterviewChannel[]
  requestedImageCounts: Readonly<Record<string, number>>
  answers: Readonly<{
    goal?: InterviewAnswer
    audience?: InterviewAnswer
    structure?: InterviewAnswer
    visualCta?: ContentVisualCtaAnswer
    eventFacts?: InterviewAnswer
  }>
  referenceMediaIds: readonly string[]
  brief?: ContentBrief
  marketingStrategy?: z.infer<typeof marketingStrategyReferenceSchema>
  purpose?: ConversationPostPurpose
  pendingQuickGenerate?: boolean
}>

export type ContentInterviewView = Readonly<{
  kind: 'content_interview'
  status: ContentInterviewState['status']
  step: InterviewStep
  totalSteps: 4
  stepLabel?: string
  questionId?: 'eventFacts' | InterviewQuestionKey
  questionKind?: 'event_facts' | 'standard'
  question: string
  options: readonly Readonly<{ value: string; label: string }>[]
  optionGroups: readonly Readonly<{
    key: InterviewGroupKey
    label: string
    options: readonly Readonly<{ value: string; label: string }>[]
  }>[]
  imageTemplates?: readonly ImageTemplate[]
  previousAnswers: readonly Readonly<{
    step: InterviewStep
    label: string
    customText?: string
  }>[]
  summary?: Readonly<{
    channels: readonly string[]
    goal: string
    audience: string
    structure: string
    imageMood: string
    callToAction: string
    referenceMediaCount: number
    mustInclude: readonly string[]
    mustAvoid: readonly string[]
    audienceProblem: string
    tone: string
    messageAngle: string
    imageComposition: string
    sceneRoles: readonly string[]
    imageAvoid: readonly string[]
    imageTemplate?: string
    imageModelAge?: string
    imageFraming?: string
    imagePose?: string
    imageBackground?: string
    imageTextOverlay?: string
    imageExtraDirection?: string
    eventFacts?: string
  }>
}>

export function serializeContentInterviewControl(input: {
  action: ContentInterviewControl['action']
  step?: InterviewStep
}): string {
  return JSON.stringify({
    kind: 'content_interview_control',
    action: input.action,
    ...(input.step === undefined ? {} : { step: input.step }),
  })
}

export function parseContentInterviewControl(value: string): ContentInterviewControl | null {
  try {
    const parsed = contentInterviewControlSchema.safeParse(JSON.parse(value.trim()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

type InterviewOption = Readonly<{ value: string; label: string }>
type InterviewGroup = Readonly<{
  key: InterviewGroupKey
  label: string
  options: readonly InterviewOption[]
}>
type InterviewQuestion = Readonly<{
  key: InterviewQuestionKey
  stepLabel: `${InterviewStep} / 4`
  question: string
  options: readonly InterviewOption[]
  groups?: readonly InterviewGroup[]
}>

function frozenOptions(items: readonly InterviewOption[]): readonly InterviewOption[] {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })))
}

function frozenGroup(
  key: InterviewGroupKey,
  label: string,
  items: readonly InterviewOption[],
): InterviewGroup {
  return Object.freeze({ key, label, options: frozenOptions(items) })
}

export function goalAnswerFromPurpose(purpose: ConversationPostPurpose): InterviewAnswer {
  const goalMap: Record<ConversationPostPurpose, string> = {
    event: '이벤트 홍보',
    promotion: '프로모션 홍보',
    daily: '일상 소통',
    branding: '브랜드 홍보',
  }
  return Object.freeze({
    value: 'custom',
    customText: goalMap[purpose] ?? '목적에 맞는 콘텐츠 제작',
    source: 'free_text',
  })
}

export function isEventOrPromotionPurpose(state: {
  purpose?: ConversationPostPurpose
  answers?: ContentInterviewState['answers']
  originalPrompt?: string
}): boolean {
  if (state.purpose === 'event' || state.purpose === 'promotion') return true
  const goalText = state.answers?.goal?.customText
  if (goalText === '이벤트 홍보' || goalText === '프로모션 홍보') return true
  return false
}

export const EVENT_FACTS_OPTIONS: readonly InterviewOption[] = frozenOptions([
  { value: 'skip', label: '나중에 채울게요' },
])

export const goalOptions = frozenOptions([
  { value: 'consultation', label: '문의·예약을 늘리고 싶어요' },
  { value: 'portfolio', label: '실제 사례와 작업 결과를 보여주고 싶어요' },
  { value: 'expertise', label: '전문성과 신뢰를 알리고 싶어요' },
  { value: 'awareness', label: '자연스럽게 브랜드를 기억하게 하고 싶어요' },
  { value: 'announcement', label: '이벤트나 공지 내용을 알리고 싶어요' },
  { value: 'custom', label: '직접 입력할게요' },
])

export const audienceOptions = frozenOptions([
  { value: 'first_time', label: '처음 방문하는 고객' },
  { value: 'natural_design', label: '나에게 맞는 제안을 원하는 고객' },
  { value: 'balance', label: '품질과 완성도를 꼼꼼히 비교하는 고객' },
  { value: 'retouch', label: '단골 고객 및 재방문을 고려하는 고객' },
  { value: 'local', label: '매장 주변 지역에서 방문할 고객' },
  { value: 'custom', label: '직접 입력할게요' },
])

export const structureOptions = frozenOptions([
  { value: 'empathy_info_consult', label: '일상 고민 공감 → 맞춤 기준 설명 → 문의 안내' },
  { value: 'state_design_care', label: '현재 상황 확인 → 제안 기준 → 이용 방법과 문의 안내' },
  { value: 'faq_answer_cta', label: '자주 묻는 질문 → 이해하기 쉬운 답변 → 문의 유도' },
  { value: 'expertise_story', label: '전문성과 일하는 방식 중심' },
  { value: 'short_natural', label: '부담 없이 읽히는 짧고 자연스러운 소개글' },
  { value: 'custom', label: '직접 입력할게요' },
])

/** 업종 고정 템플릿 대신 이 작업공간이 등록한 이미지 스타일을 그대로 쓰는 선택지. */
export const WORKSPACE_STYLE_IMAGE_ID = 'workspace_style' as const

export const imageMoodOptions = frozenOptions([
  { value: WORKSPACE_STYLE_IMAGE_ID, label: '우리 매장 이미지 스타일 그대로' },
  { value: 'consultation', label: '자연스럽고 편안한 분위기' },
  { value: 'detail', label: '디테일과 완성도를 가까이 보여주는 장면' },
  { value: 'design_consult', label: '전문가가 기준을 설명하는 장면' },
  { value: 'studio', label: '편안하고 따뜻한 매장 분위기' },
  { value: 'assessment', label: '현재 상황을 차분하게 확인하는 장면' },
  { value: 'editorial', label: '핵심 문구를 함께 보여주는 정보형 이미지' },
  { value: 'custom', label: '직접 입력할게요' },
])

export const callToActionOptions = frozenOptions([
  { value: 'consult', label: '부담 없이 상담·예약 문의하기' },
  { value: 'check', label: '현재 상태나 고민을 먼저 확인해보기' },
  { value: 'share_preference', label: '원하는 스타일이나 분위기를 이야기해보기' },
  { value: 'explore', label: '매장 채널과 소식 더 둘러보기' },
  { value: 'save', label: '저장하거나 나중에 다시 참고하기' },
  { value: 'custom', label: '직접 입력할게요' },
])

const callToActionGroups = Object.freeze([
  frozenGroup('callToAction', '행동 유도', callToActionOptions),
])

export const IMAGE_TEMPLATES: readonly ImageTemplate[] = deepFreeze([
  {
    id: 'detail',
    label: '디테일 클로즈업',
    description: '결과 디테일과 완성도를 가까이 보여줘요.',
    imageSrc: '/images/templates/byreum/detail.webp',
    recommended: false,
    defaults: { modelAge: '30s', framing: 'face', pose: 'front', background: 'bright_studio', textOverlay: 'none' },
  },
  {
    id: 'consultation',
    label: '편안한 첫 인상',
    description: '부담 없이 시작하는 편안한 인상을 전해요.',
    imageSrc: '/images/templates/byreum/consultation.webp',
    recommended: false,
    defaults: { modelAge: '30s', framing: 'upper_body', pose: 'relaxed', background: 'warm_studio', textOverlay: 'none' },
  },
  {
    id: 'design_consult',
    label: '전문가가 설명하는 장면',
    description: '전문가가 맞춤 기준을 설명하는 전문적인 장면이에요.',
    imageSrc: '/images/templates/byreum/design-consult.webp',
    recommended: true,
    defaults: { modelAge: '30s', framing: 'upper_body', pose: 'explaining', background: 'warm_studio', textOverlay: 'none' },
  },
  {
    id: 'studio',
    label: '따뜻한 브랜드 분위기',
    description: '편안한 공간과 자연스러운 분위기를 함께 담아요.',
    imageSrc: '/images/templates/byreum/studio.webp',
    recommended: false,
    defaults: { modelAge: '30s', framing: 'upper_body', pose: 'side', background: 'natural_light', textOverlay: 'none' },
  },
  {
    id: 'assessment',
    label: '현재 상황을 확인하는 장면',
    description: '현재 상황과 고민을 차분히 확인하는 장면이에요.',
    imageSrc: '/images/templates/byreum/assessment.webp',
    recommended: false,
    defaults: { modelAge: '30s', framing: 'face', pose: 'consulting', background: 'treatment_room', textOverlay: 'none' },
  },
  {
    id: 'editorial',
    label: '정보형 에디토리얼',
    description: '핵심 문구와 시각 정보를 함께 전달하기 좋아요.',
    imageSrc: '/images/templates/byreum/editorial.webp',
    recommended: false,
    defaults: { modelAge: '30s', framing: 'face', pose: 'front', background: 'bright_studio', textOverlay: 'short_copy' },
  },
])

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = Object.freeze([
  Object.freeze({
    key: 'goal' as const,
    stepLabel: '1 / 4' as const,
    question: '이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?',
    options: goalOptions,
  }),
  Object.freeze({
    key: 'audience' as const,
    stepLabel: '2 / 4' as const,
    question: '이번 콘텐츠가 어떤 사람의 어떤 고민에 닿으면 좋을까요?',
    options: audienceOptions,
  }),
  Object.freeze({
    key: 'structure' as const,
    stepLabel: '3 / 4' as const,
    question: '어떤 흐름으로 읽히는 글을 만들까요?',
    options: structureOptions,
  }),
  Object.freeze({
    key: 'visualCta' as const,
    stepLabel: '4 / 4' as const,
    question: '글을 읽은 분이 어떤 행동을 하면 좋을까요?',
    options: callToActionOptions,
    groups: callToActionGroups,
  }),
])

const channelSchema = z.enum(INTERVIEW_CHANNELS)
const interviewStepSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
])
const statusSchema = z.enum(['collecting', 'ready_to_generate', 'completed', 'cancelled'])

const contentInterviewControlSchema = z.object({
  kind: z.literal('content_interview_control'),
  action: z.enum(['start_generation', 'quick_generate', 'edit']),
  step: interviewStepSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'edit' && value.step === undefined) {
    context.addIssue({ code: 'custom', path: ['step'], message: '수정할 단계를 지정해 주세요.' })
  }
  if (value.action !== 'edit' && value.step !== undefined) {
    context.addIssue({ code: 'custom', path: ['step'], message: '생성 시작에는 단계를 지정할 수 없습니다.' })
  }
})

function boundedString(maximum: number) {
  return z.string().min(1).max(maximum).refine((value) => value.trim().length > 0)
}

const answerSchema = z
  .object({
    value: boundedString(200),
    customText: z.string().max(2_000).optional(),
    source: z.enum(['option', 'free_text']),
  })
  .strict()

const briefAnswerSchema = z
  .object({
    value: boundedString(200),
    customText: z.string().max(2_000).optional(),
  })
  .strict()

const channelsSchema = z
  .array(channelSchema)
  .min(1)
  .max(INTERVIEW_CHANNELS.length)
  .superRefine((channels, context) => {
    if (new Set(channels).size !== channels.length) {
      context.addIssue({ code: 'custom', message: '같은 채널을 두 번 입력할 수 없습니다.' })
    }
  })

const requestedImageCountsSchema = z.record(
  z.string().min(1).max(64),
  z.number().int().min(0).max(50),
)

const referenceMediaIdsSchema = z
  .array(boundedString(200))
  .max(100)
  .superRefine((ids, context) => {
    const seen = new Set<string>()
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: '같은 미디어를 두 번 저장할 수 없습니다.',
        })
      }
      seen.add(id)
    })
  })

const goalLabels: Record<string, string> = {
  consultation: '문의·예약을 늘리고 싶어요',
  portfolio: '실제 사례와 작업 결과를 보여주고 싶어요',
  expertise: '전문성과 신뢰를 알리고 싶어요',
  awareness: '자연스럽게 브랜드를 기억하게 하고 싶어요',
  announcement: '이벤트나 공지 내용을 알리고 싶어요',
}

const audienceLabels: Record<string, string> = {
  first_time: '처음 방문하는 고객',
  natural_design: '나에게 맞는 제안을 원하는 고객',
  balance: '품질과 완성도를 꼼꼼히 비교하는 고객',
  retouch: '단골 고객 및 재방문을 고려하는 고객',
  local: '매장 주변 지역에서 방문할 고객',
}

const structureLabels: Record<string, string> = {
  empathy_info_consult: '일상 고민 공감 → 맞춤 기준 설명 → 문의 안내',
  state_design_care: '현재 상황 확인 → 제안 기준 → 이용 방법과 문의 안내',
  faq_answer_cta: '자주 묻는 질문 → 이해하기 쉬운 답변 → 문의 유도',
  expertise_story: '전문성과 일하는 방식 중심',
  short_natural: '부담 없이 읽히는 짧고 자연스러운 소개글',
}

const structureTone: Record<string, string> = {
  empathy_info_consult: '따뜻하고 이해하기 쉬운 말투',
  state_design_care: '차분하고 세심한 말투',
  faq_answer_cta: '명확하고 친절한 말투',
  expertise_story: '전문적이면서 신뢰감 있는 말투',
  short_natural: '부담 없고 자연스러운 말투',
}

const structureMessageAngle: Record<string, string> = {
  empathy_info_consult: '일상 고민 공감 → 맞춤 기준 설명 → 문의 안내',
  state_design_care: '현재 상황을 살피고 제안 기준과 이용 방법을 함께 안내하는 방향',
  faq_answer_cta: '자주 묻는 질문에 답하고 이해하기 쉬운 정보에서 문의로 이어지는 방향',
  expertise_story: '일하는 방식과 전문성을 중심으로 신뢰를 쌓는 방향',
  short_natural: '부담 없이 읽히는 짧고 자연스러운 소개 방향',
}

const moodLabels: Record<string, string> = {
  workspace_style: '등록한 이미지 스타일 그대로',
  consultation: '자연스럽고 편안한 분위기',
  detail: '디테일과 완성도를 가까이 보여주는 장면',
  design_consult: '전문가가 기준을 설명하는 장면',
  studio: '편안하고 따뜻한 매장 분위기',
  assessment: '현재 상황을 차분하게 확인하는 장면',
  editorial: '핵심 문구를 함께 보여주는 정보형 이미지',
}

const moodComposition: Record<string, string> = {
  workspace_style: '등록한 이미지 스타일의 구도와 분위기를 그대로 따르는 구도',
  consultation: '자연스럽고 편안한 첫인상을 담는 구도',
  detail: '디테일과 완성도를 가까이 보여주는 구도',
  design_consult: '전문가가 기준을 설명하는 구도',
  studio: '편안하고 따뜻한 매장 분위기를 담는 구도',
  assessment: '현재 상황을 차분히 확인하는 구도',
  editorial: '사진과 짧은 정보 문구가 균형 있게 보이는 구도',
}

const moodSceneRoles: Record<string, readonly string[]> = {
  workspace_style: ['등록한 이미지 스타일이 드러나는 대표 장면'],
  consultation: ['자연스럽고 편안한 분위기'],
  detail: ['디테일과 완성도를 보여주는 장면'],
  design_consult: ['전문가가 기준을 설명하는 장면'],
  studio: ['따뜻한 매장 분위기 장면'],
  assessment: ['현재 상황을 확인하는 장면'],
  editorial: ['짧은 정보 문구와 디테일을 함께 보여주는 장면'],
}

export const contentBriefSchema = z
  .object({
    channels: channelsSchema,
    goal: briefAnswerSchema,
    audience: briefAnswerSchema,
    audienceProblem: boundedString(2_000),
    textDirection: z
      .object({
        structure: briefAnswerSchema,
        tone: boundedString(200),
        messageAngle: boundedString(2_000),
      })
      .strict(),
    imageDirection: z
      .object({
        mood: briefAnswerSchema,
        composition: boundedString(2_000),
        sceneRoles: z.array(boundedString(500)).max(20),
        avoid: z.array(boundedString(2_000)).max(100),
        templateId: boundedString(100).optional(),
        modelAge: z.enum(['20s', '30s', '40s', '50plus']).optional(),
        framing: z.enum(['face', 'upper_body', 'full_body']).optional(),
        pose: z.enum(['front', 'side', 'explaining', 'consulting', 'relaxed']).optional(),
        background: z.enum(['bright_studio', 'warm_studio', 'treatment_room', 'natural_light', 'product_space']).optional(),
        textOverlay: z.enum(['none', 'short_copy', 'information']).optional(),
        extraDirection: z.string().max(500).optional(),
        styleReferenceIds: z.array(z.string().uuid()).max(8).optional(),
      })
      .strict(),
    callToAction: briefAnswerSchema,
    mustInclude: z.array(boundedString(2_000)).max(100),
    mustAvoid: z.array(boundedString(2_000)).max(100),
    referenceMediaIds: referenceMediaIdsSchema,
    eventFacts: boundedString(2_000).optional(),
  })
  .strict()

const visualCtaSchema = z
  .object({
    image: answerSchema,
    callToAction: answerSchema,
    imagePreferences: z.object({
      templateId: boundedString(100),
      modelAge: z.enum(['20s', '30s', '40s', '50plus']),
      framing: z.enum(['face', 'upper_body', 'full_body']),
      pose: z.enum(['front', 'side', 'explaining', 'consulting', 'relaxed']),
      background: z.enum(['bright_studio', 'warm_studio', 'treatment_room', 'natural_light', 'product_space']),
      textOverlay: z.enum(['none', 'short_copy', 'information']),
      extraDirection: z.string().max(500).optional(),
      styleReferenceIds: z.array(z.string().uuid()).max(8).optional(),
    }).strict().optional(),
  })
  .strict()

const answersSchema = z
  .object({
    goal: answerSchema.optional(),
    audience: answerSchema.optional(),
    structure: answerSchema.optional(),
    visualCta: visualCtaSchema.optional(),
    eventFacts: answerSchema.optional(),
  })
  .strict()

const contentInterviewBaseSchema = z
  .object({
    kind: z.literal('content_interview'),
    status: statusSchema,
    step: interviewStepSchema,
    originalPrompt: boundedString(8_000),
    channels: channelsSchema,
    requestedImageCounts: requestedImageCountsSchema,
    answers: answersSchema,
    referenceMediaIds: referenceMediaIdsSchema,
    brief: contentBriefSchema.optional(),
    marketingStrategy: marketingStrategyReferenceSchema.optional(),
    purpose: z.enum(['promotion', 'daily', 'branding', 'event']).optional(),
    pendingQuickGenerate: z.boolean().optional(),
  })
  .strict()

const orderedAnswerKeys = ['goal', 'audience', 'structure', 'visualCta'] as const

function fixedOptionsForKey(key: Exclude<InterviewQuestionKey, 'visualCta'>): readonly InterviewOption[] {
  if (key === 'goal') return goalOptions
  if (key === 'audience') return audienceOptions
  return structureOptions
}

function hasSameKeys(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((key) => actual.includes(key))
}

function addIssue(context: z.RefinementCtx, path: PropertyKey[], message: string) {
  context.addIssue({ code: 'custom', path, message })
}

function validateAnswerValue(
  answer: InterviewAnswer,
  allowedOptions: readonly InterviewOption[],
  path: PropertyKey[],
  context: z.RefinementCtx,
) {
  const allowedValues = new Set(allowedOptions.map((option) => option.value))
  if (answer.customText !== undefined && answer.customText.trim().length === 0) {
    addIssue(context, [...path, 'customText'], '자유 입력은 공백일 수 없습니다.')
  }
  if (answer.source === 'option' && !allowedValues.has(answer.value)) {
    addIssue(context, [...path, 'value'], '현재 질문의 선택지가 아닙니다.')
  }
  if (answer.value === 'custom' && !answer.customText?.trim()) {
    addIssue(context, [...path, 'customText'], '직접 입력한 내용을 남겨 주세요.')
  }
  if (answer.source === 'free_text' && answer.value !== 'custom') {
    addIssue(context, [...path, 'value'], '자유 입력 답변은 custom이어야 합니다.')
  }
  if (answer.source === 'free_text' && !answer.customText?.trim()) {
    addIssue(context, [...path, 'customText'], '자유 입력은 공백일 수 없습니다.')
  }
}

export const contentInterviewStateSchema = contentInterviewBaseSchema.superRefine((state, context) => {
  const { answers } = state
  if (answers.goal) validateAnswerValue(answers.goal, goalOptions, ['answers', 'goal'], context)
  if (answers.audience) validateAnswerValue(answers.audience, audienceOptions, ['answers', 'audience'], context)
  if (answers.structure) validateAnswerValue(answers.structure, structureOptions, ['answers', 'structure'], context)
  if (answers.eventFacts) {
    validateAnswerValue(
      answers.eventFacts,
      [{ value: 'skip', label: '나중에 채울게요' }, { value: 'custom', label: '직접 입력할게요' }],
      ['answers', 'eventFacts'],
      context,
    )
  }
  if (answers.visualCta) {
    validateAnswerValue(answers.visualCta.image, imageMoodOptions, ['answers', 'visualCta', 'image'], context)
    validateAnswerValue(
      answers.visualCta.callToAction,
      callToActionOptions,
      ['answers', 'visualCta', 'callToAction'],
      context,
    )
  }

  const actualKeys = Object.keys(answers)
  const isEvent = isEventOrPromotionPurpose(state)
  const baseExpected = orderedAnswerKeys.slice(0, state.step - 1)
  const expectedWithEvent = isEvent && answers.eventFacts !== undefined
    ? ['goal', 'eventFacts', ...baseExpected.filter((key) => key !== 'goal')]
    : baseExpected

  if (state.status === 'collecting') {
    const isStep1Event = isEvent && state.step === 1 && (hasSameKeys(actualKeys, ['goal']) || hasSameKeys(actualKeys, []))
    const isStep1Normal = !isEvent && state.step === 1 && hasSameKeys(actualKeys, [])
    const isStep1Valid = isStep1Event || isStep1Normal
    const isStepNValid = state.step > 1 && (hasSameKeys(actualKeys, expectedWithEvent) || hasSameKeys(actualKeys, baseExpected))

    if (!isStep1Valid && !isStepNValid) {
      addIssue(context, ['answers'], '현재 단계보다 앞선 답변만 보존할 수 있습니다.')
    }
    return
  }

  if (state.status === 'cancelled') {
    const isPartialCancellation = (hasSameKeys(actualKeys, baseExpected) || hasSameKeys(actualKeys, expectedWithEvent)) && state.brief === undefined
    const isReadyCancellation = state.step === 4
      && orderedAnswerKeys.every((key) => actualKeys.includes(key))
      && actualKeys.every((key) => orderedAnswerKeys.includes(key as any) || key === 'eventFacts')
      && state.brief !== undefined
    if (!isPartialCancellation && !isReadyCancellation) {
      addIssue(context, ['answers'], '취소된 인터뷰는 취소 시점의 답변 형태를 보존해야 합니다.')
    }
    return
  }

  if (state.step !== 4) addIssue(context, ['step'], '생성 준비와 완료 상태는 4단계여야 합니다.')
  const hasRequiredAnswers = orderedAnswerKeys.every((key) => actualKeys.includes(key))
  const hasNoInvalidKeys = actualKeys.every((key) => orderedAnswerKeys.includes(key as any) || key === 'eventFacts')
  if (!hasRequiredAnswers || !hasNoInvalidKeys) {
    addIssue(context, ['answers'], '생성 준비와 완료 상태에는 네 단계 답변이 모두 필요합니다.')
  }
  if (state.brief === undefined) {
    addIssue(context, ['brief'], '생성 준비와 완료 상태에는 브리프가 필요합니다.')
  }
})

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

function stateFrom(value: unknown): ContentInterviewState {
  return deepFreeze(contentInterviewStateSchema.parse(value)) as ContentInterviewState
}

function baseStateFrom(value: unknown): ContentInterviewState {
  return deepFreeze(contentInterviewBaseSchema.parse(value)) as ContentInterviewState
}

function dedupeReferenceMediaIds(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function answerProjection(answer: InterviewAnswer): { value: string; customText?: string } {
  return {
    value: answer.value,
    ...(answer.customText ? { customText: answer.customText } : {}),
  }
}

function answerText(
  answer: Readonly<{ value: string; customText?: string }>,
  labels: Readonly<Record<string, string>>,
): string {
  return answer.customText ?? labels[answer.value] ?? answer.value
}

function answerMeaning(
  answer: Readonly<{ value: string; customText?: string }>,
  labels: Readonly<Record<string, string>>,
): string {
  const meaning = labels[answer.value]
  if (!meaning || !answer.customText) return answer.customText ?? meaning ?? answer.value
  return `${meaning} · ${answer.customText}`
}

function normalizeAnswer(
  answer: InterviewAnswer,
  allowedOptions: readonly InterviewOption[],
): InterviewAnswer {
  if (typeof answer.customText === 'string' && answer.customText.trim().length === 0) {
    throw new Error('자유 입력을 입력해 주세요.')
  }
  const candidate = answerSchema.parse(answer)
  const value = candidate.value.trim()
  const customText = candidate.customText?.trim()
  const allowedValues = new Set(allowedOptions.map((option) => option.value))
  if (candidate.source === 'free_text') {
    if (value !== 'custom' || !customText) throw new Error('자유 입력을 입력해 주세요.')
    return deepFreeze({ value: 'custom', customText, source: 'free_text' })
  }
  if (!allowedValues.has(value)) throw new Error('현재 질문의 선택지를 선택해 주세요.')
  if (value === 'custom' && !customText) throw new Error('자유 입력을 입력해 주세요.')
  return deepFreeze({
    value,
    ...(customText ? { customText } : {}),
    source: 'option',
  })
}

function normalizeVisualCtaAnswer(answer: InterviewAnswer | ContentVisualCtaAnswer): ContentVisualCtaAnswer {
  if (!answer || typeof answer !== 'object' || !('image' in answer) || !('callToAction' in answer)) {
    throw new Error('4단계에서는 이미지 분위기와 행동 유도를 각각 선택해 주세요.')
  }
  const preferences = answer.imagePreferences
  if (preferences && preferences.templateId !== WORKSPACE_STYLE_IMAGE_ID && !IMAGE_TEMPLATES.some((template) => template.id === preferences.templateId)) {
    throw new Error('현재 사용할 수 있는 이미지 템플릿을 선택해 주세요.')
  }
  return deepFreeze({
    image: normalizeAnswer(answer.image, imageMoodOptions),
    callToAction: normalizeAnswer(answer.callToAction, callToActionOptions),
    ...(preferences ? {
      imagePreferences: {
        ...preferences,
        ...(preferences.extraDirection?.trim() ? { extraDirection: preferences.extraDirection.trim() } : { extraDirection: undefined }),
        ...(preferences.styleReferenceIds && preferences.styleReferenceIds.length > 0
          ? { styleReferenceIds: [...new Set(preferences.styleReferenceIds)] }
          : { styleReferenceIds: undefined }),
      },
    } : {}),
  })
}

function appendReferenceMediaIds(
  current: readonly string[],
  additions: readonly string[] | undefined,
): readonly string[] {
  return dedupeReferenceMediaIds([...current, ...(additions ?? [])])
}

function requireAnswers(state: ContentInterviewState): {
  goal: InterviewAnswer
  audience: InterviewAnswer
  structure: InterviewAnswer
  visualCta: ContentVisualCtaAnswer
} {
  const { goal, audience, structure, visualCta } = state.answers
  if (!goal || !audience || !structure || !visualCta) {
    throw new Error('네 단계의 답변을 모두 입력해 주세요.')
  }
  return { goal, audience, structure, visualCta }
}

function classifyCustomText(answers: readonly InterviewAnswer[]): {
  mustInclude: readonly string[]
  mustAvoid: readonly string[]
} {
  const mustInclude: string[] = []
  const mustAvoid: string[] = []
  const seenInclude = new Set<string>()
  const seenAvoid = new Set<string>()
  for (const answer of answers) {
    const text = answer.customText?.trim()
    if (!text) continue
    const destination = /빼기|제외|넣지|피하기/u.test(text) ? mustAvoid : mustInclude
    const seen = destination === mustAvoid ? seenAvoid : seenInclude
    if (seen.has(text)) continue
    seen.add(text)
    destination.push(text)
  }
  return { mustInclude, mustAvoid }
}

function createImageDirection(
  answer: InterviewAnswer,
  mustAvoid: readonly string[],
  preferences?: ImagePreferences,
) {
  const template = IMAGE_TEMPLATES.find((item) => item.id === (preferences?.templateId ?? answer.value))
  const resolved = preferences ?? (template ? { templateId: template.id, ...template.defaults } : undefined)
  const { styleReferenceIds: resolvedStyleIds, ...resolvedRest } = (resolved ?? {}) as Partial<ImagePreferences>
  return {
    mood: answerProjection(answer),
    composition: moodComposition[answer.value] ?? answer.customText ?? '사용자가 설명한 이미지 방향을 반영하는 구도',
    sceneRoles: moodSceneRoles[answer.value] ?? [answer.customText ?? '사용자가 설명한 이미지 방향을 담는 장면'],
    avoid: [...mustAvoid],
    ...(resolved ? resolvedRest : {}),
    ...(resolvedStyleIds && resolvedStyleIds.length > 0
      ? { styleReferenceIds: [...new Set(resolvedStyleIds)] }
      : {}),
  }
}

function normalizeEventFactsAnswer(answer: InterviewAnswer): InterviewAnswer {
  if (answer.value === 'skip') {
    return deepFreeze({
      value: 'skip',
      customText: answer.customText?.trim() || '나중에 채울게요',
      source: 'option',
    })
  }
  const text = answer.customText?.trim() || (answer.value !== 'custom' ? answer.value.trim() : '')
  if (!text) {
    throw new Error('이벤트 정보를 입력해 주세요.')
  }
  return deepFreeze({
    value: 'custom',
    customText: text,
    source: 'free_text',
  })
}

function buildContentBriefFromBase(state: ContentInterviewState): ContentBrief {
  const { goal, audience, structure, visualCta } = requireAnswers(state)
  const customTexts = [goal, audience, structure, visualCta.image, visualCta.callToAction]
  const { mustInclude, mustAvoid } = classifyCustomText(customTexts)

  const finalMustInclude = [...mustInclude]
  const eventFactsAnswer = state.answers.eventFacts
  const isSkippedOrAbsent = !eventFactsAnswer || eventFactsAnswer.value === 'skip'
  const eventFactsText = !isSkippedOrAbsent
    ? (eventFactsAnswer.customText?.trim() || (eventFactsAnswer.value !== 'custom' ? eventFactsAnswer.value : undefined))
    : undefined

  if (eventFactsText) {
    if (!finalMustInclude.includes(eventFactsText)) {
      finalMustInclude.push(eventFactsText)
    }
  } else {
    if (!finalMustInclude.includes(UNKNOWN_INFO_INSTRUCTION)) {
      finalMustInclude.push(UNKNOWN_INFO_INSTRUCTION)
    }
  }

  return deepFreeze({
    channels: [...state.channels],
    goal: answerProjection(goal),
    audience: answerProjection(audience),
    audienceProblem: answerMeaning(audience, audienceLabels),
    textDirection: {
      structure: answerProjection(structure),
      tone: structureTone[structure.value] ?? '사용자가 설명한 방향에 맞는 자연스러운 말투',
      messageAngle: structureMessageAngle[structure.value] ?? answerText(structure, structureLabels),
    },
    imageDirection: createImageDirection(visualCta.image, mustAvoid, visualCta.imagePreferences),
    callToAction: answerProjection(visualCta.callToAction),
    mustInclude: finalMustInclude,
    mustAvoid: [...mustAvoid],
    referenceMediaIds: [...state.referenceMediaIds],
    ...(eventFactsText ? { eventFacts: eventFactsText } : {}),
  })
}

export function createInitialContentInterview(input: {
  originalPrompt: string
  channels: ContentInterviewState['channels']
  requestedImageCounts: Readonly<Record<string, number>>
  referenceMediaIds: readonly string[]
  purpose?: ConversationPostPurpose
}): ContentInterviewState {
  const goal = input.purpose ? goalAnswerFromPurpose(input.purpose) : undefined
  const isEvent = input.purpose === 'event' || input.purpose === 'promotion'
  return stateFrom({
    kind: 'content_interview',
    status: 'collecting',
    step: isEvent ? 1 : goal ? 2 : 1,
    originalPrompt: input.originalPrompt,
    channels: [...input.channels],
    requestedImageCounts: { ...input.requestedImageCounts },
    answers: goal ? { goal } : {},
    referenceMediaIds: dedupeReferenceMediaIds(input.referenceMediaIds),
    ...(input.purpose ? { purpose: input.purpose } : {}),
  })
}

export function advanceContentInterview(
  state: ContentInterviewState,
  answer: InterviewAnswer | ContentVisualCtaAnswer,
  referenceMediaIds?: readonly string[],
): ContentInterviewState {
  const current = stateFrom(state)
  if (current.status !== 'collecting') throw new Error('진행 중인 인터뷰에서만 답변할 수 있습니다.')

  const isEventFacts = isEventOrPromotionPurpose(current) && current.step === 1
  let answers: ContentInterviewState['answers']
  if (isEventFacts) {
    const normalized = normalizeEventFactsAnswer(answer as InterviewAnswer)
    answers = { ...current.answers, eventFacts: normalized }
  } else {
    const key = INTERVIEW_QUESTIONS[current.step - 1].key
    const normalizedAnswer =
      current.step === 4
        ? normalizeVisualCtaAnswer(answer)
        : normalizeAnswer(answer as InterviewAnswer, fixedOptionsForKey(key as Exclude<InterviewQuestionKey, 'visualCta'>))
    answers = { ...current.answers, [key]: normalizedAnswer }
  }

  const references = appendReferenceMediaIds(current.referenceMediaIds, referenceMediaIds)
  const nextStep = current.step < 4 ? ((current.step + 1) as InterviewStep) : current.step
  const nextStateInput = {
    ...current,
    step: nextStep,
    answers,
    referenceMediaIds: references,
  }

  if (current.step < 4) return stateFrom({ ...nextStateInput, status: 'collecting' })

  const brief = buildContentBriefFromBase(baseStateFrom({ ...nextStateInput, status: 'collecting' }))
  return stateFrom({ ...nextStateInput, status: 'ready_to_generate', brief })
}

export function rewindContentInterview(
  state: ContentInterviewState,
  step: InterviewStep,
): ContentInterviewState {
  const current = stateFrom(state)
  if (current.status !== 'ready_to_generate') {
    throw new Error('생성 전 검토 상태에서만 답변을 수정할 수 있습니다.')
  }
  const isEvent = isEventOrPromotionPurpose(current)
  let answers: ContentInterviewState['answers']
  if (isEvent) {
    if (step === 1) {
      answers = current.answers.goal ? { goal: current.answers.goal } : {}
    } else {
      const preserved: Record<string, unknown> = {}
      if (current.answers.goal) preserved.goal = current.answers.goal
      if (current.answers.eventFacts) preserved.eventFacts = current.answers.eventFacts
      const extraKeys = ['audience', 'structure', 'visualCta'] as const
      for (let i = 0; i < step - 2; i++) {
        const k = extraKeys[i]
        if (current.answers[k]) preserved[k] = current.answers[k]
      }
      answers = preserved as ContentInterviewState['answers']
    }
  } else {
    answers = Object.fromEntries(
      orderedAnswerKeys
        .slice(0, step - 1)
        .flatMap((key) => current.answers[key] ? [[key, current.answers[key]]] : []),
    ) as ContentInterviewState['answers']
  }

  const { brief, ...withoutBrief } = current
  void brief
  return stateFrom({
    ...withoutBrief,
    status: 'collecting',
    step,
    answers,
  })
}

export function buildContentBrief(state: ContentInterviewState): ContentBrief {
  return buildContentBriefFromBase(baseStateFrom(state))
}

function summarizeContentBrief(brief: ContentBrief): NonNullable<ContentInterviewView['summary']> {
  const template = IMAGE_TEMPLATES.find((item) => item.id === brief.imageDirection.templateId)
  const modelAgeLabels: Record<string, string> = { '20s': '20대', '30s': '30대', '40s': '40대', '50plus': '50대 이상' }
  const framingLabels: Record<string, string> = { face: '얼굴 중심', upper_body: '상반신', full_body: '전신' }
  const poseLabels: Record<string, string> = { front: '정면', side: '측면', explaining: '설명하는 모습', consulting: '상담 중', relaxed: '자연스러운 모습' }
  const backgroundLabels: Record<string, string> = { bright_studio: '밝은 실내', warm_studio: '따뜻한 실내', treatment_room: '상담실', natural_light: '자연광', product_space: '제품이 보이는 공간' }
  const overlayLabels: Record<string, string> = { none: '텍스트 없음', short_copy: '짧은 문구', information: '정보형 문구' }
  return {
    channels: [...brief.channels],
    goal: answerText(brief.goal, goalLabels),
    audience: answerText(brief.audience, audienceLabels),
    structure: answerText(brief.textDirection.structure, structureLabels),
    imageMood: answerText(brief.imageDirection.mood, moodLabels),
    callToAction: answerText(brief.callToAction, {
      consult: '부담 없이 상담·예약 문의하기',
      check: '현재 상태나 고민을 먼저 확인해보기',
      share_preference: '원하는 스타일이나 분위기를 이야기해보기',
      explore: '매장 채널과 소식 더 둘러보기',
      save: '저장하거나 나중에 다시 참고하기',
    }),
    referenceMediaCount: brief.referenceMediaIds.length,
    mustInclude: brief.mustInclude.filter((item) => item !== UNKNOWN_INFO_INSTRUCTION),
    mustAvoid: [...brief.mustAvoid],
    audienceProblem: brief.audienceProblem,
    tone: brief.textDirection.tone,
    messageAngle: brief.textDirection.messageAngle,
    imageComposition: brief.imageDirection.composition,
    sceneRoles: [...brief.imageDirection.sceneRoles],
    imageAvoid: [...brief.imageDirection.avoid],
    ...(template ? { imageTemplate: template.label } : {}),
    ...(brief.imageDirection.modelAge ? { imageModelAge: modelAgeLabels[brief.imageDirection.modelAge] } : {}),
    ...(brief.imageDirection.framing ? { imageFraming: framingLabels[brief.imageDirection.framing] } : {}),
    ...(brief.imageDirection.pose ? { imagePose: poseLabels[brief.imageDirection.pose] } : {}),
    ...(brief.imageDirection.background ? { imageBackground: backgroundLabels[brief.imageDirection.background] } : {}),
    ...(brief.imageDirection.textOverlay ? { imageTextOverlay: overlayLabels[brief.imageDirection.textOverlay] } : {}),
    ...(brief.imageDirection.extraDirection ? { imageExtraDirection: brief.imageDirection.extraDirection } : {}),
    ...(brief.eventFacts ? { eventFacts: brief.eventFacts } : {}),
  }
}

function previousAnswerView(
  step: InterviewStep,
  answer: InterviewAnswer | ContentVisualCtaAnswer,
): ContentInterviewView['previousAnswers'][number] {
  if (step === 4) {
    const visual = answer as ContentVisualCtaAnswer
    const imageLabel = moodLabels[visual.image.value] ?? '이미지 분위기 직접 입력'
    const ctaLabel = {
      consult: '부담 없이 상담·예약 문의하기',
      check: '현재 상태나 고민을 먼저 확인해보기',
      share_preference: '원하는 스타일이나 분위기를 이야기해보기',
      explore: '매장 채널과 소식 더 둘러보기',
      save: '저장하거나 나중에 다시 참고하기',
    }[visual.callToAction.value] ?? '행동 유도 직접 입력'
    const customTexts = [visual.image.customText, visual.callToAction.customText].filter(Boolean).join(' · ')
    return {
      step,
      label: `이미지 분위기: ${imageLabel} · 행동 유도: ${ctaLabel}`,
      ...(customTexts ? { customText: customTexts } : {}),
    }
  }
  const answerValue = answer as InterviewAnswer
  const labels = step === 1 ? goalLabels : step === 2 ? audienceLabels : structureLabels
  const label = labels[answerValue.value] ?? '직접 입력할게요'
  return {
    step,
    label,
    ...(answerValue.customText ? { customText: answerValue.customText } : {}),
  }
}

function previousAnswersView(state: ContentInterviewState): ContentInterviewView['previousAnswers'] {
  const isEvent = isEventOrPromotionPurpose(state)
  if (isEvent && state.answers.eventFacts) {
    const eventAnswer: ContentInterviewView['previousAnswers'][number] = {
      step: 1,
      label: '이벤트 정보',
      ...(state.answers.eventFacts.value === 'skip'
        ? { customText: '나중에 채울게요' }
        : state.answers.eventFacts.customText
          ? { customText: state.answers.eventFacts.customText }
          : {}),
    }
    const otherKeys = ['audience', 'structure', 'visualCta'] as const
    const others = otherKeys.flatMap((key, idx) => {
      const ans = state.answers[key]
      return ans ? [previousAnswerView((idx + 2) as InterviewStep, ans)] : []
    })
    return [eventAnswer, ...others]
  }

  return (orderedAnswerKeys.flatMap((key, index) => {
    const answer = state.answers[key]
    return answer ? [previousAnswerView((index + 1) as InterviewStep, answer)] : []
  }))
}

export function contentInterviewView(state: ContentInterviewState): ContentInterviewView {
  const current = stateFrom(state)
  const isEventStep1 = isEventOrPromotionPurpose(current) && current.step === 1
  if (isEventStep1) {
    return deepFreeze({
      kind: 'content_interview' as const,
      status: current.status,
      step: current.step,
      totalSteps: 4 as const,
      stepLabel: '이벤트 정보 · 1 / 4',
      questionId: 'eventFacts' as const,
      questionKind: 'event_facts' as const,
      question: EVENT_FACTS_QUESTION_TEXT,
      options: EVENT_FACTS_OPTIONS,
      optionGroups: [],
      imageTemplates: IMAGE_TEMPLATES,
      previousAnswers: previousAnswersView(current),
      ...(current.brief ? { summary: summarizeContentBrief(current.brief) } : {}),
    }) as ContentInterviewView
  }

  const question = INTERVIEW_QUESTIONS[current.step - 1]
  return deepFreeze({
    kind: 'content_interview' as const,
    status: current.status,
    step: current.step,
    totalSteps: 4 as const,
    stepLabel: `${current.step} / 4`,
    questionId: question.key,
    questionKind: 'standard' as const,
    question: question.question,
    options: question.options,
    optionGroups: question.groups ?? [],
    imageTemplates: IMAGE_TEMPLATES,
    previousAnswers: previousAnswersView(current),
    ...(current.brief ? { summary: summarizeContentBrief(current.brief) } : {}),
  }) as ContentInterviewView
}

export function parseContentInterviewState(value: unknown): ContentInterviewState {
  return stateFrom(value)
}

export function safeParseContentInterviewState(value: unknown) {
  const result = contentInterviewStateSchema.safeParse(value)
  return result.success
    ? { success: true as const, data: deepFreeze(result.data) }
    : result
}
