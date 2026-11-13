import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationArtifact } from './types'

vi.mock('./conversation-result-card', () => ({
  ConversationResultCard: ({ artifact }: { artifact: ConversationArtifact }) => (
    <article aria-label={`검토 대상 ${artifact.id}`}>{artifact.caption}</article>
  ),
}))

import { SocialProposalSet } from './social-proposal-set'

const base: ConversationArtifact = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  sourceMessageId: '30000000-0000-4000-8000-000000000001',
  type: 'instagram_post',
  status: 'ready_for_review',
  caption: '잔흔 상담 전후 기록',
  hashtags: ['#자연눈썹'],
  cta: '사진 상담을 먼저 신청해 주세요.',
  disclosure: 'AI 보조 제작 이미지입니다.',
  observations: [],
  limitations: [],
  evidence: [],
  unresolvedQuestions: [],
  idempotencyKey: '40000000-0000-4000-8000-000000000001',
  slides: [{
    id: '50000000-0000-4000-8000-000000000001',
    position: 1,
    role: 'cover',
    status: 'succeeded',
    mediaAssetId: '60000000-0000-4000-8000-000000000001',
    altText: '잔흔 상담 전후 기록 표지',
    retryable: false,
    safeErrorCode: null,
  }],
}

const threads: ConversationArtifact = {
  ...base,
  id: '10000000-0000-4000-8000-000000000002',
  type: 'threads_post',
  caption: '잔흔을 보는 세 가지 기준',
  idempotencyKey: '40000000-0000-4000-8000-000000000002',
}

const question: ConversationArtifact = {
  ...base,
  id: '10000000-0000-4000-8000-000000000003',
  caption: '잔흔이 있어도 가능할까요?',
  idempotencyKey: '40000000-0000-4000-8000-000000000003',
}

describe('SocialProposalSet', () => {
  it('compares channel-complete candidates and changes the exact review target', () => {
    render(<SocialProposalSet artifacts={[base, threads, question]} replyToMessageId={base.sourceMessageId} />)

    expect(screen.getByRole('heading', { name: '채널별 결과물을 각각 검토하세요' })).toBeInTheDocument()
    expect(screen.getByText('채널에 올라갈 결과물 제안 3개')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '채널별 결과물' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Threads.*잔흔을 보는 세 가지 기준/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('article', { name: `검토 대상 ${base.id}` })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Threads.*잔흔을 보는 세 가지 기준/ }))

    expect(screen.getByRole('tab', { name: /Threads.*잔흔을 보는 세 가지 기준/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: /Threads.*잔흔을 보는 세 가지 기준/ })).toContainElement(
      screen.getByRole('article', { name: `검토 대상 ${threads.id}` }),
    )
  })

  it('restores the same-channel candidate already linked to an immutable content version', () => {
    const savedQuestion = {
      ...question,
      contentItemId: '70000000-0000-4000-8000-000000000001',
      versionId: '80000000-0000-4000-8000-000000000001',
    }

    render(<SocialProposalSet artifacts={[base, savedQuestion]} replyToMessageId={base.sourceMessageId} />)

    expect(screen.getByRole('article', { name: `검토 대상 ${question.id}` })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Instagram.*잔흔 상담 전후 기록/ })).toBeDisabled()
    expect(screen.getByText(/다른 제안은 중복 저장되지 않아요/)).toBeInTheDocument()
  })

  it('keeps another requested channel available after one channel is linked to a version', () => {
    const savedInstagram = {
      ...base,
      contentItemId: '70000000-0000-4000-8000-000000000001',
      versionId: '80000000-0000-4000-8000-000000000001',
    }

    render(<SocialProposalSet artifacts={[savedInstagram, threads]} replyToMessageId={base.sourceMessageId} />)

    const threadsTab = screen.getByRole('tab', { name: /Threads.*잔흔을 보는 세 가지 기준/ })
    expect(threadsTab).toBeEnabled()
    expect(screen.getByText('채널별 결과물을 각각 선택해 검토·승인할 수 있어요.')).toBeInTheDocument()

    fireEvent.click(threadsTab)

    expect(screen.getByRole('article', { name: `검토 대상 ${threads.id}` })).toBeInTheDocument()
  })

  it('moves between available result tabs with horizontal arrow keys', () => {
    render(<SocialProposalSet artifacts={[base, threads, question]} replyToMessageId={base.sourceMessageId} />)

    const instagramTab = screen.getByRole('tab', { name: /Instagram.*잔흔 상담 전후 기록/ })
    instagramTab.focus()
    fireEvent.keyDown(instagramTab, { key: 'ArrowRight' })

    const threadsTab = screen.getByRole('tab', { name: /Threads.*잔흔을 보는 세 가지 기준/ })
    expect(threadsTab).toHaveAttribute('aria-selected', 'true')
    expect(threadsTab).toHaveFocus()
  })
})
