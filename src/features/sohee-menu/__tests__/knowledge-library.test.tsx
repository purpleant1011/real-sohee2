import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeLibrary } from '../components/knowledge-library'
import type { FactItem } from '@/features/sohee-knowledge/types'

describe('KnowledgeLibrary', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'
  let mockFetch: ReturnType<typeof vi.fn>

  const initialFacts: FactItem[] = [
    {
      id: 'fact-1',
      category: 'MENU',
      content: '대표 메뉴는 30일 저온 숙성 한우 등심이에요.',
      createdAt: '2026-10-10T00:00:00Z',
      source: 'interview',
    },
    {
      id: 'fact-2',
      category: 'PRICE',
      content: '숙성 등심 1인분(150g)에 38,000원이에요.',
      createdAt: '2026-10-10T01:00:00Z',
      source: 'file',
    },
    {
      id: 'fact-3',
      category: 'HOURS',
      content: '매일 11시 30분부터 22시까지 영업하고 화요일은 쉬어요.',
      createdAt: '2026-10-10T02:00:00Z',
      source: 'manual',
    },
    {
      id: 'fact-4',
      category: 'DIFFERENTIATOR',
      content: '참숯 직화 구이로 육즙을 꽉 잡았어요.',
      createdAt: '2026-10-10T03:00:00Z',
      source: 'interview',
    },
    {
      id: 'fact-5',
      category: 'FAQ',
      content: '주차는 건물 지하 2시간 무료 지원돼요.',
      createdAt: '2026-10-10T04:00:00Z',
      source: 'manual',
    },
    {
      id: 'fact-6',
      category: 'PROHIBITED',
      content: '할인 쿠폰 중복 적용은 안내하지 않아요.',
      createdAt: '2026-10-10T05:00:00Z',
      source: 'manual',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const method = options?.method || 'GET'

      if (url.includes(`/api/workspaces/${workspaceId}/knowledge/facts`) && method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { facts: initialFacts },
          }),
        })
      }

      if (url.includes(`/api/workspaces/${workspaceId}/knowledge/facts`) && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              id: 'fact-new',
              category: 'MENU',
              content: '신메뉴 된장찌개가 추가됐어요.',
              createdAt: '2026-10-15T00:00:00Z',
              source: 'manual',
            },
          }),
        })
      }

      if (url.includes(`/api/workspaces/${workspaceId}/knowledge/facts/fact-1`) && method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              id: 'fact-1-updated',
              category: 'MENU',
              content: '대표 메뉴는 45일 숙성 특등심이에요.',
              createdAt: '2026-10-15T01:00:00Z',
              source: 'manual',
            },
          }),
        })
      }

      if (url.includes(`/api/workspaces/${workspaceId}/knowledge/facts/fact-1`) && method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { success: true },
          }),
        })
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      })
    })

    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('마운트 시 지식 팩트 목록과 카테고리 칩, 활용처 배지를 렌더링한다', async () => {
    render(<KnowledgeLibrary workspaceId={workspaceId} />)

    expect(screen.getByText('지식 도서관')).toBeInTheDocument()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/knowledge/facts`)
    })

    // 내용 렌더링 확인
    expect(await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')).toBeInTheDocument()
    expect(screen.getByText('숙성 등심 1인분(150g)에 38,000원이에요.')).toBeInTheDocument()
    expect(screen.getByText('매일 11시 30분부터 22시까지 영업하고 화요일은 쉬어요.')).toBeInTheDocument()

    // 출처 렌더링 확인
    expect(screen.getAllByText('소희 인터뷰').length).toBeGreaterThan(0)
    expect(screen.getAllByText('첨부 자료').length).toBeGreaterThan(0)
    expect(screen.getAllByText('직접 등록').length).toBeGreaterThan(0)

    // 활용처 배지 확인: MENU는 인스타·블로그 글감, FAQ는 DM·댓글 답변용, PRICE는 둘 다 노출
    const blogBadges = screen.getAllByText('인스타·블로그 글감')
    expect(blogBadges.length).toBeGreaterThanOrEqual(3) // MENU, PRICE, DIFFERENTIATOR

    const dmBadges = screen.getAllByText('DM·댓글 답변용')
    expect(dmBadges.length).toBeGreaterThanOrEqual(3) // PRICE, HOURS, FAQ
  })

  it('등록된 지식이 없으면 빈 상태 안내 문구를 보여준다', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/knowledge/facts')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { facts: [] },
          }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: {} }),
      }
    })

    render(<KnowledgeLibrary workspaceId={workspaceId} />)

    expect(
      await screen.findByText('아직 등록된 지식이 없어요. 인터뷰에 답하시거나 새 지식을 추가해 보세요!'),
    ).toBeInTheDocument()
  })

  it('카테고리 탭 클릭 시 해당하는 팩트만 필터링한다', async () => {
    render(<KnowledgeLibrary workspaceId={workspaceId} />)

    await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')

    // '영업 & 위치' 탭 클릭
    const hoursTab = screen.getByRole('tab', { name: /영업 & 위치/ })
    fireEvent.click(hoursTab)

    expect(screen.getByText('매일 11시 30분부터 22시까지 영업하고 화요일은 쉬어요.')).toBeInTheDocument()
    expect(screen.queryByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')).not.toBeInTheDocument()

    // '메뉴 & 가격' 탭 클릭 -> MENU, PRICE 둘 다 포함
    const menuPriceTab = screen.getByRole('tab', { name: /메뉴 & 가격/ })
    fireEvent.click(menuPriceTab)

    expect(screen.getByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')).toBeInTheDocument()
    expect(screen.getByText('숙성 등심 1인분(150g)에 38,000원이에요.')).toBeInTheDocument()
    expect(screen.queryByText('매일 11시 30분부터 22시까지 영업하고 화요일은 쉬어요.')).not.toBeInTheDocument()

    // '전체' 탭 클릭 -> 다시 모두 표시
    const allTab = screen.getByRole('tab', { name: /전체/ })
    fireEvent.click(allTab)

    expect(screen.getByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')).toBeInTheDocument()
    expect(screen.getByText('매일 11시 30분부터 22시까지 영업하고 화요일은 쉬어요.')).toBeInTheDocument()
  })

  it('인라인 [수정] 클릭 후 내용을 변경하고 저장하면 PATCH를 호출하고 onKnowledgeChanged 콜백을 실행한다', async () => {
    const onKnowledgeChanged = vi.fn()
    render(<KnowledgeLibrary workspaceId={workspaceId} onKnowledgeChanged={onKnowledgeChanged} />)

    await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')

    // 첫 번째 카드의 수정 버튼 클릭
    const editButtons = screen.getAllByRole('button', { name: '수정' })
    fireEvent.click(editButtons[0])

    // 인라인 Textarea 확인 및 내용 변경
    const textarea = screen.getByLabelText('지식 내용 수정')
    expect(textarea).toHaveValue('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')
    fireEvent.change(textarea, { target: { value: '대표 메뉴는 45일 숙성 특등심이에요.' } })

    // [저장] 클릭
    const saveButton = screen.getByRole('button', { name: '저장' })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/facts/fact-1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ content: '대표 메뉴는 45일 숙성 특등심이에요.' }),
        }),
      )
      expect(onKnowledgeChanged).toHaveBeenCalled()
    })
  })

  it('인라인 [수정] 모드에서 [취소] 클릭 시 원래 내용으로 돌아간다', async () => {
    render(<KnowledgeLibrary workspaceId={workspaceId} />)

    await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')

    const editButtons = screen.getAllByRole('button', { name: '수정' })
    fireEvent.click(editButtons[0])

    const cancelButton = screen.getByRole('button', { name: '취소' })
    fireEvent.click(cancelButton)

    expect(screen.queryByLabelText('지식 내용 수정')).not.toBeInTheDocument()
    expect(screen.getByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')).toBeInTheDocument()
  })

  it('[삭제] 버튼 클릭 후 삭제 확인 시 DELETE를 호출하고 onKnowledgeChanged 콜백을 실행한다', async () => {
    const onKnowledgeChanged = vi.fn()
    render(<KnowledgeLibrary workspaceId={workspaceId} onKnowledgeChanged={onKnowledgeChanged} />)

    await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')

    const deleteButtons = screen.getAllByRole('button', { name: '삭제' })
    fireEvent.click(deleteButtons[0])

    // 삭제 확인 다이얼로그의 [삭제하기] 버튼 클릭
    const confirmDeleteButton = await screen.findByRole('button', { name: '삭제하기' })
    fireEvent.click(confirmDeleteButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/facts/fact-1`,
        expect.objectContaining({
          method: 'DELETE',
        }),
      )
      expect(onKnowledgeChanged).toHaveBeenCalled()
    })
  })

  it('[+ 새 지식 추가] 모달을 열고 카테고리와 내용을 입력하여 등록하면 POST를 호출하고 onKnowledgeChanged 콜백을 실행한다', async () => {
    const onKnowledgeChanged = vi.fn()
    render(<KnowledgeLibrary workspaceId={workspaceId} onKnowledgeChanged={onKnowledgeChanged} />)

    await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')

    // [+ 새 지식 추가] 버튼 클릭
    const openAddButton = screen.getByRole('button', { name: /새 지식 추가/ })
    fireEvent.click(openAddButton)

    // 모달 타이틀 확인
    expect(await screen.findByText('새 지식 추가하기')).toBeInTheDocument()

    // 카테고리 선택 및 내용 입력
    const categorySelect = screen.getByLabelText('카테고리 선택')
    fireEvent.change(categorySelect, { target: { value: 'MENU' } })

    const contentTextarea = screen.getByLabelText('지식 내용 입력')
    fireEvent.change(contentTextarea, { target: { value: '신메뉴 된장찌개가 추가됐어요.' } })

    // [소희에게 가르치기] 저장 버튼 클릭
    const submitButton = screen.getByRole('button', { name: '소희에게 가르치기' })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/facts`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            category: 'MENU',
            content: '신메뉴 된장찌개가 추가됐어요.',
          }),
        }),
      )
      expect(onKnowledgeChanged).toHaveBeenCalled()
    })
  })

  it('[이 지식으로 글쓰기] 버튼 클릭 시 FactToPostModal이 열린다', async () => {
    render(<KnowledgeLibrary workspaceId={workspaceId} />)

    await screen.findByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.')

    const postButtons = screen.getAllByRole('button', { name: /이 지식으로 글쓰기/ })
    fireEvent.click(postButtons[0])

    expect(await screen.findByText('소희가 쓴 마케팅 글 초안')).toBeInTheDocument()
    expect(screen.getAllByText('대표 메뉴는 30일 저온 숙성 한우 등심이에요.').length).toBeGreaterThanOrEqual(2)
  })
})
