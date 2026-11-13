import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeRadarCard } from '../components/knowledge-radar-card'
import type { KnowledgeIntelligenceResult } from '@/features/sohee-knowledge/types'

describe('KnowledgeRadarCard', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'

  const mockIntelligenceData: KnowledgeIntelligenceResult = {
    inquiry: {
      id: 'inq-test-1',
      category: 'FACILITIES',
      question: '고기 직접 구워주시나요?',
      reason: '손님들이 방문 전 가장 많이 묻는 필수 정보예요.',
      placeholder: '예: 전 메뉴 직원이 정성껏 구워드립니다.',
      suggestedChips: ['직접 구워드림', '손님이 직접 구움', '초벌 후 제공'],
    },
    seasonTrigger: {
      id: 'season-test-1',
      seasonName: '가을 단풍 & 모임 시즌',
      title: '가을 단체 회식 집중 공략',
      description: '단풍놀이 후 찾아오는 모임 손님을 위한 메뉴 안내를 추천해요.',
      actionPrompt: '10인 이상 단체 예약 시 특별 혜택을 강조해보세요.',
      targetCategory: 'MENU',
    },
    competitiveInsight: {
      id: 'comp-test-1',
      strengthHighlight: '대형 주차장 완비 (50대 무료)',
      recommendation: '인근 경쟁 매장 대비 주차가 편리한 점을 마케팅 카피에 꼭 넣어보세요.',
      targetKeyword: '청라 무료 주차 맛집',
    },
    lastAnalyzedAt: '2026-10-15T10:00:00.000Z',
  }

  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/knowledge/intelligence')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: mockIntelligenceData,
          }),
        }
      }
      if (url.includes('/knowledge/facts') && init?.method === 'POST') {
        const body = JSON.parse((init?.body as string) || '{}')
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              id: 'new-fact-1',
              category: body.category || 'MENU',
              content: body.content,
              createdAt: '2026-10-15T10:30:00.000Z',
              source: 'manual',
            },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      }
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('마운트 시 인텔리전스 데이터(역질문, 시즌, 상권)를 정상 렌더링한다', async () => {
    render(<KnowledgeRadarCard workspaceId={workspaceId} />)

    // 로딩 인디케이터 확인
    expect(screen.getByText(/소희의 마케팅 레이더/i)).toBeInTheDocument()

    // 데이터 로드 완료 대기
    await waitFor(() => {
      // 1) 💡 소희의 역질문 (Inquiry) 검증
      expect(screen.getByText(/소희가 궁금해요:\s*고기 직접 구워주시나요\?/)).toBeInTheDocument()
      expect(screen.getByText(/손님들이 방문 전 가장 많이 묻는 필수 정보예요\./)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '직접 구워드림' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '손님이 직접 구움' })).toBeInTheDocument()

      // 2) 🍁 시즌 & 이벤트 제안 (Seasonality) 검증
      expect(screen.getByText('가을 단풍 & 모임 시즌')).toBeInTheDocument()
      expect(screen.getByText('가을 단체 회식 집중 공략')).toBeInTheDocument()
      expect(screen.getByText(/10인 이상 단체 예약 시 특별 혜택을 강조해보세요\./)).toBeInTheDocument()

      // 3) ⚔️ 상권 경쟁력 팁 (Competitive) 검증
      expect(screen.getByText('대형 주차장 완비 (50대 무료)')).toBeInTheDocument()
      expect(screen.getByText(/인근 경쟁 매장 대비 주차가 편리한 점/)).toBeInTheDocument()
      expect(screen.getByText('청라 무료 주차 맛집')).toBeInTheDocument()
    })

    // API 호출 검증
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/knowledge/intelligence`,
    )
  })

  it('추천 답변 칩 클릭 시 답변 인풋에 자동으로 입력된다', async () => {
    render(<KnowledgeRadarCard workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '직접 구워드림' })).toBeInTheDocument()
    })

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')

    // 추천 칩 클릭
    fireEvent.click(screen.getByRole('button', { name: '직접 구워드림' }))

    // 인풋에 반영되었는지 확인
    expect(input.value).toBe('직접 구워드림')

    // 다른 칩 클릭 시 변경 확인
    fireEvent.click(screen.getByRole('button', { name: '초벌 후 제공' }))
    expect(input.value).toBe('초벌 후 제공')
  })

  it('역질문에 답변을 입력하고 [알려주기] 클릭 시 facts POST 호출 및 onFactCreated 콜백이 실행된다', async () => {
    const onFactCreated = vi.fn()
    render(<KnowledgeRadarCard workspaceId={workspaceId} onFactCreated={onFactCreated} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    const input = screen.getByRole('textbox') as HTMLInputElement
    const submitBtn = screen.getByRole('button', { name: /알려주기/i })

    // 답변 입력
    fireEvent.change(input, {
      target: { value: '저희 매장은 전 메뉴 100% 직원 그릴링 서비스로 편안하게 드실 수 있어요.' },
    })

    // 알려주기 클릭
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/facts`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            category: 'FACILITIES',
            content: '저희 매장은 전 메뉴 100% 직원 그릴링 서비스로 편안하게 드실 수 있어요.',
          }),
        }),
      )
    })

    // 콜백 호출 확인
    await waitFor(() => {
      expect(onFactCreated).toHaveBeenCalledTimes(1)
    })

    // 완료 메시지 표시 및 인풋 초기화 확인
    await waitFor(() => {
      expect(screen.getByText(/소희에게 새로운 지식을 알려주었어요/i)).toBeInTheDocument()
      expect(input.value).toBe('')
    })
  })

  it('인텔리전스 데이터가 없을 때 안전하게 폴백 메시지를 표시한다', async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          inquiry: null,
          seasonTrigger: null,
          competitiveInsight: null,
          lastAnalyzedAt: new Date().toISOString(),
        },
      }),
    }))

    render(<KnowledgeRadarCard workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText(/현재 새로운 역질문이 없어요/i)).toBeInTheDocument()
    })
  })
})
