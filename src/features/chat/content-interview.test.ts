import { describe, expect, it } from 'vitest'
import {
  IMAGE_TEMPLATES,
  INTERVIEW_QUESTIONS,
  UNKNOWN_INFO_INSTRUCTION,
  WORKSPACE_STYLE_IMAGE_ID,
  advanceContentInterview,
  audienceOptions,
  buildContentBrief,
  callToActionOptions,
  contentInterviewView,
  createInitialContentInterview,
  goalOptions,
  imageMoodOptions,
  parseContentInterviewState,
  rewindContentInterview,
  safeParseContentInterviewState,
  structureOptions,
} from './content-interview'

const baseInput = {
  originalPrompt: '인스타와 Threads에 포스팅해줘',
  channels: ['instagram', 'threads'] as const,
  requestedImageCounts: { instagram: 3, threads: 1 },
  referenceMediaIds: [] as const,
}

describe('content interview domain', () => {
  it('keeps a server strategy reference through parsing, four answers, and review rewind without exposing IDs in the view', () => {
    const marketingStrategy = { missionId: '40000000-0000-4000-8000-000000000001', runId: '50000000-0000-4000-8000-000000000001',
      briefId: '10000000-0000-4000-8000-000000000001', revision: 2 }
    let state = parseContentInterviewState({ ...createInitialContentInterview({ ...baseInput, channels: ['naver_blog'],
      requestedImageCounts: { naver_blog: 1 } }), marketingStrategy })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, { value: 'local', source: 'option' })
    state = advanceContentInterview(state, { value: 'empathy_info_consult', source: 'option' })
    state = advanceContentInterview(state, { image: { value: 'detail', source: 'option' }, callToAction: { value: 'consult', source: 'option' } })
    expect(state.marketingStrategy).toEqual(marketingStrategy)
    expect(rewindContentInterview(state, 2).marketingStrategy).toEqual(marketingStrategy)
    expect(JSON.stringify(contentInterviewView(state))).not.toContain(marketingStrategy.missionId)
  })

  it('4단계 콘텐츠 질문에서는 이미지 선택을 분리하고 행동 유도만 묻는다', () => {
    const question = INTERVIEW_QUESTIONS[3]

    expect(question.question).toBe('글을 읽은 분이 어떤 행동을 하면 좋을까요?')
    expect(question.groups?.map((group) => group.key)).toEqual(['callToAction'])
    expect(question.question).not.toContain('이미지')
  })

  it('이미지 템플릿과 세부 선택을 텍스트 브리프와 같은 이미지 방향으로 보존한다', () => {
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, { value: 'expertise', source: 'option' })
    state = advanceContentInterview(state, { value: 'natural_design', source: 'option' })
    state = advanceContentInterview(state, { value: 'expertise_story', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'design_consult', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
      imagePreferences: {
        templateId: 'design_consult',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'explaining',
        background: 'warm_studio',
        textOverlay: 'none',
        extraDirection: '상담 도구가 자연스럽게 보이게 해 주세요.',
      },
    })

    const brief = buildContentBrief(state)
    expect(brief.imageDirection).toMatchObject({
      templateId: 'design_consult',
      modelAge: '30s',
      framing: 'upper_body',
      pose: 'explaining',
      background: 'warm_studio',
      textOverlay: 'none',
      extraDirection: '상담 도구가 자연스럽게 보이게 해 주세요.',
    })
    expect(contentInterviewView(state).summary).toMatchObject({
      imageTemplate: '전문가가 설명하는 장면',
      imageModelAge: '30대',
      imageFraming: '상반신',
    })
  })

  it('imagePreferences에 styleReferenceIds가 있는 상태/브리프가 스키마를 통과하고 imageDirection으로 전달된다', () => {
    const id1 = '11111111-1111-4111-8111-111111111111'
    const id2 = '22222222-2222-4222-8222-222222222222'
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, { value: 'expertise', source: 'option' })
    state = advanceContentInterview(state, { value: 'natural_design', source: 'option' })
    state = advanceContentInterview(state, { value: 'expertise_story', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'design_consult', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
      imagePreferences: {
        templateId: 'design_consult',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'explaining',
        background: 'warm_studio',
        textOverlay: 'none',
        styleReferenceIds: [id1, id2, id1], // 중복 포함
      },
    })

    const parsed = safeParseContentInterviewState(state)
    expect(parsed.success).toBe(true)

    const brief = buildContentBrief(state)
    expect(brief.imageDirection.styleReferenceIds).toEqual([id1, id2])
  })

  it('styleReferenceIds가 없는 기존 상태와 빈 배열 상태도 정상 통과하며 빈 경우 키를 넣지 않는다', () => {
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, { value: 'expertise', source: 'option' })
    state = advanceContentInterview(state, { value: 'natural_design', source: 'option' })
    state = advanceContentInterview(state, { value: 'expertise_story', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'design_consult', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
      imagePreferences: {
        templateId: 'design_consult',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'explaining',
        background: 'warm_studio',
        textOverlay: 'none',
        styleReferenceIds: [],
      },
    })

    const parsed = safeParseContentInterviewState(state)
    expect(parsed.success).toBe(true)
    const brief = buildContentBrief(state)
    expect(brief.imageDirection.styleReferenceIds).toBeUndefined()
    expect('styleReferenceIds' in brief.imageDirection).toBe(false)
  })

  it('styleReferenceIds에 비uuid가 포함되거나 9개 이상이면 스키마 검증에서 거절된다', () => {
    const validUuids = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const baseAnswers = {
      goal: { value: 'expertise', source: 'option' as const },
      audience: { value: 'natural_design', source: 'option' as const },
      structure: { value: 'expertise_story', source: 'option' as const },
    }

    // 9개 초과
    const tooManyResult = safeParseContentInterviewState({
      ...createInitialContentInterview(baseInput),
      status: 'collecting',
      step: 4,
      answers: {
        ...baseAnswers,
        visualCta: {
          image: { value: 'design_consult', source: 'option' as const },
          callToAction: { value: 'consult', source: 'option' as const },
          imagePreferences: {
            templateId: 'design_consult',
            modelAge: '30s',
            framing: 'upper_body',
            pose: 'explaining',
            background: 'warm_studio',
            textOverlay: 'none',
            styleReferenceIds: validUuids,
          },
        },
      },
    })
    expect(tooManyResult.success).toBe(false)

    // 비uuid
    const nonUuidResult = safeParseContentInterviewState({
      ...createInitialContentInterview(baseInput),
      status: 'collecting',
      step: 4,
      answers: {
        ...baseAnswers,
        visualCta: {
          image: { value: 'design_consult', source: 'option' as const },
          callToAction: { value: 'consult', source: 'option' as const },
          imagePreferences: {
            templateId: 'design_consult',
            modelAge: '30s',
            framing: 'upper_body',
            pose: 'explaining',
            background: 'warm_studio',
            textOverlay: 'none',
            styleReferenceIds: ['not-a-uuid'],
          },
        },
      },
    })
    expect(nonUuidResult.success).toBe(false)
  })

  it('새 게시 요청은 목적부터 1/4 질문으로 시작한다', () => {
    const state = createInitialContentInterview(baseInput)

    expect(state.step).toBe(1)
    expect(state.status).toBe('collecting')
    expect(INTERVIEW_QUESTIONS.map(({ key }) => key)).toEqual([
      'goal',
      'audience',
      'structure',
      'visualCta',
    ])
    expect(INTERVIEW_QUESTIONS[0].question).toBe('이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?')
    expect(INTERVIEW_QUESTIONS[0].options.at(-1)).toMatchObject({
      value: 'custom',
      label: '직접 입력할게요',
    })
    expect(INTERVIEW_QUESTIONS[1].options.at(-1)).toMatchObject({
      value: 'custom',
      label: '직접 입력할게요',
    })
    expect(INTERVIEW_QUESTIONS[2].options.at(-1)).toMatchObject({
      value: 'custom',
      label: '직접 입력할게요',
    })
    expect(INTERVIEW_QUESTIONS[3].options.at(-1)).toMatchObject({
      value: 'custom',
      label: '직접 입력할게요',
    })
    expect(INTERVIEW_QUESTIONS[3].groups).toEqual([
      expect.objectContaining({ key: 'callToAction', label: '행동 유도' }),
    ])
    expect(INTERVIEW_QUESTIONS[3].groups?.every((group) => group.options.at(-1))).toBe(true)
  })

  it('선택지와 자유 입력을 같은 답변 계약으로 정규화한다', () => {
    const state = createInitialContentInterview({
      originalPrompt: '네이버 블로그 글을 만들어줘',
      channels: ['naver_blog'],
      requestedImageCounts: { naver_blog: 5 },
      referenceMediaIds: [],
    })

    const next = advanceContentInterview(state, {
      value: 'custom',
      customText: '상담 예약으로 이어지는 차분한 글이면 좋겠어요',
      source: 'free_text',
    })

    expect(next.step).toBe(2)
    expect(next.answers.goal).toEqual({
      value: 'custom',
      customText: '상담 예약으로 이어지는 차분한 글이면 좋겠어요',
      source: 'free_text',
    })
    expect(() => advanceContentInterview(state, {
      value: 'custom',
      customText: '   ',
      source: 'free_text',
    })).toThrow(/자유 입력/u)
  })

  it('네 단계 답변을 하나의 브리프로 만들고 첨부 자산의 최초 순서를 보존한다', () => {
    let state = createInitialContentInterview({
      originalPrompt: '인스타 포스팅',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 3 },
      referenceMediaIds: ['media-1', 'media-1'],
    })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' }, ['media-2'])
    state = advanceContentInterview(state, { value: 'local', source: 'option' }, ['media-1', 'media-3'])
    state = advanceContentInterview(state, { value: 'empathy_info_consult', source: 'option' }, ['media-2'])
    state = advanceContentInterview(state, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'check', source: 'option', customText: '아이콘은 넣지 않기' },
    })
    const brief = buildContentBrief(state)

    expect(state.status).toBe('ready_to_generate')
    expect(brief.channels).toEqual(['instagram'])
    expect(brief.goal.value).toBe('consultation')
    expect(brief.audienceProblem).toContain('매장 주변 지역에서 방문할 고객')
    expect(brief.textDirection.messageAngle).toContain('일상 고민 공감')
    expect(brief.imageDirection.mood.value).toBe('detail')
    expect(brief.imageDirection.composition).toContain('디테일')
    expect(brief.imageDirection.sceneRoles.length).toBeGreaterThan(0)
    expect(brief.callToAction.value).toBe('check')
    expect(brief.referenceMediaIds).toEqual(['media-1', 'media-2', 'media-3'])
    expect(brief.mustAvoid).toContain('아이콘은 넣지 않기')
  })

  it('자유 입력은 제외 표현이면 mustAvoid, 나머지는 mustInclude에 넣는다', () => {
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, {
      value: 'custom',
      customText: '상담 문의를 늘리고 싶어요',
      source: 'free_text',
    })
    state = advanceContentInterview(state, {
      value: 'custom',
      customText: '처음 알아보는 분의 고민을 담아 주세요',
      source: 'free_text',
    })
    state = advanceContentInterview(state, {
      value: 'custom',
      customText: '짧고 차분한 흐름으로 써 주세요',
      source: 'free_text',
    })
    state = advanceContentInterview(state, {
      image: {
        value: 'custom',
        customText: '따뜻한 크림색 배경을 꼭 담아 주세요',
        source: 'free_text',
      },
      callToAction: {
        value: 'custom',
        customText: '빼기: 과장된 전후 사진, 넣지 말기: 내부 운영 문구',
        source: 'free_text',
      },
    })

    const brief = buildContentBrief(state)
    expect(brief.mustAvoid).toEqual(['빼기: 과장된 전후 사진, 넣지 말기: 내부 운영 문구'])
    expect(brief.mustInclude).toEqual([
      '상담 문의를 늘리고 싶어요',
      '처음 알아보는 분의 고민을 담아 주세요',
      '짧고 차분한 흐름으로 써 주세요',
      '따뜻한 크림색 배경을 꼭 담아 주세요',
      UNKNOWN_INFO_INSTRUCTION,
    ])
  })

  it('독자 선택지의 의미와 보충 자유 입력을 audienceProblem에 함께 담는다', () => {
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, {
      value: 'local',
      customText: '처음 방문해도 안심할 수 있는 기준을 알고 싶은 분',
      source: 'option',
    })
    state = advanceContentInterview(state, { value: 'faq_answer_cta', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'check', source: 'option' },
    })

    const brief = buildContentBrief(state)
    expect(brief.audienceProblem).toContain('매장 주변 지역에서 방문할 고객')
    expect(brief.audienceProblem).toContain('처음 방문해도 안심할 수 있는 기준')
  })

  it('생성 전 뷰에는 실제 이전 답변과 생성에 필요한 추가 방향을 안전하게 투영한다', () => {
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, {
      value: 'consultation',
      source: 'option',
    })
    state = advanceContentInterview(state, {
      value: 'local',
      customText: '처음 방문해도 안심할 수 있는 기준',
      source: 'option',
    })
    state = advanceContentInterview(state, {
      value: 'custom',
      customText: '짧고 차분한 설명 뒤 상담으로 이어지기',
      source: 'free_text',
    })

    const view = contentInterviewView(state)
    expect(view.previousAnswers).toEqual([
      { step: 1, label: '문의·예약을 늘리고 싶어요' },
      { step: 2, label: '매장 주변 지역에서 방문할 고객', customText: '처음 방문해도 안심할 수 있는 기준' },
      { step: 3, label: '직접 입력할게요', customText: '짧고 차분한 설명 뒤 상담으로 이어지기' },
    ])
    expect(view.summary).toBeUndefined()
  })

  it('네 단계 완료 뒤 선택한 단계부터 다시 수집하되 이전 답변과 첨부를 보존한다', () => {
    let state = createInitialContentInterview({ ...baseInput, referenceMediaIds: ['media-1'] })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, { value: 'local', source: 'option' })
    state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'check', source: 'option' },
    }, ['media-2'])

    const rewound = rewindContentInterview(state, 2)
    expect(rewound.status).toBe('collecting')
    expect(rewound.step).toBe(2)
    expect(rewound.answers).toEqual({ goal: { value: 'consultation', source: 'option' } })
    expect(rewound.referenceMediaIds).toEqual(['media-1', 'media-2'])
    expect(rewound.brief).toBeUndefined()
  })

  it('완료 상태의 뷰는 원본 상태와 원문 프롬프트를 노출하지 않는다', () => {
    let state = createInitialContentInterview({ ...baseInput, originalPrompt: '비밀 원문 요청' })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, { value: 'local', source: 'option' })
    state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'check', source: 'option' },
    })

    const view = contentInterviewView(state)
    expect(view).toMatchObject({ kind: 'content_interview', status: 'ready_to_generate', totalSteps: 4, step: 4 })
    expect(view.summary?.referenceMediaCount).toBe(0)
    expect(state.brief?.mustInclude).toContain(UNKNOWN_INFO_INSTRUCTION)
    expect(view.summary?.mustInclude).not.toContain(UNKNOWN_INFO_INSTRUCTION)
    expect(view.summary?.mustAvoid).toEqual([])
    expect(view.optionGroups.map((group) => group.key)).toEqual(['callToAction'])
    expect(view.imageTemplates).toHaveLength(6)
    expect(view).not.toHaveProperty('originalPrompt')
    expect(view).not.toHaveProperty('answers')
    expect(JSON.stringify(view)).not.toContain('비밀 원문 요청')
  })

  it('상태를 파싱하고 손상된 메타데이터는 안전하게 실패한다', () => {
    const state = createInitialContentInterview(baseInput)
    const parsed = parseContentInterviewState(state)
    expect(parsed).toEqual(state)

    expect(safeParseContentInterviewState({ ...state, step: 5 })).toEqual({
      success: false,
      error: expect.anything(),
    })
    expect(safeParseContentInterviewState({ ...state, step: 2, answers: { goal: { value: 'not-a-goal', source: 'option' } } })).toMatchObject({ success: false })
    expect(safeParseContentInterviewState({
      ...state,
      step: 2,
      answers: { goal: { value: 'custom', customText: '   ', source: 'free_text' } },
    })).toMatchObject({ success: false })
    expect(safeParseContentInterviewState({ ...state, step: 2, answers: {} })).toMatchObject({ success: false })
    expect(safeParseContentInterviewState({
      ...state,
      step: 1,
      answers: { goal: { value: 'consultation', source: 'option' } },
    })).toMatchObject({ success: false })
    expect(safeParseContentInterviewState({ ...state, originalPrompt: 'x'.repeat(8_001) })).toMatchObject({ success: false })

    let complete = createInitialContentInterview(baseInput)
    complete = advanceContentInterview(complete, { value: 'consultation', source: 'option' })
    complete = advanceContentInterview(complete, { value: 'local', source: 'option' })
    complete = advanceContentInterview(complete, { value: 'short_natural', source: 'option' })
    complete = advanceContentInterview(complete, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'check', source: 'option' },
    })
    expect(safeParseContentInterviewState(complete).success).toBe(true)
    expect(safeParseContentInterviewState({ ...complete, status: 'completed' }).success).toBe(true)
    expect(safeParseContentInterviewState({ ...complete, status: 'completed', brief: undefined })).toMatchObject({ success: false })
    expect(safeParseContentInterviewState({
      ...baseInput,
      kind: 'content_interview',
      status: 'cancelled',
      step: 2,
      answers: { goal: { value: 'consultation', source: 'option' } },
      referenceMediaIds: [],
    })).toMatchObject({ success: true })
    expect(safeParseContentInterviewState({
      ...complete,
      status: 'cancelled',
    })).toMatchObject({ success: true })
    expect(safeParseContentInterviewState({ ...complete, status: 'cancelled', brief: undefined })).toMatchObject({ success: false })
  })

  it('일상이나 브랜드 목적이 주어지면 1단계(목적)를 사전 답변하고 2단계부터 인터뷰를 시작한다', () => {
    const state = createInitialContentInterview({
      ...baseInput,
      purpose: 'daily',
    })

    expect(state.step).toBe(2)
    expect(state.status).toBe('collecting')
    expect(state.answers.goal).toEqual({
      value: 'custom',
      customText: '일상 소통',
      source: 'free_text',
    })

    const view = contentInterviewView(state)
    expect(view.step).toBe(2)
    expect(view.question).toBe(INTERVIEW_QUESTIONS[1].question)
    expect(view.previousAnswers).toEqual([
      { step: 1, label: '직접 입력할게요', customText: '일상 소통' },
    ])
  })

  it('이벤트나 프로모션 목적이면 목적을 사전 채우고 이벤트 정보 질문을 1단계로 시작한다', () => {
    const state = createInitialContentInterview({
      ...baseInput,
      purpose: 'event',
    })

    expect(state.step).toBe(1)
    expect(state.status).toBe('collecting')
    expect(state.answers.goal).toEqual({
      value: 'custom',
      customText: '이벤트 홍보',
      source: 'free_text',
    })

    const view = contentInterviewView(state)
    expect(view.step).toBe(1)
    expect(view.stepLabel).toBe('이벤트 정보 · 1 / 4')
    expect(view.questionId).toBe('eventFacts')
    expect(view.questionKind).toBe('event_facts')
    expect(view.question).toBe('이벤트(프로모션) 정보를 알려 주세요')
    expect(view.options).toEqual([
      { value: 'skip', label: '나중에 채울게요' },
    ])
  })

  it('purpose가 지정되지 않은 경우 originalPrompt에 이벤트/프로모션 단어가 있어도 일반 1단계(목적) 질문으로 시작하고 정상 진행된다', () => {
    let state = createInitialContentInterview({
      ...baseInput,
      originalPrompt: '가을 이벤트 글 써줘',
      purpose: undefined,
    })

    expect(state.step).toBe(1)
    expect(state.answers.goal).toBeUndefined()
    expect(state.answers.eventFacts).toBeUndefined()

    const view = contentInterviewView(state)
    expect(view.step).toBe(1)
    expect(view.stepLabel).toBe('1 / 4')
    expect(view.question).toBe(INTERVIEW_QUESTIONS[0].question)

    // 1단계 답변 제출 시 정상적으로 2단계로 진행되어야 함 (스레드 막힘 방지)
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    expect(state.step).toBe(2)
    expect(state.answers.goal).toEqual({ value: 'consultation', source: 'option' })
  })

  it('이벤트 정보를 입력하면 2단계(2 / 4 독자 질문)로 진행하고 브리프에 원문을 포함한다', () => {
    let state = createInitialContentInterview({
      ...baseInput,
      purpose: 'promotion',
    })

    state = advanceContentInterview(state, {
      value: 'custom',
      customText: '가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의',
      source: 'free_text',
    })

    expect(state.step).toBe(2)
    expect(state.answers.eventFacts).toEqual({
      value: 'custom',
      customText: '가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의',
      source: 'free_text',
    })

    const view = contentInterviewView(state)
    expect(view.step).toBe(2)
    expect(view.stepLabel).toBe('2 / 4')
    expect(view.question).toBe(INTERVIEW_QUESTIONS[1].question)
    expect(view.previousAnswers).toEqual([
      { step: 1, label: '이벤트 정보', customText: '가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의' },
    ])

    state = advanceContentInterview(state, { value: 'first_time', source: 'option' })
    state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
    })

    expect(state.status).toBe('ready_to_generate')
    const brief = buildContentBrief(state)
    expect(brief.eventFacts).toBe('가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의')
    expect(brief.mustInclude).toContain('가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의')
    expect(contentInterviewView(state).summary?.eventFacts).toBe('가을 맞이 첫 방문 20% 할인 / 11월 한 달 / 카카오톡으로 문의')
  })

  it('이벤트 정보 질문에서 나중에 채우기를 선택하면 브리프에 사실적 티저 작성 및 대괄호 슬롯 규칙을 포함하고 점주에게 질문하지 않도록 한다', () => {
    let state = createInitialContentInterview({
      ...baseInput,
      purpose: 'event',
    })

    state = advanceContentInterview(state, {
      value: 'skip',
      source: 'option',
      customText: '나중에 채울게요',
    })

    expect(state.step).toBe(2)
    expect(state.answers.eventFacts?.value).toBe('skip')

    state = advanceContentInterview(state, { value: 'first_time', source: 'option' })
    state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
    })

    const brief = buildContentBrief(state)
    expect(brief.eventFacts).toBeUndefined()
    const rule = brief.mustInclude.find((item) => item.includes('이벤트 상세') || item.includes('티저'))
    expect(rule).toBeDefined()
    expect(rule).toContain('점주에게 질문하거나 말을 걸지 마세요')
    expect(rule).toContain('날짜·가격·혜택을 임의로 지어내지 말고')
    expect(rule).toContain('[이벤트 기간]')
    expect(brief.mustInclude).not.toContain(
      '알 수 없는 정보는 대괄호 빈칸으로 두지 말고, 빈칸 대신 사장님께 확인이 필요하다고 한 문장으로 표시',
    )
  })

  it('기존(과거) 저장된 인터뷰 상태는 eventFacts가 없어도 안전하게 파싱된다', () => {
    const oldCollectingState = {
      kind: 'content_interview',
      status: 'collecting',
      step: 2,
      originalPrompt: '인스타 포스팅',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      answers: { goal: { value: 'consultation', source: 'option' } },
      referenceMediaIds: [],
    }
    expect(safeParseContentInterviewState(oldCollectingState).success).toBe(true)

    const oldReadyState = {
      kind: 'content_interview',
      status: 'ready_to_generate',
      step: 4,
      originalPrompt: '인스타 포스팅',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      answers: {
        goal: { value: 'consultation', source: 'option' },
        audience: { value: 'first_time', source: 'option' },
        structure: { value: 'short_natural', source: 'option' },
        visualCta: {
          image: { value: 'detail', source: 'option' },
          callToAction: { value: 'consult', source: 'option' },
        },
      },
      referenceMediaIds: [],
      brief: {
        channels: ['instagram'],
        goal: { value: 'consultation' },
        audience: { value: 'first_time' },
        audienceProblem: '처음 방문하는 고객',
        textDirection: {
          structure: { value: 'short_natural' },
          tone: '부담 없고 자연스러운 말투',
          messageAngle: '부담 없이 읽히는 짧고 자연스러운 소개 방향',
        },
        imageDirection: {
          mood: { value: 'detail' },
          composition: '디테일과 완성도를 가까이 보여주는 구도',
          sceneRoles: ['디테일과 완성도를 보여주는 장면'],
          avoid: [],
        },
        callToAction: { value: 'consult' },
        mustInclude: [],
        mustAvoid: [],
        referenceMediaIds: [],
      },
    }
    expect(safeParseContentInterviewState(oldReadyState).success).toBe(true)
  })

  it('선택지와 템플릿에 특정 업종(바이름, 눈썹, 시술) 단어가 없어야 한다', () => {
    const jsonStr = JSON.stringify(INTERVIEW_QUESTIONS)
    expect(jsonStr).not.toContain('바이름')
    expect(jsonStr).not.toContain('눈썹')
    expect(jsonStr).not.toContain('시술')
    expect(jsonStr).not.toContain('잔흔')
    expect(jsonStr).not.toContain('청라')
  })

  it('accepts the workspace style as the image choice, so no fixed industry template is required', () => {
    const id1 = '00000000-0000-4000-8000-000000000001'
    let state = createInitialContentInterview(baseInput)
    state = advanceContentInterview(state, { value: 'expertise', source: 'option' })
    state = advanceContentInterview(state, { value: 'natural_design', source: 'option' })
    state = advanceContentInterview(state, { value: 'expertise_story', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'workspace_style', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
      imagePreferences: {
        templateId: 'workspace_style',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'front',
        background: 'bright_studio',
        textOverlay: 'none',
        styleReferenceIds: [id1],
      },
    })
    expect(safeParseContentInterviewState(state).success).toBe(true)
    const brief = buildContentBrief(state)
    expect(brief.imageDirection.templateId).toBe('workspace_style')
    expect(brief.imageDirection.styleReferenceIds).toEqual([id1])
    expect(brief.imageDirection.sceneRoles).toEqual(['등록한 이미지 스타일이 드러나는 대표 장면'])
  })

  it('모든 옵션 라벨과 이미지 템플릿에 특정 업종 전제 표현(눈썹|시술|원장|시술실|디자인 기준)이 포함되지 않는다', () => {
    const bannedPattern = /눈썹|시술|원장|시술실|디자인 기준/
    const allLabels: string[] = [
      ...goalOptions.map((o) => o.label),
      ...audienceOptions.map((o) => o.label),
      ...structureOptions.map((o) => o.label),
      ...imageMoodOptions.map((o) => o.label),
      ...callToActionOptions.map((o) => o.label),
      ...IMAGE_TEMPLATES.map((t) => t.label),
      ...IMAGE_TEMPLATES.map((t) => t.description),
    ]

    for (const text of allLabels) {
      expect(text).not.toMatch(bannedPattern)
    }
  })

  it('저장된 대화 상태 호환성을 위해 모든 옵션 배열과 템플릿의 value 키 목록이 유지된다', () => {
    expect(goalOptions.map((o) => o.value)).toEqual([
      'consultation',
      'portfolio',
      'expertise',
      'awareness',
      'announcement',
      'custom',
    ])
    expect(audienceOptions.map((o) => o.value)).toEqual([
      'first_time',
      'natural_design',
      'balance',
      'retouch',
      'local',
      'custom',
    ])
    expect(structureOptions.map((o) => o.value)).toEqual([
      'empathy_info_consult',
      'state_design_care',
      'faq_answer_cta',
      'expertise_story',
      'short_natural',
      'custom',
    ])
    expect(imageMoodOptions.map((o) => o.value)).toEqual([
      WORKSPACE_STYLE_IMAGE_ID,
      'consultation',
      'detail',
      'design_consult',
      'studio',
      'assessment',
      'editorial',
      'custom',
    ])
    expect(callToActionOptions.map((o) => o.value)).toEqual([
      'consult',
      'check',
      'share_preference',
      'explore',
      'save',
      'custom',
    ])
    expect(IMAGE_TEMPLATES.map((t) => t.id)).toEqual([
      'detail',
      'consultation',
      'design_consult',
      'studio',
      'assessment',
      'editorial',
    ])
  })
})
