import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MaterialsBox, type MaterialItem } from '../components/materials-box'
import { uploadKnowledgeAction } from '@/features/knowledge/actions/upload-knowledge'
import { registerUrlSourceAction } from '@/features/knowledge/actions/register-url-source'
import { reviewKnowledgeAction } from '@/features/knowledge/actions/review-knowledge'

vi.mock('@/features/knowledge/actions/upload-knowledge', () => ({
  uploadKnowledgeAction: vi.fn(),
}))

vi.mock('@/features/knowledge/actions/register-url-source', () => ({
  registerUrlSourceAction: vi.fn(),
}))

vi.mock('@/features/knowledge/actions/review-knowledge', () => ({
  reviewKnowledgeAction: vi.fn(),
}))

describe('MaterialsBox', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'
  let mockFetch: ReturnType<typeof vi.fn>

  const initialItems: MaterialItem[] = [
    {
      id: 'mat-1',
      source: 'item',
      name: '2024_가게_메뉴판.pdf',
      kind: 'file',
      status: 'learned',
      createdAt: '2026-10-09T00:00:00Z',
    },
    {
      id: 'mat-2',
      source: 'item',
      name: '고객_응대_가이드.docx',
      kind: 'file',
      status: 'needs_review',
      createdAt: '2026-10-09T01:00:00Z',
    },
    {
      id: 'mat-3',
      source: 'source',
      name: 'https://instagram.com/our_store',
      kind: 'url',
      status: 'received',
      createdAt: '2026-10-09T02:00:00Z',
    },
    {
      id: 'mat-4',
      source: 'source',
      name: 'https://blog.naver.com/our_store',
      kind: 'url',
      status: 'attention',
      createdAt: '2026-10-09T03:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/suggestions')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              materialId: 'mat-1',
              materialName: '2024_가게_메뉴판.pdf',
              suggestions: [
                { id: 'sug-1', category: 'MENU', content: '시그니처 라떼 5,000원' },
              ],
            },
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            items: initialItems,
            learnedCount: 3,
          },
        }),
      }
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('마운트 시 자료 목록과 배운 개수를 불러와 표시한다', async () => {
    render(<MaterialsBox workspaceId={workspaceId} onMaterialUpdated={vi.fn()} />)

    expect(screen.getByText('자료함')).toBeInTheDocument()
    expect(screen.getByText(/PDF·문서·이미지·링크/)).toBeInTheDocument()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/knowledge/materials`)
      expect(screen.getByText('3개 배웠어요')).toBeInTheDocument()
      expect(screen.getByText('2024_가게_메뉴판.pdf')).toBeInTheDocument()
      expect(screen.getByText('반영됐어요')).toBeInTheDocument()
      expect(screen.getByText('고객_응대_가이드.docx')).toBeInTheDocument()
      expect(screen.getByText('확인해 주세요')).toBeInTheDocument()
      expect(screen.getByText('https://instagram.com/our_store')).toBeInTheDocument()
      expect(screen.getByText('받았어요')).toBeInTheDocument()
      expect(screen.getByText('https://blog.naver.com/our_store')).toBeInTheDocument()
      expect(screen.getByText('확인이 필요해요')).toBeInTheDocument()
    })
  })

  it('파일을 업로드하면 uploadKnowledgeAction을 호출하고 목록을 재조회하며 콜백을 트리거한다', async () => {
    const onMaterialUpdated = vi.fn()
    vi.mocked(uploadKnowledgeAction).mockResolvedValueOnce({
      data: { knowledgeId: 'new-mat', status: 'checking' },
    } as any)

    render(<MaterialsBox workspaceId={workspaceId} onMaterialUpdated={onMaterialUpdated} />)

    await waitFor(() => {
      expect(screen.getByText('2024_가게_메뉴판.pdf')).toBeInTheDocument()
    })

    const file = new File(['sample content'], '신규_메뉴.pdf', { type: 'application/pdf' })
    const fileInput = screen.getByTestId('materials-file-input')

    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadKnowledgeAction).toHaveBeenCalledTimes(1)
    })

    const formDataPassed = vi.mocked(uploadKnowledgeAction).mock.calls[0][0] as FormData
    expect(formDataPassed.get('workspaceId')).toBe(workspaceId)
    expect(formDataPassed.get('file')).toBe(file)

    await waitFor(() => {
      expect(onMaterialUpdated).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledTimes(2) // mount 1 + after upload 1
    })
  })

  it('URL을 입력하고 등록하면 registerUrlSourceAction을 호출하고 목록을 재조회하며 콜백을 트리거한다', async () => {
    const onMaterialUpdated = vi.fn()
    vi.mocked(registerUrlSourceAction).mockResolvedValueOnce({
      data: { id: 'url-1' } as any,
    })

    render(<MaterialsBox workspaceId={workspaceId} onMaterialUpdated={onMaterialUpdated} />)

    await waitFor(() => {
      expect(screen.getByText('2024_가게_메뉴판.pdf')).toBeInTheDocument()
    })

    // URL 추가 버튼 클릭으로 폼 열기
    fireEvent.click(screen.getByRole('button', { name: '주소 추가' }))

    const urlInput = screen.getByPlaceholderText('https://instagram.com/가게계정')
    fireEvent.change(urlInput, { target: { value: 'https://instagram.com/my_store' } })

    const submitBtn = screen.getByRole('button', { name: '주소 등록하기' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(registerUrlSourceAction).toHaveBeenCalledTimes(1)
      expect(registerUrlSourceAction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          url: 'https://instagram.com/my_store',
          channel: 'instagram',
          ownership: 'owned',
        }),
      )
      expect(onMaterialUpdated).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('needs_review 이고 source===item인 항목에서 [이해 확인] 버튼을 누르면 reviewKnowledgeAction을 호출한다', async () => {
    const onMaterialUpdated = vi.fn()
    vi.mocked(reviewKnowledgeAction).mockResolvedValueOnce({
      data: { knowledgeId: 'mat-2', status: 'approved' },
    })

    render(<MaterialsBox workspaceId={workspaceId} onMaterialUpdated={onMaterialUpdated} />)

    await waitFor(() => {
      expect(screen.getByText('고객_응대_가이드.docx')).toBeInTheDocument()
    })

    const reviewBtn = screen.getByRole('button', { name: '이해 확인' })
    fireEvent.click(reviewBtn)

    await waitFor(() => {
      expect(reviewKnowledgeAction).toHaveBeenCalledWith({
        workspaceId,
        knowledgeId: 'mat-2',
        decision: 'approved',
      })
      expect(onMaterialUpdated).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  it('자료 아이템의 [지식 확인] 버튼 클릭 시 추천 지식 모달이 열린다', async () => {
    render(<MaterialsBox workspaceId={workspaceId} onMaterialUpdated={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('2024_가게_메뉴판.pdf')).toBeInTheDocument()
    })

    const checkButtons = screen.getAllByRole('button', { name: '지식 확인' })
    expect(checkButtons.length).toBeGreaterThan(0)
    fireEvent.click(checkButtons[0])

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/knowledge/materials/mat-1/suggestions`,
      )
      expect(screen.getByText('소희가 발견한 매장 지식')).toBeInTheDocument()
      expect(screen.getByText('시그니처 라떼 5,000원')).toBeInTheDocument()
    })
  })

  it('주소 폼에서 [공식 채널 학습 패널 열기]를 클릭하면 ChannelLearningPanel이 표시된다', async () => {
    render(<MaterialsBox workspaceId={workspaceId} onMaterialUpdated={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('2024_가게_메뉴판.pdf')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '주소 추가' }))

    expect(
      screen.getByText(/단순 주소 등록은 확인 완료 상태가 아닙니다/),
    ).toBeInTheDocument()

    const openPanelBtn = screen.getByRole('button', { name: '공식 채널 학습 패널 열기' })
    fireEvent.click(openPanelBtn)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '공식 채널 지식 학습' })).toBeInTheDocument()
    })
  })
})
