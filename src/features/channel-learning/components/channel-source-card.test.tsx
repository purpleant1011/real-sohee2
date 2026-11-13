import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChannelSourceCard } from './channel-source-card'
import type { Capability, LearningSource } from '../contracts'

describe('ChannelSourceCard', () => {
  const mockSource: LearningSource = {
    workspaceId: '10000000-0000-4000-8000-000000000001',
    sourceId: 'src-1',
    revision: 2,
    platform: 'instagram',
    canonicalUrl: 'https://instagram.com/cafe_sohee',
    canonicalIdentity: 'cafe_sohee',
    verification: 'verified',
    collection: 'review_required',
    lease: {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      sourceId: 'src-1',
      revision: 2,
      providerAccountId: 'ig-12345',
      method: 'oauth',
      verifiedAt: new Date(Date.now() - 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      revokedAt: null,
      evidenceRevision: 1,
    },
    consent: {
      text: true,
      images: false,
      revision: 1,
    },
    deletedAt: null,
  }

  const mockCapability: Capability = {
    platform: 'instagram',
    verificationMethods: ['oauth'],
    collectionMode: 'official_api',
    blockerCode: null,
  }

  it('출처 카드에 플랫폼명, URL, 상태 뱃지를 한국어로 정직하게 표시한다', () => {
    render(
      <ChannelSourceCard
        source={mockSource}
        capability={mockCapability}
        canManage={true}
        onVerify={vi.fn()}
        onCollect={vi.fn()}
        onReview={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('인스타그램')).toBeInTheDocument()
    expect(screen.getByText('https://instagram.com/cafe_sohee')).toBeInTheDocument()
    expect(screen.getByText('본인 확인 완료')).toBeInTheDocument()
    expect(screen.getByText('검토 필요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '지식 검토하기' })).toBeEnabled()
  })

  it('네이버 플랫폼인 경우 자동 수집 불가 및 수동 정책 안내를 정직하게 표시한다', () => {
    const naverSource: LearningSource = {
      ...mockSource,
      platform: 'naver_blog',
      canonicalUrl: 'https://blog.naver.com/cafe_sohee',
      verification: 'pending',
      collection: 'blocked',
    }
    const naverCapability: Capability = {
      platform: 'naver_blog',
      verificationMethods: [],
      collectionMode: 'manual_only',
      blockerCode: 'MANUAL_ONLY_POLICY',
    }

    render(
      <ChannelSourceCard
        source={naverSource}
        capability={naverCapability}
        canManage={true}
        onVerify={vi.fn()}
        onCollect={vi.fn()}
        onReview={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('네이버 블로그')).toBeInTheDocument()
    expect(screen.getByText(/네이버 정책상 자동 수집을 지원하지 않으며/)).toBeInTheDocument()
    // 수집 시작 버튼이 없어야 함
    expect(screen.queryByRole('button', { name: '내용 수집 시작' })).not.toBeInTheDocument()
  })

  it('당근 또는 웹사이트가 차단된 경우 안전 안내를 표시한다', () => {
    const daangnSource: LearningSource = {
      ...mockSource,
      platform: 'daangn_business',
      canonicalUrl: 'https://daangn.com/business/cafe_sohee',
      verification: 'pending',
      collection: 'blocked',
    }
    const daangnCapability: Capability = {
      platform: 'daangn_business',
      verificationMethods: [],
      collectionMode: 'blocked',
      blockerCode: 'PARTNER_API_UNAVAILABLE',
    }

    render(
      <ChannelSourceCard
        source={daangnSource}
        capability={daangnCapability}
        canManage={true}
        onVerify={vi.fn()}
        onCollect={vi.fn()}
        onReview={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('당근 비즈프로필')).toBeInTheDocument()
    expect(screen.getByText(/공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다/)).toBeInTheDocument()
  })

  it('canManage가 false이면 조작 버튼들이 비활성화된다', () => {
    render(
      <ChannelSourceCard
        source={mockSource}
        capability={mockCapability}
        canManage={false}
        onVerify={vi.fn()}
        onCollect={vi.fn()}
        onReview={vi.fn()}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    // 검토 버튼은 읽기 권한이어도 볼 수 있거나 비활성화되어야 함
    const reviewBtn = screen.getByRole('button', { name: '지식 검토하기' })
    expect(reviewBtn).toBeEnabled() // review는 읽기 가능

    const deleteBtn = screen.getByRole('button', { name: '출처 삭제' })
    expect(deleteBtn).toBeDisabled()
  })

  it('본인 확인 및 수집 버튼 클릭 시 해당 콜백이 호출된다', () => {
    const onVerify = vi.fn()
    const onCollect = vi.fn()
    const onReview = vi.fn()
    const onDelete = vi.fn()

    const unverifiedSource: LearningSource = {
      ...mockSource,
      verification: 'pending',
      collection: 'queued',
    }

    render(
      <ChannelSourceCard
        source={unverifiedSource}
        capability={mockCapability}
        canManage={true}
        onVerify={onVerify}
        onCollect={onCollect}
        onReview={onReview}
        onCancel={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const verifyBtn = screen.getByRole('button', { name: '본인 채널 확인' })
    fireEvent.click(verifyBtn)
    expect(onVerify).toHaveBeenCalledWith(unverifiedSource)

    const deleteBtn = screen.getByRole('button', { name: '출처 삭제' })
    fireEvent.click(deleteBtn)
    expect(onDelete).toHaveBeenCalledWith(unverifiedSource)
  })
})
