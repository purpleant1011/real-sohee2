import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))

import { ApprovalPanel } from './approval-panel'
import { approveAndDispatchAction } from './actions/approve-and-dispatch'

const preview: ApprovalPreviewSnapshot = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  versionId: '40000000-0000-4000-8000-000000000001',
  versionNumber: 3,
  fingerprint: 'a'.repeat(64),
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  channel: 'instagram',
  account: { connectionId: '50000000-0000-4000-8000-000000000001', label: '@sohee', status: 'connected' },
  caption: '최종 문구',
  hashtags: ['#최종'],
  disclosure: 'AI 보조 제작',
  text: '최종 문구\n\n#최종\n\nAI 보조 제작',
  media: [{
    id: '60000000-0000-4000-8000-000000000001', position: 1, mimeType: 'image/png',
    altText: '최종 게시물 표지', src: '/media/final',
  }],
  issues: [],
}

describe('ApprovalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(approveAndDispatchAction).mockResolvedValue({
      data: {
        approvalId: '70000000-0000-4000-8000-000000000001', versionId: preview.versionId,
        next: 'approved', scheduleId: null, attemptId: null, providerPostId: null, errorCode: null,
      },
    })
  })

  it('shows the exact preview without checkboxes, mandatory reason, or carousel traversal', () => {
    render(<ApprovalPanel role="reviewer" preview={preview} />)
    expect(screen.getByRole('heading', { name: '게시 전 최종 확인' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Instagram v3 게시 미리보기' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '검토 사유' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '즉시 게시' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인' })).toBeEnabled()
  })

  it('lets a reviewer approve the exact version after the real image is visible', async () => {
    render(<ApprovalPanel role="reviewer" preview={preview} />)
    fireEvent.load(screen.getByRole('img', { name: '최종 게시물 표지' }))
    const button = screen.getByRole('button', { name: '승인' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(approveAndDispatchAction).toHaveBeenCalledWith({
      workspaceId: preview.workspaceId,
      contentId: preview.contentId,
      versionId: preview.versionId,
      fingerprint: preview.fingerprint,
      mode: 'approve_only',
      channelConnectionId: null,
      scheduledLocal: null,
      timezone: null,
    }))
  })

  it('shows one primary approval-and-publish action without dispatch mode radios', async () => {
    vi.mocked(approveAndDispatchAction).mockResolvedValue({
      data: {
        approvalId: '70000000-0000-4000-8000-000000000001', versionId: preview.versionId,
        next: 'published', scheduleId: '80000000-0000-4000-8000-000000000001',
        attemptId: '90000000-0000-4000-8000-000000000001', providerPostId: 'post-1', errorCode: null,
      },
    })
    render(<ApprovalPanel role="manager" preview={preview} />)
    fireEvent.load(screen.getByRole('img', { name: '최종 게시물 표지' }))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    const button = screen.getByRole('button', { name: '승인하고 바로 게시' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(approveAndDispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      versionId: preview.versionId,
      fingerprint: preview.fingerprint,
      mode: 'publish_now',
      channelConnectionId: preview.account.connectionId,
    })))
    expect(await screen.findByText('게시가 완료됐어요.')).toBeInTheDocument()
  })

  it('keeps scheduling in a secondary disclosure', async () => {
    vi.mocked(approveAndDispatchAction).mockResolvedValue({
      data: {
        approvalId: '70000000-0000-4000-8000-000000000001', versionId: preview.versionId,
        next: 'scheduled', scheduleId: '80000000-0000-4000-8000-000000000001',
        attemptId: null, providerPostId: null, errorCode: null,
      },
    })
    render(<ApprovalPanel role="owner" preview={preview} />)
    fireEvent.load(screen.getByRole('img', { name: '최종 게시물 표지' }))

    expect(screen.queryByLabelText('예약 시각 · Asia/Seoul')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('예약 게시 설정'))
    const scheduledAt = screen.getByLabelText('예약 시각 · Asia/Seoul')
    fireEvent.change(scheduledAt, { target: { value: '2030-08-14T18:00' } })
    const scheduleButton = screen.getByRole('button', { name: '승인하고 예약' })
    await waitFor(() => expect(scheduleButton).toBeEnabled())
    fireEvent.click(scheduleButton)

    await waitFor(() => expect(approveAndDispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'schedule',
      scheduledLocal: '2030-08-14T18:00',
      timezone: 'Asia/Seoul',
    })))
  })

  it('names the exact public Naver version in the one-click publish action', async () => {
    render(<ApprovalPanel role="owner" preview={{
      ...preview,
      channel: 'naver_blog',
      visibility: 'public',
      account: { ...preview.account, label: 'findk3' },
    }} />)
    fireEvent.load(screen.getByRole('img', { name: '최종 게시물 표지' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '공개 승인하고 바로 게시' })).toBeEnabled())
    expect(screen.getByText(/네이버 블로그에 전송될 v3 문구와 미디어, 공개 범위/)).toBeInTheDocument()
  })

  it('keeps the action disabled and shows only the actionable recovery when the channel is unavailable', () => {
    render(<ApprovalPanel role="manager" preview={{
      ...preview,
      account: { ...preview.account, status: 'expired' },
      issues: [{ code: 'channel_expired', message: '공식 채널을 다시 연결한 뒤 게시할 수 있어요.', recoveryHref: '/app/settings/channels' }],
    }} />)
    expect(screen.getByText('공식 채널을 다시 연결한 뒤 게시할 수 있어요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '채널 다시 연결' })).toHaveAttribute('href', '/app/settings/channels')
    expect(screen.getByRole('button', { name: '승인하고 바로 게시' })).toBeDisabled()
  })
})
