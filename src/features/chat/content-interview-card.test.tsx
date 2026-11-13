import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentInterviewView } from './content-interview'
import { ContentInterviewCard } from './content-interview-card'
import type { WorkspaceStyleSummary } from '@/features/image-style/style-summary'
import { loadWorkspaceStyleSummaryAction } from '@/features/image-style/actions/load-style-summary'

vi.mock('@/features/image-style/actions/load-style-summary', () => ({
  loadWorkspaceStyleSummaryAction: vi.fn(),
}))

const mockLoadStyleSummary = vi.mocked(loadWorkspaceStyleSummaryAction)

const configuredStyleSummary: WorkspaceStyleSummary = {
  image: {
    configured: true,
    headline: '자연스럽고 편안한 우리 매장 분위기',
    referenceCount: 2,
    references: [
      { id: 'ref-1', url: '/api/workspaces/ws-1/media/ref-1', note: '밝은 조명과 정돈된 매장 진열' },
      { id: 'ref-2', url: '/api/workspaces/ws-1/media/ref-2', note: '실제 작업 공간 전경' },
    ],
    hasGuide: true,
    custom: true,
  },
  text: {
    configured: true,
    voiceSummary: '친절하고 차분한 어조로 핵심만 명확히 설명하는 글',
  },
  overlay: null,
}

const unconfiguredStyleSummary: WorkspaceStyleSummary = {
  image: {
    configured: false,
    headline: '',
    referenceCount: 0,
    references: [],
    hasGuide: false,
    custom: false,
  },
  text: {
    configured: false,
    voiceSummary: '',
  },
  overlay: null,
}

const stepOneView: ContentInterviewView = {
  kind: 'content_interview',
  status: 'collecting',
  step: 1,
  totalSteps: 4,
  question: '이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?',
  options: [
    { value: 'consultation', label: '상담 문의를 늘리고 싶어요' },
    { value: 'portfolio', label: '시술·작업 사례를 보여주고 싶어요' },
    { value: 'custom', label: '직접 입력할게요' },
  ],
  optionGroups: [],
  previousAnswers: [],
}

const fourthStepView: ContentInterviewView = {
  kind: 'content_interview',
  status: 'collecting',
  step: 4,
  totalSteps: 4,
  question: '글을 읽은 분이 어떤 행동을 하면 좋을까요?',
  options: [],
  optionGroups: [
    {
      key: 'callToAction',
      label: '행동 유도',
      options: [
        { value: 'consult', label: '부담 없이 상담 문의하기' },
        { value: 'custom', label: '직접 입력할게요' },
      ],
    },
  ],
  imageTemplates: [
    {
      id: 'detail',
      label: '눈썹 디테일 클로즈업',
      description: '결과 결을 가까이 보여주는 장면',
      imageSrc: '/images/templates/byreum/detail.webp',
      recommended: false,
      defaults: { modelAge: '30s', framing: 'face', pose: 'front', background: 'bright_studio', textOverlay: 'none' },
    },
    {
      id: 'design_consult',
      label: '시술 디자인 설명',
      description: '상담자가 디자인 기준을 설명하는 장면',
      imageSrc: '/images/templates/byreum/design-consult.webp',
      recommended: true,
      defaults: { modelAge: '30s', framing: 'upper_body', pose: 'explaining', background: 'warm_studio', textOverlay: 'none' },
    },
  ],
  previousAnswers: [
    { step: 1, label: '상담 문의를 늘리고 싶어요' },
    { step: 2, label: '인천 청라와 주변 지역에서 상담할 사람', customText: '처음 방문해도 안심할 수 있는 기준' },
  ],
}

const completedView: ContentInterviewView = {
  ...fourthStepView,
  status: 'ready_to_generate',
  summary: {
    channels: ['instagram', 'threads'],
    goal: '상담 문의를 늘리고 싶어요',
    audience: '인천 청라와 주변 지역에서 상담할 사람',
    structure: '일상 고민 공감 → 맞춤 기준 설명 → 상담 안내',
    imageMood: '눈썹 디테일과 결을 가까이 보여주는 장면',
    callToAction: '부담 없이 상담 문의하기',
    referenceMediaCount: 2,
    mustInclude: ['청라 상담 가능'],
    mustAvoid: ['가격을 단정하지 않기'],
    audienceProblem: '인천 청라와 주변 지역에서 상담할 사람',
    tone: '따뜻하고 이해하기 쉬운 말투',
    messageAngle: '일상 고민 공감 → 맞춤 기준 설명 → 상담 안내',
    imageComposition: '눈썹 디테일과 결을 가까이 보여주는 구도',
    sceneRoles: ['눈썹 디테일과 결을 보여주는 장면'],
    imageAvoid: ['가격을 단정하지 않기'],
  },
}

describe('ContentInterviewCard', () => {
  it('고정 질문 대신 바로 초안 제작을 선택할 수 있고 중복 제출하지 않는다', () => {
    const onSubmit = vi.fn()
    render(<ContentInterviewCard clarification={stepOneView} onSubmit={onSubmit} />)
    const button = screen.getByRole('button', { name: '질문 생략하고 초안 만들기' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(onSubmit.mock.calls[0][0].message)).toEqual({ kind: 'content_interview_control', action: 'quick_generate' })
  })
  it('이벤트 정보 질문에서는 멀티라인 입력창과 나중에 채울게요 버튼을 렌더링하고 제출한다', () => {
    const onSubmit = vi.fn()
    const eventFactsView: ContentInterviewView = {
      kind: 'content_interview',
      status: 'collecting',
      step: 1,
      totalSteps: 4,
      stepLabel: '이벤트 정보 · 1 / 4',
      questionId: 'eventFacts',
      questionKind: 'event_facts',
      question: '이벤트(프로모션) 정보를 알려 주세요',
      options: [{ value: 'skip', label: '나중에 채울게요' }],
      optionGroups: [],
      previousAnswers: [],
    }

    render(<ContentInterviewCard clarification={eventFactsView} onSubmit={onSubmit} />)

    expect(screen.getByText('이벤트 정보 · 1 / 4')).toBeInTheDocument()
    expect(screen.getByText('이벤트(프로모션) 정보를 알려 주세요')).toBeInTheDocument()
    const textarea = screen.getByRole('textbox', { name: '이벤트 상세 내용 직접 적어 주세요' })
    expect(textarea).toBeInTheDocument()
    expect(textarea).not.toHaveAttribute('aria-label')
    expect(textarea.id).toBeTruthy()
    expect(screen.getByText('이벤트 상세 내용 직접 적어 주세요').closest('label')).toHaveAttribute('for', textarea.id)
    expect(screen.getByRole('button', { name: '나중에 채울게요' })).toBeInTheDocument()

    // 1) 텍스트 입력 후 제출
    fireEvent.change(textarea, { target: { value: '가을 20% 할인 이벤트' } })
    fireEvent.click(screen.getByRole('button', { name: '이 답변으로 계속하기' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(onSubmit.mock.calls[0][0].message)).toEqual({
      value: 'custom',
      source: 'free_text',
      customText: '가을 20% 할인 이벤트',
    })
  })

  it('질문 문자열과 무관하게 questionId/questionKind 필드로 이벤트 정보 질문을 판별한다', () => {
    const onSubmit = vi.fn()
    const eventFactsCustomTextView: ContentInterviewView = {
      kind: 'content_interview',
      status: 'collecting',
      step: 1,
      totalSteps: 4,
      stepLabel: '이벤트 정보 · 1 / 4',
      questionId: 'eventFacts',
      questionKind: 'event_facts',
      question: '이번 행사 상세 내용을 알려주세요 (커스텀 문구)',
      options: [{ value: 'skip', label: '나중에 채울게요' }],
      optionGroups: [],
      previousAnswers: [],
    }

    render(<ContentInterviewCard clarification={eventFactsCustomTextView} onSubmit={onSubmit} />)

    // question 문자열이 달라도 이벤트 상세 내용 textarea가 렌더링되어야 함
    expect(screen.getByRole('textbox', { name: '이벤트 상세 내용 직접 적어 주세요' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '나중에 채울게요' })).toBeInTheDocument()
  })

  it('이벤트 정보 질문에서 나중에 채울게요 버튼 클릭 시 skip 페이로드를 제출한다', () => {
    const onSubmit = vi.fn()
    const eventFactsView: ContentInterviewView = {
      kind: 'content_interview',
      status: 'collecting',
      step: 1,
      totalSteps: 4,
      stepLabel: '이벤트 정보 · 1 / 4',
      questionId: 'eventFacts',
      questionKind: 'event_facts',
      question: '이벤트(프로모션) 정보를 알려 주세요',
      options: [{ value: 'skip', label: '나중에 채울게요' }],
      optionGroups: [],
      previousAnswers: [],
    }

    render(<ContentInterviewCard clarification={eventFactsView} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '나중에 채울게요' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(onSubmit.mock.calls[0][0].message)).toEqual({
      value: 'skip',
      source: 'option',
      customText: '나중에 채울게요',
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadStyleSummary.mockResolvedValue({ data: unconfiguredStyleSummary })
  })

  it('단계, 선택지, 직접 입력을 표시하고 선택을 일반 제출로 보낸다', async () => {
    const onSubmit = vi.fn()
    render(<ContentInterviewCard clarification={stepOneView} disabled={false} onSubmit={onSubmit} />)

    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: [] }))
    expect(JSON.parse(onSubmit.mock.calls[0]?.[0].message ?? '')).toEqual({
      value: 'consultation',
      source: 'option',
    })
    expect(onSubmit.mock.calls[0]?.[0].displayMessage).toBe('상담 문의를 늘리고 싶어요')
    expect(onSubmit.mock.calls[0]?.[0].clientMessageId).toMatch(/^[0-9a-f-]{36}$/iu)
  })

  it('직접 입력을 선택하면 입력창과 제출 버튼이 열린다', async () => {
    const onSubmit = vi.fn()
    render(<ContentInterviewCard clarification={stepOneView} disabled={false} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '직접 입력할게요' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '우리 동네에서 차분하게 이야기하고 싶어요' } })
    fireEvent.click(screen.getByRole('button', { name: '이 답변으로 계속하기' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: [] }))
    expect(JSON.parse(onSubmit.mock.calls[0]?.[0].message ?? '')).toEqual({
      value: 'custom',
      customText: '우리 동네에서 차분하게 이야기하고 싶어요',
      source: 'free_text',
    })
    expect(onSubmit.mock.calls[0]?.[0].displayMessage).toBe('우리 동네에서 차분하게 이야기하고 싶어요')
  })

  describe('요구사항 TDD 검증', () => {
    const thirdStepView: ContentInterviewView = {
      kind: 'content_interview',
      status: 'collecting',
      step: 3,
      totalSteps: 4,
      question: '어떤 흐름으로 글을 작성할까요?',
      options: [
        { value: 'empathy_info_consult', label: '일상 고민 공감 → 맞춤 기준 설명 → 상담 안내' },
      ],
      optionGroups: [],
      previousAnswers: [],
    }

    it('(a) 스타일 등록 시: 기본 선택·썸네일·노트·제출 payload 및 기준 사진 선택 제어', async () => {
      mockLoadStyleSummary.mockResolvedValue({ data: configuredStyleSummary })
      const onSubmit = vi.fn()
      const { unmount } = render(
        <ContentInterviewCard
          clarification={fourthStepView}
          disabled={false}
          onSubmit={onSubmit}
          workspaceId="ws-123"
        />,
      )

      await waitFor(() => {
        expect(mockLoadStyleSummary).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      })

      // 기본 선택 카드 "우리 매장 이미지 스타일 그대로" 및 추천 배지, headline 확인
      expect(screen.getByText('우리 매장 이미지 스타일 그대로')).toBeInTheDocument()
      expect(screen.getByText('추천')).toBeInTheDocument()
      expect(screen.getByText('자연스럽고 편안한 우리 매장 분위기')).toBeInTheDocument()

      // 기준 사진 썸네일(img alt) 및 노트 확인
      expect(screen.getByAltText('기준 사진 1')).toBeInTheDocument()
      expect(screen.getByAltText('기준 사진 2')).toBeInTheDocument()
      expect(screen.getByText('밝은 조명과 정돈된 매장 진열')).toBeInTheDocument()
      expect(screen.getByText('실제 작업 공간 전경')).toBeInTheDocument()

      // 기본은 전부 선택
      const refCheck1 = screen.getByRole('checkbox', { name: '기준 사진 1 참고' })
      const refCheck2 = screen.getByRole('checkbox', { name: '기준 사진 2 참고' })
      expect(refCheck1).toBeChecked()
      expect(refCheck2).toBeChecked()

      // 텍스트 오버레이 변경
      fireEvent.change(screen.getByRole('combobox', { name: '텍스트 요소' }), {
        target: { value: 'short_copy' },
      })

      // 행동 유도 선택 후 제출: 기본은 전체 선택(styleReferenceIds: ['ref-1', 'ref-2'])
      fireEvent.click(screen.getByRole('button', { name: '부담 없이 상담 문의하기' }))
      fireEvent.click(screen.getByRole('button', { name: '이 설정으로 계속하기' }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const submission1 = JSON.parse(onSubmit.mock.calls[0][0].message)
      expect(submission1.image).toEqual({ value: 'workspace_style', source: 'option' })
      expect(submission1.imagePreferences).toMatchObject({
        templateId: 'workspace_style',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'front',
        background: 'bright_studio',
        textOverlay: 'short_copy',
        styleReferenceIds: ['ref-1', 'ref-2'],
      })
      unmount()

      // 2) 일부만 해제 시 (ref-2 해제)
      const onSubmitPartial = vi.fn()
      const view2 = render(
        <ContentInterviewCard
          clarification={fourthStepView}
          disabled={false}
          onSubmit={onSubmitPartial}
          workspaceId="ws-123"
        />,
      )
      await waitFor(() => {
        expect(mockLoadStyleSummary).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      })
      const check2ToUncheck = view2.getByRole('checkbox', { name: '기준 사진 2 참고' })
      fireEvent.click(check2ToUncheck)
      expect(check2ToUncheck).not.toBeChecked()

      fireEvent.click(view2.getByRole('button', { name: '부담 없이 상담 문의하기' }))
      fireEvent.click(view2.getByRole('button', { name: '이 설정으로 계속하기' }))
      expect(onSubmitPartial).toHaveBeenCalledTimes(1)
      const submission2 = JSON.parse(onSubmitPartial.mock.calls[0][0].message)
      expect(submission2.imagePreferences.styleReferenceIds).toEqual(['ref-1'])
      view2.unmount()

      // 3) 전부 해제 시 styleReferenceIds 키 생략 (undefined -> JSON에 없음)
      const onSubmitNone = vi.fn()
      const view3 = render(
        <ContentInterviewCard
          clarification={fourthStepView}
          disabled={false}
          onSubmit={onSubmitNone}
          workspaceId="ws-123"
        />,
      )
      await waitFor(() => {
        expect(mockLoadStyleSummary).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      })
      const c1 = view3.getByRole('checkbox', { name: '기준 사진 1 참고' })
      const c2 = view3.getByRole('checkbox', { name: '기준 사진 2 참고' })
      fireEvent.click(c1)
      fireEvent.click(c2)
      expect(c1).not.toBeChecked()
      expect(c2).not.toBeChecked()

      fireEvent.click(view3.getByRole('button', { name: '부담 없이 상담 문의하기' }))
      fireEvent.click(view3.getByRole('button', { name: '이 설정으로 계속하기' }))
      expect(onSubmitNone).toHaveBeenCalledTimes(1)
      const submission3 = JSON.parse(onSubmitNone.mock.calls[0][0].message)
      expect(submission3.imagePreferences.styleReferenceIds).toBeUndefined()
      view3.unmount()
    })

    it('(b) 스타일 미등록: byreum 이미지 경로가 DOM 어디에도 없고 CTA 링크가 있으며 제출 payload 가 workspace_style', async () => {
      mockLoadStyleSummary.mockResolvedValue({ data: unconfiguredStyleSummary })
      const onSubmit = vi.fn()
      render(
        <ContentInterviewCard
          clarification={fourthStepView}
          disabled={false}
          onSubmit={onSubmit}
          workspaceId="ws-123"
        />,
      )

      await waitFor(() => {
        expect(mockLoadStyleSummary).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      })

      // byreum 이미지 경로가 DOM 어디에도 없음
      const html = document.body.innerHTML
      expect(html).not.toContain('/images/templates/byreum')

      // 안내 카드 및 next/link 확인
      expect(screen.getByText('아직 이미지 스타일이 없어요. 링크나 사진으로 1분이면 만들 수 있어요.')).toBeInTheDocument()
      const ctaLink = screen.getByRole('link', { name: '이미지 스타일 만들기' })
      expect(ctaLink).toHaveAttribute('href', '/app/settings/image-style')

      // "소희가 업종에 맞게 알아서"가 기본 선택 가능
      expect(screen.getByText('소희가 업종에 맞게 알아서')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '부담 없이 상담 문의하기' }))
      fireEvent.click(screen.getByRole('button', { name: '이 설정으로 계속하기' }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const submission = JSON.parse(onSubmit.mock.calls[0][0].message)
      expect(submission.image).toEqual({ value: 'workspace_style', source: 'option' })
      expect(submission.imagePreferences.templateId).toBe('workspace_style')
    })

    it('(c) 장면 칩을 고르면 template.id 로 제출', async () => {
      mockLoadStyleSummary.mockResolvedValue({ data: configuredStyleSummary })
      const onSubmit = vi.fn()
      render(
        <ContentInterviewCard
          clarification={fourthStepView}
          disabled={false}
          onSubmit={onSubmit}
          workspaceId="ws-123"
        />,
      )

      await waitFor(() => {
        expect(mockLoadStyleSummary).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      })

      // 장면 느낌 직접 고르기 details 열기 및 칩 선택
      const details = screen.getByText('장면 느낌 직접 고르기 (선택)').closest('details')
      expect(details).toBeInTheDocument()
      expect(details).not.toHaveAttribute('open')

      const detailChip = screen.getByRole('button', { name: /디테일 클로즈업/ })
      fireEvent.click(detailChip)

      fireEvent.click(screen.getByRole('button', { name: '부담 없이 상담 문의하기' }))
      fireEvent.click(screen.getByRole('button', { name: '이 설정으로 계속하기' }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const submission = JSON.parse(onSubmit.mock.calls[0][0].message)
      expect(submission.image).toEqual({ value: 'detail', source: 'option' })
      expect(submission.imagePreferences.templateId).toBe('detail')
      expect(submission.imagePreferences.styleReferenceIds).toEqual(['ref-1', 'ref-2'])
    })

    it('(d) 3단계 글 방식 상태 줄 두 경우', async () => {
      // 1) text.configured 인 경우
      mockLoadStyleSummary.mockResolvedValue({ data: configuredStyleSummary })
      const { unmount } = render(
        <ContentInterviewCard
          clarification={thirdStepView}
          onSubmit={vi.fn()}
          workspaceId="ws-123"
        />,
      )

      await waitFor(() => {
        expect(
          screen.getByText(/우리 글 방식 적용 중 — 친절하고 차분한 어조로 핵심만 명확히 설명하는 글/),
        ).toBeInTheDocument()
      })
      const editLink = screen.getByRole('link', { name: '수정' })
      expect(editLink).toHaveAttribute('href', '/app/settings/brand')
      unmount()

      // 2) text 미등록인 경우
      mockLoadStyleSummary.mockResolvedValue({ data: unconfiguredStyleSummary })
      render(
        <ContentInterviewCard
          clarification={thirdStepView}
          onSubmit={vi.fn()}
          workspaceId="ws-123"
        />,
      )

      await waitFor(() => {
        expect(
          screen.getByText('글 쓰는 방식을 링크로 만들어 두면 매번 같은 느낌으로 써요'),
        ).toBeInTheDocument()
      })
      const createLink = screen.getByRole('link', { name: '만들기' })
      expect(createLink).toHaveAttribute('href', '/app/settings/image-style')
    })

    it('(e) workspaceId 없이도 렌더·제출 가능', async () => {
      const onSubmit = vi.fn()
      render(
        <ContentInterviewCard
          clarification={fourthStepView}
          disabled={false}
          onSubmit={onSubmit}
        />,
      )

      // loadStyleSummary가 호출되지 않음
      expect(mockLoadStyleSummary).not.toHaveBeenCalled()

      // 미등록 상태로 렌더링됨
      expect(screen.getByText('아직 이미지 스타일이 없어요. 링크나 사진으로 1분이면 만들 수 있어요.')).toBeInTheDocument()
      expect(screen.getByText('소희가 업종에 맞게 알아서')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '부담 없이 상담 문의하기' }))
      fireEvent.click(screen.getByRole('button', { name: '이 설정으로 계속하기' }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const submission = JSON.parse(onSubmit.mock.calls[0][0].message)
      expect(submission.image).toEqual({ value: 'workspace_style', source: 'option' })
      expect(submission.imagePreferences.templateId).toBe('workspace_style')
    })
  })

  it('4단계는 콘텐츠 질문과 장면 느낌 선택을 검토한 뒤 구조화된 답변으로 보낸다', async () => {
    const onSubmit = vi.fn()
    render(<ContentInterviewCard attachmentIds={['60000000-0000-4000-8000-000000000001']} clarification={fourthStepView} disabled={false} onSubmit={onSubmit} />)

    expect(screen.getByRole('region', { name: '이미지 인터뷰' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '부담 없이 상담 문의하기' }))

    // 장면 느낌 직접 고르기 details를 열고 시술 디자인 설명 칩 선택
    const detailsSummary = screen.getByText('장면 느낌 직접 고르기 (선택)')
    fireEvent.click(detailsSummary)
    fireEvent.click(screen.getByRole('button', { name: /시술 디자인 설명/u }))
    fireEvent.change(screen.getByRole('combobox', { name: '모델 연령' }), { target: { value: '40s' } })
    fireEvent.change(screen.getByRole('textbox', { name: '이미지에 추가로 원하는 점' }), {
      target: { value: '제품이 자연스럽게 보이게 해 주세요.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '이 설정으로 계속하기' }))

    const submission = onSubmit.mock.calls[0]?.[0]
    expect(submission?.attachmentIds).toEqual(['60000000-0000-4000-8000-000000000001'])
    expect(JSON.parse(submission?.message ?? '')).toEqual({
      image: { value: 'design_consult', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
      imagePreferences: {
        templateId: 'design_consult',
        modelAge: '40s',
        framing: 'upper_body',
        pose: 'explaining',
        background: 'warm_studio',
        textOverlay: 'none',
        extraDirection: '제품이 자연스럽게 보이게 해 주세요.',
      },
    })
    expect(submission?.displayMessage).toBe('행동 유도: 부담 없이 상담 문의하기 · 이미지 스타일: 시술 디자인 설명')
  })

  it('4단계 행동 유도 자유 입력과 기본 이미지 설정을 함께 보존한다', async () => {
    const onSubmit = vi.fn()
    render(<ContentInterviewCard clarification={fourthStepView} disabled={false} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '행동 유도 직접 입력할게요' }))
    fireEvent.change(screen.getByRole('textbox', { name: '행동 유도 직접 입력' }), { target: { value: '원하는 분위기를 메시지로 알려 주세요' } })
    fireEvent.click(screen.getByRole('button', { name: '이 설정으로 계속하기' }))

    const submission = onSubmit.mock.calls[0]?.[0]
    expect(JSON.parse(submission?.message ?? '')).toEqual({
      image: { value: 'workspace_style', source: 'option' },
      callToAction: { value: 'custom', customText: '원하는 분위기를 메시지로 알려 주세요', source: 'free_text' },
      imagePreferences: {
        templateId: 'workspace_style',
        modelAge: '30s',
        framing: 'upper_body',
        pose: 'front',
        background: 'bright_studio',
        textOverlay: 'none',
      },
    })
  })

  it('완료 요약에 이전 답변, 참고 이미지 수, 필수·제외 내용을 표시한다', () => {
    render(<ContentInterviewCard clarification={completedView} disabled={false} onSubmit={vi.fn()} />)

    expect(screen.getByText('소희가 이해한 제작 방향')).toBeInTheDocument()
    expect(screen.getAllByText('상담 문의를 늘리고 싶어요')).not.toHaveLength(0)
    expect(screen.getByText('참고 이미지 2장')).toBeInTheDocument()
    expect(screen.getByText('청라 상담 가능')).toBeInTheDocument()
    expect(screen.getAllByText('가격을 단정하지 않기')).not.toHaveLength(0)
    expect(screen.getAllByText('인천 청라와 주변 지역에서 상담할 사람')).not.toHaveLength(0)
    expect(screen.getByText('따뜻하고 이해하기 쉬운 말투')).toBeInTheDocument()
    expect(screen.getByText('이전 답변 접기')).toBeInTheDocument()
  })

  it('완료 요약에 추가 이미지 요청(imageExtraDirection)이 있을 때 화면에 렌더링한다', () => {
    const viewWithExtra: ContentInterviewView = {
      ...completedView,
      summary: {
        ...completedView.summary!,
        imageExtraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
      },
    }
    render(<ContentInterviewCard clarification={viewWithExtra} disabled={false} onSubmit={vi.fn()} />)

    expect(screen.getByText('이미지에 추가로 원하는 점')).toBeInTheDocument()
    expect(screen.getByText('이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트')).toBeInTheDocument()
  })

  it('생성 전 요약에서 단계별 수정과 제작 시작을 구조화된 제어 메시지로 보낸다', () => {
    const onSubmit = vi.fn()
    const editView = render(<ContentInterviewCard clarification={completedView} disabled={false} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '2단계 수정' }))
    expect(JSON.parse(onSubmit.mock.calls[0]?.[0].message ?? '')).toEqual({
      kind: 'content_interview_control',
      action: 'edit',
      step: 2,
    })
    expect(onSubmit.mock.calls[0]?.[0].displayMessage).toBe('2단계 답변 수정')

    const onStart = vi.fn()
    editView.unmount()
    const startView = render(<ContentInterviewCard clarification={completedView} disabled={false} onSubmit={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: '이 방향으로 제작 시작' }))
    expect(JSON.parse(onStart.mock.calls[0]?.[0].message ?? '')).toEqual({
      kind: 'content_interview_control',
      action: 'start_generation',
    })
    expect(onStart.mock.calls[0]?.[0].displayMessage).toBe('이 방향으로 제작 시작')
    startView.unmount()
  })

  it('완료·취소 상태에서는 생성 전 요약을 다시 표시하지 않는다', () => {
    render(<ContentInterviewCard clarification={{ ...completedView, status: 'completed' }} disabled={false} onSubmit={vi.fn()} />)
    expect(screen.queryByText('소희가 이해한 제작 방향')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 방향으로 제작 시작' })).not.toBeInTheDocument()
  })

  it('답변 제출 중에는 모든 질문 조작을 비활성화하고 첨부 안내를 표시한다', () => {
    render(<ContentInterviewCard clarification={stepOneView} disabled onSubmit={vi.fn()} />)

    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeDisabled()
    expect(screen.getByText('아래 입력창에서 이미지도 첨부할 수 있어요.')).toBeInTheDocument()
  })

  it('빈 자유 입력은 제출하지 않는다', async () => {
    const onSubmit = vi.fn()
    render(<ContentInterviewCard clarification={stepOneView} disabled={false} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '직접 입력할게요' }))
    fireEvent.click(screen.getByRole('button', { name: '이 답변으로 계속하기' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })
})
