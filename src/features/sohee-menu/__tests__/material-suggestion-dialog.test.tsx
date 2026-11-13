import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MaterialSuggestionDialog } from '../components/material-suggestion-dialog'
import type { ExtractedSuggestion } from '@/features/sohee-materials/types'

describe('MaterialSuggestionDialog', () => {
  const wsId = 'ws-test-123'
  const matId = 'mat-456'
  const matName = '신메뉴판.pdf'
  const suggestions: ExtractedSuggestion[] = [
    { id: 'sug-1', category: 'MENU', content: '흑돼지 김치찌개 11,000원' },
    { id: 'sug-2', category: 'HOURS', content: '매일 11:00 ~ 22:00' },
  ]

  it('추천 지식 목록과 헤더, 선택 개수를 정상 렌더링한다', () => {
    render(
      <MaterialSuggestionDialog
        isOpen={true}
        onClose={vi.fn()}
        workspaceId={wsId}
        materialId={matId}
        materialName={matName}
        suggestions={suggestions}
        onPromoted={vi.fn()}
      />,
    )

    expect(screen.getByText('소희가 발견한 매장 지식')).toBeInTheDocument()
    expect(screen.getByText('신메뉴판.pdf')).toBeInTheDocument()
    expect(screen.getByText('흑돼지 김치찌개 11,000원')).toBeInTheDocument()
    expect(screen.getByText('매일 11:00 ~ 22:00')).toBeInTheDocument()
    expect(screen.getByText('발견된 지식 2개 중 2개 선택됨')).toBeInTheDocument()
  })

  it('체크박스/카드 클릭 시 선택이 토글되고 버튼 문구가 동적으로 변경된다', () => {
    render(
      <MaterialSuggestionDialog
        isOpen={true}
        onClose={vi.fn()}
        workspaceId={wsId}
        materialId={matId}
        materialName={matName}
        suggestions={suggestions}
        onPromoted={vi.fn()}
      />,
    )

    // sug-1 클릭하여 해제
    fireEvent.click(screen.getByText('흑돼지 김치찌개 11,000원'))
    expect(screen.getByText('발견된 지식 2개 중 1개 선택됨')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1개 지식 도서관에 반영하기' })).toBeInTheDocument()

    // sug-2 클릭하여 해제 (0개 선택)
    fireEvent.click(screen.getByText('매일 11:00 ~ 22:00'))
    expect(screen.getByText('발견된 지식 2개 중 0개 선택됨')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '0개 지식 도서관에 반영하기' })).toBeDisabled()
  })

  it('[반영하기] 버튼 클릭 시 promote API를 호출하고 성공 시 onPromoted와 onClose를 호출한다', async () => {
    const onPromoted = vi.fn()
    const onClose = vi.fn()

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { promotedCount: 2 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <MaterialSuggestionDialog
        isOpen={true}
        onClose={onClose}
        workspaceId={wsId}
        materialId={matId}
        materialName={matName}
        suggestions={suggestions}
        onPromoted={onPromoted}
      />,
    )

    const submitBtn = screen.getByRole('button', { name: '2개 지식 도서관에 반영하기' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${wsId}/knowledge/materials/${matId}/promote`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            materialName: matName,
            suggestions: [
              { category: 'MENU', content: '흑돼지 김치찌개 11,000원' },
              { category: 'HOURS', content: '매일 11:00 ~ 22:00' },
            ],
          }),
        }),
      )
      expect(onPromoted).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    vi.unstubAllGlobals()
  })
})
