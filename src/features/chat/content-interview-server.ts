import {
  INTERVIEW_INTRODUCTION,
  INTERVIEW_QUESTIONS,
  IMAGE_TEMPLATES,
  advanceContentInterview,
  buildContentBrief,
  contentInterviewView,
  createInitialContentInterview,
  isEventOrPromotionPurpose,
  parseContentInterviewControl,
  rewindContentInterview,
  WORKSPACE_STYLE_IMAGE_ID,
  type ContentBrief,
  type ContentInterviewState,
  type ContentInterviewView,
  type ContentVisualCtaAnswer,
  type ImagePreferences,
  type InterviewAnswer,
} from './content-interview'
import type { ConversationPostRequest } from './conversation-post-intent'
import { requestsAttachedMediaReuse } from './naver-existing-media-reuse'

export type ContentInterviewTurnDecision =
  | Readonly<{
      kind: 'question'
      state: ContentInterviewState
      clarification: ContentInterviewView
      generate: false
    }>
  | Readonly<{
      kind: 'ready_to_generate'
      state: ContentInterviewState
      brief: ContentBrief
      generate: true
    }>
  | Readonly<{
      kind: 'not_interview'
      generate: false
    }>

type ContentInterviewTurnInput = Readonly<{
  active: ContentInterviewState | null
  parsedPostRequest: ConversationPostRequest | null
  userContent: string
  attachmentIds: readonly string[]
  replyToMessageId?: string
  selectedSlideId?: string
  retryFailedSlideId?: string
  retryAssistantMessageId?: string
}>

const cancellationPattern = /^(?:그만(?:할게요?)?|취소(?:할게요?)?|중단(?:할게요?)?|나중에(?: 할게요?)?|다음에(?: 할게요?)?)$/iu
const nonInterviewActionPattern = /(?:승인|예약|발행|복구)\s*(?:해|을|요청)|게시\s*해\s*줘|(?:이미지|게시물).*(?:교체|추가|재시도|다시\s*만들)/iu
const imagePrefixPattern = /(?:이미지\s*(?:분위기)?|분위기)\s*[:：]\s*/iu
const callToActionPrefixPattern = /(?:행동\s*유도|행동|cta)\s*[:：]\s*/iu

function normalizedText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s.,!?，。！？:：/|\-]+/gu, '')
}

function answerFromText(
  value: string,
  options: readonly Readonly<{ value: string; label: string }>[],
): InterviewAnswer {
  const text = value.trim()
  const normalized = normalizedText(text)
  const selected = options.find((option) => {
    const optionValue = normalizedText(option.value)
    const optionLabel = normalizedText(option.label)
    return normalized === optionValue || normalized === optionLabel
  })
  if (selected && selected.value !== 'custom') {
    return Object.freeze({ value: selected.value, source: 'option' as const })
  }
  return Object.freeze({ value: 'custom', customText: text, source: 'free_text' as const })
}

function answerFromUnknown(
  value: unknown,
  options: readonly Readonly<{ value: string; label: string }>[],
): InterviewAnswer {
  if (typeof value === 'string') return answerFromText(value, options)
  if (value && typeof value === 'object' && 'value' in value) {
    const candidate = value as Record<string, unknown>
    const candidateValue = typeof candidate.value === 'string' ? candidate.value.trim() : ''
    const customText = typeof candidate.customText === 'string' ? candidate.customText.trim() : ''
    if (candidate.source === 'free_text' && candidateValue === 'custom' && customText) {
      return Object.freeze({ value: 'custom', customText, source: 'free_text' as const })
    }
    if (candidate.source === 'option') return answerFromText(candidateValue, options)
    return answerFromText(candidateValue, options)
  }
  return answerFromText(String(value ?? ''), options)
}

function structuredVisualAnswer(value: string): ContentVisualCtaAnswer | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    const imageOptions = [
      { value: WORKSPACE_STYLE_IMAGE_ID, label: '우리 매장 이미지 스타일 그대로' },
      ...IMAGE_TEMPLATES.map((template) => ({ value: template.id, label: template.label })),
      { value: 'custom', label: '직접 입력할게요' },
    ]
    const callToActionOptions = INTERVIEW_QUESTIONS[3].groups?.[0]?.options ?? []
    if (candidate.image !== undefined && candidate.callToAction !== undefined) {
      const rawPreferences = candidate.imagePreferences && typeof candidate.imagePreferences === 'object'
        ? candidate.imagePreferences as Record<string, unknown>
        : undefined
      const preferences = rawPreferences
        ? {
            modelAge: '30s',
            framing: 'upper_body',
            pose: 'front',
            background: 'bright_studio',
            textOverlay: 'none',
            ...rawPreferences,
          } as ImagePreferences
        : undefined
      return {
        image: answerFromUnknown(candidate.image, imageOptions),
        callToAction: answerFromUnknown(candidate.callToAction, callToActionOptions),
        ...(preferences ? { imagePreferences: preferences } : {}),
      }
    }
  } catch {
    return null
  }
  return null
}

function visualAnswerFromText(value: string): ContentVisualCtaAnswer {
  const groups = INTERVIEW_QUESTIONS[3].groups ?? []
  const imageOptions = [
    { value: WORKSPACE_STYLE_IMAGE_ID, label: '우리 매장 이미지 스타일 그대로' },
    ...IMAGE_TEMPLATES.map((template) => ({ value: template.id, label: template.label })),
    { value: 'custom', label: '직접 입력할게요' },
  ]
  const callToActionOptions = groups[0]?.options ?? []
  const structured = structuredVisualAnswer(value)
  if (structured) return structured

  const imageMatch = value.match(imagePrefixPattern)
  const callToActionMatch = value.match(callToActionPrefixPattern)
  if (imageMatch || callToActionMatch) {
    const imageText = imageMatch
      ? value.slice((imageMatch.index ?? 0) + imageMatch[0].length).split(/[,;\n]|행동\s*유도\s*[:：]/iu)[0]
      : value
    const callToActionText = callToActionMatch
      ? value.slice((callToActionMatch.index ?? 0) + callToActionMatch[0].length).split(/[,;\n]|이미지\s*(?:분위기)?\s*[:：]/iu)[0]
      : value
    return {
      image: answerFromText(imageText, imageOptions),
      callToAction: answerFromText(callToActionText, callToActionOptions),
    }
  }

  return {
    image: answerFromText('design_consult', imageOptions),
    callToAction: answerFromText(value, callToActionOptions),
  }
}

function answerForStep(state: ContentInterviewState, userContent: string): InterviewAnswer | ContentVisualCtaAnswer {
  if (state.step === 1 && isEventOrPromotionPurpose(state)) {
    const skipOptions = [{ value: 'skip', label: '나중에 채울게요' }]
    const structured = structuredAnswerFromText(userContent, skipOptions)
    if (structured) return structured
    const trimmed = userContent.trim()
    if (trimmed === '나중에 채울게요' || trimmed === '나중에' || trimmed === 'skip') {
      return Object.freeze({ value: 'skip', customText: '나중에 채울게요', source: 'option' as const })
    }
    return Object.freeze({ value: 'custom', customText: trimmed, source: 'free_text' as const })
  }
  const question = INTERVIEW_QUESTIONS[state.step - 1]
  if (state.step === 4) return visualAnswerFromText(userContent)
  const structured = structuredAnswerFromText(userContent, question.options)
  if (structured) return structured
  return answerFromText(userContent, question.options)
}

function structuredAnswerFromText(
  value: string,
  options: readonly Readonly<{ value: string; label: string }>[],
): InterviewAnswer | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return null
    return answerFromUnknown(parsed, options)
  } catch {
    return null
  }
}

function isIndependentCancellation(value: string): boolean {
  return cancellationPattern.test(value.trim())
}

function cancelledClarification(state: ContentInterviewState): ContentInterviewView {
  const view = contentInterviewView(state)
  return Object.freeze({
    ...view,
    question: '원하실 때 같은 대화에서 이어갈 수 있어요.',
  })
}

function questionDecision(state: ContentInterviewState): ContentInterviewTurnDecision {
  return Object.freeze({
    kind: 'question' as const,
    state,
    clarification: contentInterviewView(state),
    generate: false as const,
  })
}

function cancellationDecision(state: ContentInterviewState): ContentInterviewTurnDecision {
  const cancelled = Object.freeze({
    ...state,
    status: 'cancelled' as const,
  })
  return Object.freeze({
    kind: 'question' as const,
    state: cancelled,
    clarification: cancelledClarification(cancelled),
    generate: false as const,
  })
}

function initialInterviewDecision(
  request: ConversationPostRequest,
  attachmentIds: readonly string[],
): ContentInterviewTurnDecision {
  const channels = [...new Set(request.candidates.map((candidate) => candidate.channel))]
  const useOriginals = attachmentIds.length > 0 && requestsAttachedMediaReuse(request.prompt)
  const requestedImageCounts = Object.fromEntries(
    channels.map((channel) => [
      channel,
      useOriginals ? attachmentIds.length : Math.max(...request.candidates
        .filter((candidate) => candidate.channel === channel)
        .map((candidate) => candidate.count)),
    ]),
  )

  return questionDecision(createInitialContentInterview({
    originalPrompt: request.prompt,
    channels,
    requestedImageCounts,
    referenceMediaIds: attachmentIds,
    purpose: request.purpose,
  }))
}

export function interviewResponseText(decision: Extract<ContentInterviewTurnDecision, { kind: 'question' }>): string {
  if (decision.state.status === 'cancelled') return '원하실 때 같은 대화에서 이어갈 수 있어요.'
  if (decision.state.status === 'ready_to_generate') {
    return '네 단계의 콘텐츠 방향을 정리했어요. 아래 요약을 확인한 뒤 제작을 시작할 수 있어요.'
  }
  if (
    decision.clarification.questionKind === 'event_facts' ||
    decision.clarification.questionId === 'eventFacts' ||
    decision.clarification.stepLabel?.startsWith('이벤트 정보')
  ) {
    return `${INTERVIEW_INTRODUCTION}\n\n${decision.clarification.stepLabel ?? '이벤트 정보'} ${decision.clarification.question}`
  }
  if (decision.state.step === 1 && Object.keys(decision.state.answers).length === 0) {
    return `${INTERVIEW_INTRODUCTION}\n\n1 / 4 ${decision.clarification.question}`
  }
  if (decision.clarification.step === 2 && decision.state.answers.eventFacts) {
    return `확인했어요. 이벤트 정보를 반영했어요.\n\n2 / 4 ${decision.clarification.question}`
  }
  return `확인했어요. ${decision.clarification.step - 1}단계 답변을 반영했어요.\n\n${decision.clarification.step} / 4 ${decision.clarification.question}`
}

export function decideContentInterviewTurn(input: ContentInterviewTurnInput): ContentInterviewTurnDecision {
  const hasArtifactReference = Boolean(
    input.replyToMessageId || input.selectedSlideId || input.retryFailedSlideId || input.retryAssistantMessageId,
  )
  if (hasArtifactReference) return { kind: 'not_interview', generate: false }

  const control = parseContentInterviewControl(input.userContent)
  if (control?.action === 'quick_generate' && input.active?.status === 'collecting') {
    const isEvent = isEventOrPromotionPurpose(input.active)
    const hasEventFacts = Boolean(input.active.answers.eventFacts)
    const isFirstStepWithNoMoreThanGoal =
      input.active.step === 1 &&
      Object.keys(input.active.answers).every((key) => key === 'goal')
    const hasAskedEventFacts = Boolean(input.active.pendingQuickGenerate)

    if (isEvent && !hasEventFacts && !hasAskedEventFacts && isFirstStepWithNoMoreThanGoal) {
      const stateWithPending: ContentInterviewState = {
        ...input.active,
        step: 1,
        pendingQuickGenerate: true,
      }
      return questionDecision(stateWithPending)
    }

    const defaults = [
      '사용자 요청과 저장된 매장 정보를 바탕으로 게시물 목적을 제안해 주세요.',
      '요청 주제에 관심 있는 매장 고객. 확인되지 않은 지역·연령은 단정하지 마세요.',
      '요청한 내용에 맞춰 핵심 메시지와 유용한 정보를 자연스럽게 구성해 주세요.',
    ]
    let state = input.active
    while (state.status === 'collecting') {
      const custom = (customText: string): InterviewAnswer => ({ value: 'custom', source: 'free_text', customText })
      state = advanceContentInterview(state, state.step < 4 ? custom(defaults[state.step - 1]) : {
        image: custom('요청 주제와 매장 맥락에 맞는 장면과 구도. 인물·얼굴을 필수로 넣지 말고 제품·공간·디테일 등 내용에 적합한 소재를 선택해 주세요.'),
        callToAction: custom('사용자 요청에 맞는 다음 행동을 제안하되 확인되지 않은 가격·혜택·예약 조건을 만들지 마세요.'),
      }, input.attachmentIds)
    }
    const stateWithoutPending: ContentInterviewState = {
      ...state,
      pendingQuickGenerate: undefined,
    }
    return { kind: 'ready_to_generate', state: stateWithoutPending, brief: buildContentBrief(stateWithoutPending), generate: true }
  }
  if (control && input.active?.status === 'collecting') {
    return questionDecision(input.active)
  }
  const isStructuredStep4Answer =
    input.active?.status === 'collecting' &&
    input.active.step === 4 &&
    Boolean(structuredVisualAnswer(input.userContent))

  if (input.active && input.parsedPostRequest && !isStructuredStep4Answer) {
    return initialInterviewDecision(input.parsedPostRequest, input.attachmentIds)
  }
  if (input.active?.status === 'ready_to_generate') {
    if (control?.action === 'start_generation') {
      const referenceMediaIds = [...new Set([...input.active.referenceMediaIds, ...input.attachmentIds])]
      const stateWithReferences = referenceMediaIds.length === input.active.referenceMediaIds.length
        ? input.active
        : Object.freeze({
          ...input.active,
          referenceMediaIds,
          brief: buildContentBrief({ ...input.active, referenceMediaIds }),
        })
      return Object.freeze({
        kind: 'ready_to_generate' as const,
        state: stateWithReferences,
        brief: stateWithReferences.brief ?? buildContentBrief(stateWithReferences),
        generate: true as const,
      })
    }
    if (control?.action === 'edit' && control.step !== undefined) {
      return questionDecision(rewindContentInterview(input.active, control.step))
    }
    return { kind: 'not_interview', generate: false }
  }
  if (input.active && input.active.status !== 'collecting') {
    return { kind: 'not_interview', generate: false }
  }

  if (!input.active) {
    if (nonInterviewActionPattern.test(input.userContent)) {
      return { kind: 'not_interview', generate: false }
    }
    if (!input.parsedPostRequest || input.parsedPostRequest.candidates.length === 0) {
      return { kind: 'not_interview', generate: false }
    }
    return initialInterviewDecision(input.parsedPostRequest, input.attachmentIds)
  }

  if (input.active.step < 4 && isIndependentCancellation(input.userContent)) {
    return cancellationDecision(input.active)
  }
  if (input.active.step === 4) {
    const optionGroups = INTERVIEW_QUESTIONS[3].groups ?? []
    const exactOption = [...optionGroups.flatMap((group) => group.options)].some((option) => {
      const candidate = normalizedText(input.userContent)
      return candidate === normalizedText(option.value) || candidate === normalizedText(option.label)
    })
    if (!exactOption && isIndependentCancellation(input.userContent)) {
      return cancellationDecision(input.active)
    }
    const visualAnswer = visualAnswerFromText(input.userContent)
    const hasExplicitOption = visualAnswer.callToAction.source === 'option'
    if (!hasExplicitOption && isIndependentCancellation(input.userContent)) {
      return cancellationDecision(input.active)
    }
  }

  try {
    const isPendingQuick = input.active.pendingQuickGenerate
    let state = advanceContentInterview(input.active, answerForStep(input.active, input.userContent), input.attachmentIds)
    if (isPendingQuick) {
      const defaults = [
        '사용자 요청과 저장된 매장 정보를 바탕으로 게시물 목적을 제안해 주세요.',
        '요청 주제에 관심 있는 매장 고객. 확인되지 않은 지역·연령은 단정하지 마세요.',
        '요청한 내용에 맞춰 핵심 메시지와 유용한 정보를 자연스럽게 구성해 주세요.',
      ]
      while (state.status === 'collecting') {
        const custom = (customText: string): InterviewAnswer => ({ value: 'custom', source: 'free_text', customText })
        state = advanceContentInterview(state, state.step < 4 ? custom(defaults[state.step - 1]) : {
          image: custom('요청 주제와 매장 맥락에 맞는 장면과 구도. 인물·얼굴을 필수로 넣지 말고 제품·공간·디테일 등 내용에 적합한 소재를 선택해 주세요.'),
          callToAction: custom('사용자 요청에 맞는 다음 행동을 제안하되 확인되지 않은 가격·혜택·예약 조건을 만들지 마세요.'),
        }, input.attachmentIds)
      }
      const stateWithoutPending: ContentInterviewState = {
        ...state,
        pendingQuickGenerate: undefined,
      }
      return { kind: 'ready_to_generate', state: stateWithoutPending, brief: buildContentBrief(stateWithoutPending), generate: true }
    }
    if (state.status === 'ready_to_generate') return questionDecision(state)
    return questionDecision(state)
  } catch {
    return questionDecision(input.active)
  }
}
