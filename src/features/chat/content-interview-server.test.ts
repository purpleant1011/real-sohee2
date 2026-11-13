import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_INFO_INSTRUCTION,
  advanceContentInterview,
  buildContentBrief,
  createInitialContentInterview,
  serializeContentInterviewControl,
  type ContentInterviewState,
} from './content-interview'
import { parseConversationPostRequest } from './conversation-post-intent'
import { decideContentInterviewTurn } from './content-interview-server'

const postRequest = {
  prompt: '인스타에 올려줘',
  candidates: [{
    channel: 'instagram' as const,
    count: 3 as const,
    direction: 'result' as const,
    instruction: '결과가 먼저 보이는 전후 기록형 완성 게시물로 제안하세요.',
  }],
}

function stateAfterThreeAnswers(): ContentInterviewState {
  let state = createInitialContentInterview({
    originalPrompt: '인스타에 올려줘',
    channels: ['instagram'],
    requestedImageCounts: { instagram: 3 },
    referenceMediaIds: ['media-1'],
  })
  state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
  state = advanceContentInterview(state, { value: 'local', source: 'option' })
  return advanceContentInterview(state, { value: 'empathy_info_consult', source: 'option' })
}

describe('decideContentInterviewTurn', () => {
  it('질문 생략 제작은 기존 답변·첨부를 보존하고 고정 인물 템플릿 없이 초안을 만든다', () => {
    const decision = decideContentInterviewTurn({
      active: stateAfterThreeAnswers(), parsedPostRequest: null,
      userContent: JSON.stringify({ kind: 'content_interview_control', action: 'quick_generate' }),
      attachmentIds: ['media-2'],
    })
    expect(decision).toMatchObject({ kind: 'ready_to_generate', generate: true })
    if (decision.kind !== 'ready_to_generate') throw new Error('expected draft generation')
    expect(decision.state.answers.goal).toEqual({ value: 'consultation', source: 'option' })
    expect(decision.brief.referenceMediaIds).toEqual(['media-1', 'media-2'])
    expect(decision.brief.imageDirection.templateId).toBeUndefined()
    expect(decision.brief.imageDirection.modelAge).toBeUndefined()
    expect(decision.brief.imageDirection.composition).toContain('요청 주제')
  })

  it.each([1, 2, 3, 4])('%i단계에서 질문 생략을 선택해도 검증 가능한 브리프를 만든다', step => {
    let active = createInitialContentInterview({ originalPrompt: '신메뉴 사진과 문구를 만들어줘', channels: ['instagram'], requestedImageCounts: { instagram: 1 }, referenceMediaIds: [] })
    while (active.step < step) active = advanceContentInterview(active, { value: 'custom', source: 'free_text', customText: '신메뉴 소개' })
    const decision = decideContentInterviewTurn({ active, parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }), attachmentIds: [],
    })
    expect(decision).toMatchObject({ kind: 'ready_to_generate', state: { status: 'ready_to_generate', step: 4 }, generate: true })
    if (decision.kind !== 'ready_to_generate') throw new Error('expected draft')
    expect(decision.state.originalPrompt).toBe(active.originalPrompt)
    expect(decision.state.requestedImageCounts).toEqual({ instagram: 1 })
    expect(decision.brief.imageDirection.templateId).toBeUndefined()
  })

  it('이벤트 목적에서 이벤트 정보 없이 질문 생략을 누르면 바로 생성하지 않고 이벤트 정보 질문을 1회 제시한다', () => {
    const active = createInitialContentInterview({
      originalPrompt: '가을 이벤트 인스타에 포스팅해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
      purpose: 'event',
    })

    const decision = decideContentInterviewTurn({
      active,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }),
      attachmentIds: [],
    })

    expect(decision).toMatchObject({
      kind: 'question',
      generate: false,
      clarification: {
        stepLabel: '이벤트 정보 · 1 / 4',
        question: '이벤트(프로모션) 정보를 알려 주세요',
      },
    })

    // 이어서 "나중에 채울게요"를 보내면 생성을 진행한다
    if (decision.kind !== 'question') throw new Error('expected question decision')
    const followUp = decideContentInterviewTurn({
      active: decision.state,
      parsedPostRequest: null,
      userContent: '나중에 채울게요',
      attachmentIds: [],
    })

    expect(followUp).toMatchObject({
      kind: 'ready_to_generate',
      generate: true,
      state: { status: 'ready_to_generate', step: 4 },
    })
    if (followUp.kind !== 'ready_to_generate') throw new Error('expected generation after skip')
    expect(followUp.brief.mustInclude).toContain(UNKNOWN_INFO_INSTRUCTION)
  })

  it('이벤트 목적에서 이벤트 정보 질문에 사실을 입력하면 질문 생략 초안 제작으로 이어진다', () => {
    const active = createInitialContentInterview({
      originalPrompt: '가을 프로모션 포스팅해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
      purpose: 'promotion',
    })

    const decision = decideContentInterviewTurn({
      active,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }),
      attachmentIds: [],
    })

    if (decision.kind !== 'question') throw new Error('expected question decision')
    const followUp = decideContentInterviewTurn({
      active: decision.state,
      parsedPostRequest: null,
      userContent: '가을 맞이 20% 할인 / 11월 한 달 / 네이버 예약 시 적용',
      attachmentIds: [],
    })

    expect(followUp).toMatchObject({
      kind: 'ready_to_generate',
      generate: true,
    })
    if (followUp.kind !== 'ready_to_generate') throw new Error('expected generation with facts')
    expect(followUp.brief.eventFacts).toBe('가을 맞이 20% 할인 / 11월 한 달 / 네이버 예약 시 적용')
    expect(followUp.brief.mustInclude).toContain('가을 맞이 20% 할인 / 11월 한 달 / 네이버 예약 시 적용')
  })

  it('이전 버전에서 생성된 step 3 이벤트 상태에서 질문 생략 시 오류 없이 생성을 진행한다', () => {
    const preChangeStep3State: ContentInterviewState = {
      kind: 'content_interview',
      status: 'collecting',
      step: 3,
      originalPrompt: '가을 이벤트 인스타에 포스팅해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
      purpose: 'event',
      answers: {
        goal: { value: 'custom', customText: '이벤트 홍보', source: 'free_text' },
        audience: { value: 'first_time', source: 'option' },
      },
    }

    const decision = decideContentInterviewTurn({
      active: preChangeStep3State,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }),
      attachmentIds: [],
    })

    expect(decision).toMatchObject({
      kind: 'ready_to_generate',
      generate: true,
      state: { status: 'ready_to_generate', step: 4 },
    })
    if (decision.kind !== 'ready_to_generate') throw new Error('expected ready_to_generate')
    expect(decision.state.pendingQuickGenerate).toBeUndefined()
  })

  it('이벤트 정보 질문이 이미 표시된 상태에서 다시 질문 생략을 누르면 루프에 빠지지 않고 생성을 진행한다', () => {
    const active = createInitialContentInterview({
      originalPrompt: '가을 이벤트 인스타에 포스팅해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
      purpose: 'event',
    })

    const firstDecision = decideContentInterviewTurn({
      active,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }),
      attachmentIds: [],
    })

    expect(firstDecision).toMatchObject({
      kind: 'question',
      generate: false,
      state: { pendingQuickGenerate: true },
    })

    if (firstDecision.kind !== 'question') throw new Error('expected question decision')
    const loopDecision = decideContentInterviewTurn({
      active: firstDecision.state,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }),
      attachmentIds: [],
    })

    expect(loopDecision).toMatchObject({
      kind: 'ready_to_generate',
      generate: true,
      state: { status: 'ready_to_generate', step: 4 },
    })
    if (loopDecision.kind !== 'ready_to_generate') throw new Error('expected ready_to_generate')
    expect(loopDecision.state.pendingQuickGenerate).toBeUndefined()
  })

  it('이벤트 정보 입력 후 질문 생략 완료 시 ready 상태에서 pendingQuickGenerate가 제거된다', () => {
    const active = createInitialContentInterview({
      originalPrompt: '가을 프로모션 포스팅해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
      purpose: 'promotion',
    })

    const decision = decideContentInterviewTurn({
      active,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'quick_generate' }),
      attachmentIds: [],
    })

    if (decision.kind !== 'question') throw new Error('expected question decision')
    const followUp = decideContentInterviewTurn({
      active: decision.state,
      parsedPostRequest: null,
      userContent: '가을 맞이 20% 할인',
      attachmentIds: [],
    })

    expect(followUp).toMatchObject({
      kind: 'ready_to_generate',
      generate: true,
    })
    if (followUp.kind !== 'ready_to_generate') throw new Error('expected ready_to_generate')
    expect(followUp.state.pendingQuickGenerate).toBeUndefined()
  })

  it('진행 중인 질문이 없으면 질문 생략 제어로 새 작업을 만들지 않는다', () => {
    expect(decideContentInterviewTurn({ active: null, parsedPostRequest: null,
      userContent: JSON.stringify({ kind: 'content_interview_control', action: 'quick_generate' }), attachmentIds: [],
    })).toEqual({ kind: 'not_interview', generate: false })
  })
  it('does not reinterpret a review control as a fourth-step free-text answer', () => {
    const state = stateAfterThreeAnswers()
    const decision = decideContentInterviewTurn({
      active: state,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'start_generation' }),
      attachmentIds: [],
    })

    expect(decision).toMatchObject({ kind: 'question', state: { status: 'collecting', step: 4 } })
    if (decision.kind === 'question') {
      expect(JSON.stringify(decision.state)).not.toContain('content_interview_control')
    }
  })
  it('4단계 JSON 응답에서 styleReferenceIds가 포함된 imagePreferences를 브리프로 전달한다', () => {
    const id1 = '11111111-1111-4111-8111-111111111111'
    const id2 = '22222222-2222-4222-8222-222222222222'
    const state = stateAfterThreeAnswers()
    const userContent = JSON.stringify({
      image: { value: 'design_consult' },
      callToAction: { value: 'consult' },
      imagePreferences: {
        templateId: 'design_consult',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'explaining',
        background: 'warm_studio',
        textOverlay: 'none',
        styleReferenceIds: [id1, id2],
      },
    })
    const decision = decideContentInterviewTurn({
      active: state,
      parsedPostRequest: null,
      userContent,
      attachmentIds: [],
    })
    // 4단계 답변 뒤에는 생성 시작 확인 카드가 먼저 나온다(상태만 ready_to_generate).
    expect(decision).toMatchObject({ kind: 'question', state: { status: 'ready_to_generate', step: 4 } })
    if (decision.kind !== 'question') throw new Error('expected question')
    expect(decision.state.answers.visualCta?.imagePreferences?.styleReferenceIds).toEqual([id1, id2])
    expect(buildContentBrief(decision.state).imageDirection.styleReferenceIds).toEqual([id1, id2])
  })
  it('원본 사진 사용 요청은 처음부터 실제 첨부 수를 제작 브리프에 고정한다', () => {
    const prompt = '인스타그램에 첨부 사진 원본을 그대로 사용해서 게시물을 만들어줘.'
    const decision = decideContentInterviewTurn({ active: null, parsedPostRequest: { ...postRequest, prompt }, userContent: prompt, attachmentIds: ['photo-1'] })
    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected question')
    expect(decision.state.requestedImageCounts.instagram).toBe(1)
    expect(decision.state.referenceMediaIds).toEqual(['photo-1'])
  })

  it('새 게시 요청은 생성 없이 첫 질문 결정으로 끝난다', () => {
    const decision = decideContentInterviewTurn({
      active: null,
      parsedPostRequest: postRequest,
      userContent: '인스타에 올려줘',
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected interview question')
    expect(decision.state.step).toBe(1)
    expect(decision.generate).toBe(false)
  })

  it('goal-unlinked Naver preparation restarts questions and does not inherit strategy approval or start generation', () => {
    const ready = advanceContentInterview(stateAfterThreeAnswers(), {
      image: { value: 'detail', source: 'option' }, callToAction: { value: 'consult', source: 'option' },
    })
    const prompt = '네이버 블로그 글 작성해줘.'
    const decision = decideContentInterviewTurn({
      active: { ...ready, marketingStrategy: { missionId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222', briefId: '33333333-3333-4333-8333-333333333333', revision: 1 } },
      parsedPostRequest: parseConversationPostRequest(prompt), userContent: prompt, attachmentIds: [],
    })
    expect(decision).toMatchObject({ kind: 'question', generate: false, state: { status: 'collecting', step: 1, channels: ['naver_blog'] } })
    if (decision.kind !== 'question') throw new Error('expected questions, never generation')
    expect(decision.state.marketingStrategy).toBeUndefined()
    expect(decision.state.answers).toEqual({})
  })

  it('생성 전 검토가 남아 있어도 새 포스팅 의사는 새 1단계 인터뷰를 시작한다', () => {
    const ready = advanceContentInterview(stateAfterThreeAnswers(), {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
    })
    const threadsRequest = {
      prompt: '스레드에 포스팅하고 싶어',
      candidates: [{
        channel: 'threads' as const,
        count: 1 as const,
        direction: 'trust' as const,
        instruction: '상담 기준을 전달하세요.',
      }],
    }

    const decision = decideContentInterviewTurn({
      active: ready,
      parsedPostRequest: threadsRequest,
      userContent: threadsRequest.prompt,
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected restarted interview question')
    expect(decision.state).toMatchObject({
      status: 'collecting',
      step: 1,
      originalPrompt: threadsRequest.prompt,
      channels: ['threads'],
    })
    expect(decision.generate).toBe(false)
  })

  it('다른 채널의 새 포스팅 요청은 진행 중인 4단계 답변이 아니라 새 인터뷰로 전환한다', () => {
    const prompt = '인스타그램으로 이미지 3장 짜리 매장 포스팅을 만들어줘. 이번에는 새로운 소식을 소개하는 포스팅이면 좋겠어'
    const parsedPostRequest = parseConversationPostRequest(prompt)
    if (!parsedPostRequest) throw new Error('expected instagram post request')

    let threadsState = createInitialContentInterview({
      originalPrompt: '스레드에 매장 관련 포스팅해줘',
      channels: ['threads'],
      requestedImageCounts: { threads: 1 },
      referenceMediaIds: [],
    })
    threadsState = advanceContentInterview(threadsState, { value: 'expertise', source: 'option' })
    threadsState = advanceContentInterview(threadsState, { value: 'natural_design', source: 'option' })
    threadsState = advanceContentInterview(threadsState, { value: 'empathy_info_consult', source: 'option' })

    const decision = decideContentInterviewTurn({
      active: threadsState,
      parsedPostRequest,
      userContent: prompt,
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected restarted instagram interview')
    expect(decision.state).toMatchObject({
      status: 'collecting',
      step: 1,
      originalPrompt: prompt,
      channels: ['instagram'],
      requestedImageCounts: { instagram: 3 },
      answers: {},
    })
    expect(decision.clarification.summary).toBeUndefined()
    expect(decision.generate).toBe(false)
  })

  it('네 번째 답변은 생성 전 요약을 저장하고 생성은 시작하지 않는다', () => {
    const decision = decideContentInterviewTurn({
      active: stateAfterThreeAnswers(),
      parsedPostRequest: null,
      userContent: '이미지 분위기: 디테일과 결, 행동 유도: 상담 문의하기',
      attachmentIds: ['media-2'],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected review question')
    expect(decision.generate).toBe(false)
    expect(decision.state.status).toBe('ready_to_generate')
    expect(decision.state.referenceMediaIds).toEqual(['media-1', 'media-2'])
    expect(decision.clarification.summary?.referenceMediaCount).toBe(2)
  })

  it('4단계의 save CTA 문구는 취소가 아니라 정상 답변으로 해석한다', () => {
    const decision = decideContentInterviewTurn({
      active: stateAfterThreeAnswers(),
      parsedPostRequest: null,
      userContent: '저장하거나 나중에 다시 참고하기',
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected review question')
    expect(decision.state.status).toBe('ready_to_generate')
    expect(decision.clarification.summary?.callToAction).toContain('저장')
  })

  it('구조화된 시작 제어만 준비된 브리프를 생성 루트로 넘긴다', () => {
    const ready = advanceContentInterview(stateAfterThreeAnswers(), {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
    })
    const decision = decideContentInterviewTurn({
      active: ready,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'start_generation' }),
      attachmentIds: [],
    })

    expect(decision.kind).toBe('ready_to_generate')
    if (decision.kind !== 'ready_to_generate') throw new Error('expected generation decision')
    expect(decision.generate).toBe(true)
    expect(decision.brief.referenceMediaIds).toEqual(['media-1'])
  })

  it('구조화된 수정 제어는 선택 단계부터 collecting으로 되돌린다', () => {
    const ready = advanceContentInterview(stateAfterThreeAnswers(), {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
    })
    const decision = decideContentInterviewTurn({
      active: ready,
      parsedPostRequest: null,
      userContent: serializeContentInterviewControl({ action: 'edit', step: 2 }),
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected edit question')
    expect(decision.state.status).toBe('collecting')
    expect(decision.state.step).toBe(2)
    expect(decision.state.answers).toEqual({ goal: { value: 'consultation', source: 'option' } })
    expect(decision.state.referenceMediaIds).toEqual(['media-1'])
  })

  it('고정 선택지 라벨이 포함된 자유 문장은 customText로 보존한다', () => {
    const decision = decideContentInterviewTurn({
      active: createInitialContentInterview({
        originalPrompt: postRequest.prompt,
        channels: ['instagram'],
        requestedImageCounts: { instagram: 3 },
        referenceMediaIds: [],
      }),
      parsedPostRequest: null,
      userContent: '상담 문의를 늘리고 싶어요. 가격은 단정하지 말아 주세요.',
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected next question')
    expect(decision.state.answers.goal).toEqual({
      value: 'custom',
      customText: '상담 문의를 늘리고 싶어요. 가격은 단정하지 말아 주세요.',
      source: 'free_text',
    })
  })

  it('중단 표현은 취소 상태로 저장할 수 있는 결정이 된다', () => {
    const decision = decideContentInterviewTurn({
      active: stateAfterThreeAnswers(),
      parsedPostRequest: null,
      userContent: '나중에 할게요',
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected cancellation question')
    expect(decision.state.status).toBe('cancelled')
    expect(decision.generate).toBe(false)
    expect(decision.clarification?.question).toContain('이어갈 수 있어요')
  })

  it('부분 수정과 재시도 요청은 인터뷰를 다시 시작하지 않는다', () => {
    const decision = decideContentInterviewTurn({
      active: null,
      parsedPostRequest: postRequest,
      userContent: '실패한 이미지 한 장만 다시 만들어줘',
      attachmentIds: [],
      replyToMessageId: 'message-id',
    } as never)

    expect(decision.kind).toBe('not_interview')
    expect(decision.generate).toBe(false)
  })

  it('목적이 포함된 새 포스팅 요청은 1단계(목적)를 건너뛰고 2단계 질문으로 시작한다', () => {
    const prompt = '인스타그램, 네이버 블로그에 올릴 일상 포스팅을 만들어줘. 만들기 전에 필요한 것을 먼저 질문해줘.'
    const parsedPostRequest = parseConversationPostRequest(prompt)
    if (!parsedPostRequest) throw new Error('expected parsed post request')

    const decision = decideContentInterviewTurn({
      active: null,
      parsedPostRequest,
      userContent: prompt,
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected question decision')
    expect(decision.state.step).toBe(2)
    expect(decision.state.answers.goal).toEqual({
      value: 'custom',
      customText: '일상 소통',
      source: 'free_text',
    })
    expect(decision.clarification.step).toBe(2)
    expect(decision.generate).toBe(false)
  })

  it('이벤트 목적의 새 포스팅 요청은 목적을 사전 채우고 이벤트 정보 질문으로 시작한다', () => {
    const prompt = '인스타그램, 네이버 블로그에 올릴 이벤트 포스팅을 만들어줘. 만들기 전에 필요한 것을 먼저 질문해줘.'
    const parsedPostRequest = parseConversationPostRequest(prompt)
    if (!parsedPostRequest) throw new Error('expected parsed post request')

    const decision = decideContentInterviewTurn({
      active: null,
      parsedPostRequest,
      userContent: prompt,
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected question decision')
    expect(decision.state.step).toBe(1)
    expect(decision.state.answers.goal).toEqual({
      value: 'custom',
      customText: '이벤트 홍보',
      source: 'free_text',
    })
    expect(decision.clarification.stepLabel).toBe('이벤트 정보 · 1 / 4')
    expect(decision.clarification.questionId).toBe('eventFacts')
    expect(decision.clarification.questionKind).toBe('event_facts')
    expect(decision.clarification.question).toBe('이벤트(프로모션) 정보를 알려 주세요')
    expect(decision.generate).toBe(false)
  })

  it('4단계에서 workspace_style JSON 전송 시 option으로 정상 보존되고 extraDirection이 전파되며 내부코드가 mustInclude/composition에 오염되지 않는다', () => {
    let state = createInitialContentInterview({
      originalPrompt: '인스타그램 글 작성해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
    })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, { value: 'local', source: 'option' })
    state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
    expect(state.step).toBe(4)

    const payload = JSON.stringify({
      image: { value: 'workspace_style', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
      imagePreferences: {
        templateId: 'workspace_style',
        extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
      },
    })

    const decision = decideContentInterviewTurn({
      active: state,
      parsedPostRequest: null,
      userContent: payload,
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected question decision')
    expect(decision.state.status).toBe('ready_to_generate')
    const visual = decision.state.answers.visualCta
    expect(visual?.image).toEqual({ value: 'workspace_style', source: 'option' })
    expect(visual?.imagePreferences?.templateId).toBe('workspace_style')
    expect(visual?.imagePreferences?.extraDirection).toBe('이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트')

    const brief = decision.state.brief
    expect(brief).toBeDefined()
    expect(brief?.mustInclude).not.toContain('workspace_style')
    expect(brief?.imageDirection.composition).not.toBe('workspace_style')
    expect(brief?.imageDirection.sceneRoles).not.toEqual(['workspace_style'])
    expect(brief?.imageDirection.extraDirection).toBe('이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트')
    expect(decision.clarification.summary?.imageMood).not.toBe('workspace_style')
    expect(decision.clarification.summary?.imageComposition).not.toBe('workspace_style')
  })

  it('4단계 구조화 답변 CTA에 "게시물... 작성해 주세요"가 있어도 1/4로 리셋되지 않고 ready_to_generate로 완료된다', () => {
    let state = createInitialContentInterview({
      originalPrompt: '인스타그램 글 작성해줘',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 1 },
      referenceMediaIds: [],
    })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, { value: 'local', source: 'option' })
    state = advanceContentInterview(state, { value: 'short_natural', source: 'option' })
    expect(state.step).toBe(4)

    const payload = JSON.stringify({
      image: { value: 'consultation', source: 'option' },
      callToAction: {
        value: 'custom',
        source: 'free_text',
        customText: '행동 유도 없음. 본문은 …테스트 게시물입니다. 한 문장만, 해시태그·링크·추가 소개 없이 작성해 주세요.',
      },
      imagePreferences: {
        templateId: 'consultation',
        extraDirection: '비인물 1장',
      },
    })

    // 상위 route 등에서 parsedPostRequest가 오판정되어 전달된 상황 모사
    const parsedPostRequest = parseConversationPostRequest(payload)
    const decision = decideContentInterviewTurn({
      active: state,
      parsedPostRequest,
      userContent: payload,
      attachmentIds: [],
    })

    expect(decision.kind).toBe('question')
    if (decision.kind !== 'question') throw new Error('expected question decision')
    // 1단계로 리셋되지 않고 ready_to_generate로 완료되어야 함!
    expect(decision.state.status).toBe('ready_to_generate')
    expect(decision.state.step).toBe(4)
    expect(decision.clarification.stepLabel).not.toBe('1 / 4')

    // 반면 명시적인 일반 자연어 새 포스팅 요청은 기존 인터뷰를 리셋하고 새 인터뷰(1/4)로 시작
    const naturalReset = decideContentInterviewTurn({
      active: state,
      parsedPostRequest: parseConversationPostRequest('새로운 인스타 포스팅 작성해줘'),
      userContent: '새로운 인스타 포스팅 작성해줘',
      attachmentIds: [],
    })
    expect(naturalReset.kind).toBe('question')
    if (naturalReset.kind !== 'question') throw new Error('expected question decision')
    expect(naturalReset.state.step).toBe(1)
  })
})
