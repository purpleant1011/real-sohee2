import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChannelReviewDialog } from './channel-review-dialog'
import type { LearningCandidate, LearningSource } from '../contracts'

describe('ChannelReviewDialog', () => {
  const mockSource: LearningSource = {
    workspaceId: '10000000-0000-4000-8000-000000000001',
    sourceId: 'src-1',
    revision: 1,
    platform: 'instagram',
    canonicalUrl: 'https://instagram.com/cafe_sohee',
    canonicalIdentity: 'cafe_sohee',
    verification: 'verified',
    collection: 'review_required',
    lease: {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      sourceId: 'src-1',
      revision: 1,
      providerAccountId: 'ig-1',
      method: 'oauth',
      verifiedAt: '2026-11-10T00:00:00.000Z',
      expiresAt: '2026-11-11T00:00:00.000Z',
      revokedAt: null,
      evidenceRevision: 1,
    },
    consent: {
      text: true,
      images: true,
      revision: 1,
    },
    deletedAt: null,
  }

  const mockCandidates: LearningCandidate[] = [
    {
      id: 'cand-1',
      source: {
        workspaceId: mockSource.workspaceId,
        sourceId: mockSource.sourceId,
        revision: 1,
      },
      version: 1,
      category: 'hours',
      content: '화~일 10:00 - 20:00 영업 (월요일 정기휴무)',
      evidence: {
        documentId: 'doc-1',
        excerpt: '소개글: 화~일 10:00-20:00 / 매주 월요일 휴무',
        visionReceiptId: null,
      },
      evidenceState: 'observed',
      status: 'review_required',
      conflictsWithFactId: null,
    },
    {
      id: 'cand-2',
      source: {
        workspaceId: mockSource.workspaceId,
        sourceId: mockSource.sourceId,
        revision: 1,
      },
      version: 1,
      category: 'price',
      content: '시그니처 바닐라빈 라떼 6,500원',
      evidence: {
        documentId: 'doc-2',
        excerpt: null,
        visionReceiptId: 'vis-expired-1',
      },
      evidenceState: 'inferred',
      status: 'conflict',
      conflictsWithFactId: 'fact-old-price',
    },
  ]

  it('후보 지식 목록, 카테고리 한국어 라벨, 근거 발췌를 올바르게 표시한다', () => {
    render(
      <ChannelReviewDialog
        isOpen={true}
        onClose={vi.fn()}
        source={mockSource}
        candidates={mockCandidates}
        canManage={true}
        onSaveDecisions={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '지식 검토 및 승인' })).toBeInTheDocument()
    expect(screen.getByText('화~일 10:00 - 20:00 영업 (월요일 정기휴무)')).toBeInTheDocument()
    expect(screen.getByText('시그니처 바닐라빈 라떼 6,500원')).toBeInTheDocument()
    expect(screen.getByText('영업시간')).toBeInTheDocument()
    expect(screen.getByText('가격/메뉴')).toBeInTheDocument()
    expect(screen.getByText(/소개글: 화~일 10:00-20:00/)).toBeInTheDocument()
    expect(screen.getByText('실제 관찰됨')).toBeInTheDocument()
    expect(screen.getByText('문맥 추론됨')).toBeInTheDocument()
    expect(screen.getByText(/기존 정보와 충돌/)).toBeInTheDocument()
  })

  it('원본 미디어 7일 만료 시 깨진 이미지 대신 [원본 사본 보관기간 종료] 안내를 표시하고 뷰어를 비활성화한다', () => {
    render(
      <ChannelReviewDialog
        isOpen={true}
        onClose={vi.fn()}
        source={mockSource}
        candidates={mockCandidates}
        canManage={true}
        onSaveDecisions={vi.fn()}
        isMediaExpired={true}
      />,
    )

    expect(screen.getAllByText('원본 사본 보관기간 종료')[0]).toBeInTheDocument()
    const viewerButton = screen.queryByRole('button', { name: '원본 이미지 보기' })
    expect(viewerButton).toBeNull() // 뷰어 버튼 비활성화/제거
  })

  it('개별 후보의 승인/반려를 선택하고 모바일 단일 고정 CTA 버튼으로 제출한다', () => {
    const onSaveDecisions = vi.fn()

    render(
      <ChannelReviewDialog
        isOpen={true}
        onClose={vi.fn()}
        source={mockSource}
        candidates={mockCandidates}
        canManage={true}
        onSaveDecisions={onSaveDecisions}
      />,
    )

    // 기본적으로 review_required 항목은 승인 대기 또는 승인 선택 가능
    const submitBtn = screen.getByRole('button', { name: /지식 승인 및 반영/ })
    fireEvent.click(submitBtn)

    expect(onSaveDecisions).toHaveBeenCalledTimes(1)
    expect(onSaveDecisions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'cand-1',
          decision: 'approved',
        }),
      ]),
    )
  })

  it('canManage가 false이면 승인 버튼이 비활성화된다', () => {
    render(
      <ChannelReviewDialog
        isOpen={true}
        onClose={vi.fn()}
        source={mockSource}
        candidates={mockCandidates}
        canManage={false}
        onSaveDecisions={vi.fn()}
      />,
    )

    const submitBtn = screen.getByRole('button', { name: /지식 승인 및 반영/ })
    expect(submitBtn).toBeDisabled()
    expect(screen.getByText(/소유자와 관리자만 승인 결정을 저장할 수 있습니다/)).toBeInTheDocument()
  })
})
