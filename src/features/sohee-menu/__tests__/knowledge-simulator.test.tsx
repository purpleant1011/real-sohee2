import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeSimulator } from '../components/knowledge-simulator'

describe('KnowledgeSimulator', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          answer: '저희 매장은 건물 지하 주차장에 최대 2시간 무료 주차가 가능해요!',
          usedFacts: [
            {
              id: 'fact-1',
              category: 'PARKING',
              content: '건물 지하 주차장 2시간 무료 지원',
            },
          ],
          hasLearnedKnowledge: true,
        },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('소희 아바타, 헤더 및 빠른 질문 칩 4종을 렌더링한다', () => {
    render(<KnowledgeSimulator workspaceId={workspaceId} />)

    // 헤더 및 서브 카피
    expect(screen.getByText('소희 지식 테스트 벤치')).toBeInTheDocument()
    expect(
      screen.getByText(
        '가르친 지식을 바탕으로 손님 응대와 홍보 글 작성을 어떻게 하는지 미리 테스트해 보세요',
      ),
    ).toBeInTheDocument()

    // 소희 아바타
    const avatar = screen.getByAltText('소희')
    expect(avatar).toBeInTheDocument()

    // 빠른 질문 칩 4종
    expect(screen.getByText('손님이 주차 문의하면?')).toBeInTheDocument()
    expect(screen.getByText('대표 메뉴 가격이랑 특징 알려줘')).toBeInTheDocument()
    expect(screen.getByText('우리 가게로 인스타 첫 문장 써봐')).toBeInTheDocument()
    expect(screen.getByText('예약 가능한지 물어보면?')).toBeInTheDocument()

    // 입력창 및 물어보기 버튼
    expect(
      screen.getByPlaceholderText(
        '소희에게 매장에 대해 궁금한 점을 물어보세요 (예: 주차 돼?)',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '물어보기' })).toBeInTheDocument()
  })

  it('빠른 질문 칩을 클릭하면 즉시 시뮬레이션 API를 호출하고 답변 말풍선을 노출한다', async () => {
    render(<KnowledgeSimulator workspaceId={workspaceId} />)

    const parkingChip = screen.getByText('손님이 주차 문의하면?')
    fireEvent.click(parkingChip)

    // 입력창에 질문이 채워졌는지 확인
    const input = screen.getByPlaceholderText(
      '소희에게 매장에 대해 궁금한 점을 물어보세요 (예: 주차 돼?)',
    ) as HTMLInputElement
    expect(input.value).toBe('손님이 주차 문의하면?')

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/simulate`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: '손님이 주차 문의하면?',
            type: 'faq',
          }),
        }),
      )
    })

    // 소희의 답변 배지 및 말풍선 답변 텍스트 노출
    await waitFor(() => {
      expect(screen.getByText('소희의 답변')).toBeInTheDocument()
      expect(
        screen.getByText('저희 매장은 건물 지하 주차장에 최대 2시간 무료 주차가 가능해요!'),
      ).toBeInTheDocument()
    })
  })

  it('직접 질문을 입력하고 전송하면 답변과 참고한 지식 배지를 렌더링한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          answer: '대표 메뉴는 30일 숙성등심(38,000원)이며 부드러운 육질이 일품이에요!',
          usedFacts: [
            {
              id: 'fact-menu',
              category: 'MENU',
              content: '30일 숙성등심 38,000원',
            },
          ],
          hasLearnedKnowledge: true,
        },
      }),
    })

    render(<KnowledgeSimulator workspaceId={workspaceId} />)

    const input = screen.getByPlaceholderText(
      '소희에게 매장에 대해 궁금한 점을 물어보세요 (예: 주차 돼?)',
    )
    fireEvent.change(input, { target: { value: '메뉴 추천해줘' } })

    const submitBtn = screen.getByRole('button', { name: '물어보기' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/simulate`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: '메뉴 추천해줘',
          }),
        }),
      )
    })

    await waitFor(() => {
      expect(
        screen.getByText('대표 메뉴는 30일 숙성등심(38,000원)이며 부드러운 육질이 일품이에요!'),
      ).toBeInTheDocument()
      expect(screen.getByText(/소희가 참고한 지식/)).toBeInTheDocument()
      expect(screen.getByText('30일 숙성등심 38,000원')).toBeInTheDocument()
    })
  })

  it('Enter 키를 누르면 질문이 전송된다', async () => {
    render(<KnowledgeSimulator workspaceId={workspaceId} />)

    const input = screen.getByPlaceholderText(
      '소희에게 매장에 대해 궁금한 점을 물어보세요 (예: 주차 돼?)',
    )
    fireEvent.change(input, { target: { value: '영업시간 알려줘' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/simulate`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            query: '영업시간 알려줘',
          }),
        }),
      )
    })
  })

  it('배운 지식이 없을 때(hasLearnedKnowledge === false) 안내 배너를 노출한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          answer: '아직 주차에 대해 배우지 못했어요.',
          usedFacts: [],
          hasLearnedKnowledge: false,
        },
      }),
    })

    render(<KnowledgeSimulator workspaceId={workspaceId} />)

    const parkingChip = screen.getByText('손님이 주차 문의하면?')
    fireEvent.click(parkingChip)

    await waitFor(() => {
      expect(screen.getByText('아직 주차에 대해 배우지 못했어요.')).toBeInTheDocument()
      expect(
        screen.getByText(/아직 소희에게 가르친 지식이 없어요/),
      ).toBeInTheDocument()
    })
  })

  it('API 실패 시 사장님 친화적 에러 메시지를 표시한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        message: '지식 시뮬레이션 응답을 생성하지 못했습니다.',
      }),
    })

    render(<KnowledgeSimulator workspaceId={workspaceId} />)

    const input = screen.getByPlaceholderText(
      '소희에게 매장에 대해 궁금한 점을 물어보세요 (예: 주차 돼?)',
    )
    fireEvent.change(input, { target: { value: '테스트 질문' } })
    fireEvent.click(screen.getByRole('button', { name: '물어보기' }))

    await waitFor(() => {
      expect(
        screen.getByText('지식 시뮬레이션 응답을 생성하지 못했습니다.'),
      ).toBeInTheDocument()
    })
  })
})
