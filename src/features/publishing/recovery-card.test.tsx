import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const mocks = vi.hoisted(() => ({
  runPublishAction: vi.fn(),
  retryPublishAction: vi.fn(),
  reconcilePublishAction: vi.fn(),
}))
vi.mock('./actions/run-publish', () => ({ runPublishAction: mocks.runPublishAction }))
vi.mock('./actions/retry-publish', () => ({ retryPublishAction: mocks.retryPublishAction }))
vi.mock('./actions/reconcile-publish', () => ({ reconcilePublishAction: mocks.reconcilePublishAction }))
import { RecoveryCard } from './recovery-card'

const base = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  scheduleId: '30000000-0000-4000-8000-000000000001',
  canManage: true,
  channelLabel: 'Instagram',
  versionNumber: 3,
  creditSummary: { used: 0, returned: 4 },
}
const finalInstagramAttemptId = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'

describe('RecoveryCard', () => {
  it('shows a real publish action without any mock or simulation controls', () => {
    render(<RecoveryCard {...base} scheduleStatus="scheduled" attempt={null} />)
    expect(screen.getByText('공식 채널 전송')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '지금 게시' })).toBeEnabled()
    expect(screen.queryByText(/모의/u)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers a live retry only for a retryable failure', () => {
    render(<RecoveryCard {...base} scheduleStatus="failed" attempt={{ id: '40000000-0000-4000-8000-000000000001', status: 'failed', errorCode: 'TEMPORARY_NETWORK', providerReference: null }} />)
    expect(screen.getByText(/일시적인 연결 문제/u)).toBeInTheDocument()
    expect(screen.getByText('Instagram에서 확인한 콘텐츠는 보관됐어요.')).toBeVisible()
    expect(screen.queryByText(/반환/)).toBeNull()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeEnabled()
  })

  it('shows reconnect guidance without a retry button for an expired token', () => {
    render(<RecoveryCard {...base} scheduleStatus="failed" attempt={{ id: '40000000-0000-4000-8000-000000000001', status: 'failed', errorCode: 'TOKEN_EXPIRED', providerReference: null }} />)
    expect(screen.getByText(/채널 연결이 만료/u)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('shows the live provider result immediately', async () => {
    mocks.runPublishAction.mockResolvedValueOnce({ data: {
      attemptId: '40000000-0000-4000-8000-000000000001', status: 'failed',
      providerPostId: null, errorCode: 'TOKEN_EXPIRED',
    } })
    render(<RecoveryCard {...base} scheduleStatus="scheduled" attempt={null} />)
    fireEvent.click(screen.getByRole('button', { name: '지금 게시' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('채널 연결이 만료'))
  })

  it('shows an unknown provider result and offers no blind retry', () => {
    render(<RecoveryCard {...base} scheduleStatus="unknown" attempt={{
      id: '40000000-0000-4000-8000-000000000001', status: 'unknown',
      errorCode: 'RESULT_UNKNOWN', providerReference: null,
    }} />)
    expect(screen.getByText(/자동 재시도를 멈췄/u)).toBeInTheDocument()
    expect(screen.getByText('중복 실행 금지')).toBeVisible()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '공식 채널 결과 다시 확인' })).toBeEnabled()
  })

  it('uses server recovery guidance and never offers a write after an unknown readback', async () => {
    vi.clearAllMocks()
    mocks.reconcilePublishAction.mockResolvedValueOnce({ data: {
      attemptId: '40000000-0000-4000-8000-000000000001',
      status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN',
      nextAction: 'CHECK_CHANNEL_OR_CONTACT_OPERATOR',
      message: '다시 게시하지 말고 공식 채널 기록을 조회하거나 운영 담당자에게 확인을 요청해 주세요.',
    } })
    render(<RecoveryCard {...base} scheduleStatus="unknown" attempt={{
      id: '40000000-0000-4000-8000-000000000001', status: 'unknown',
      errorCode: 'LEASE_EXPIRED', providerReference: null,
    }} />)

    fireEvent.click(screen.getByRole('button', { name: '공식 채널 결과 다시 확인' }))

    await waitFor(() => expect(mocks.reconcilePublishAction).toHaveBeenCalledWith({
      workspaceId: base.workspaceId,
      attemptId: '40000000-0000-4000-8000-000000000001',
    }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('공식 채널 기록을 조회하거나 운영 담당자'))
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(mocks.runPublishAction).not.toHaveBeenCalled()
    expect(mocks.retryPublishAction).not.toHaveBeenCalled()
  })

  it('shows the exact one-time Instagram v1 recovery only to an owner', () => {
    render(<RecoveryCard {...base} canRunExactOwnerRecovery scheduleStatus="failed" attempt={{
      id: finalInstagramAttemptId, status: 'failed', errorCode: 'PROVIDER_REJECTED', providerReference: null,
    }} />)
    expect(screen.getByRole('button', { name: '인스타그램 다시 게시' })).toBeEnabled()
  })

  it('invokes the exact recovery server action with the bound workspace and failed attempt', async () => {
    mocks.retryPublishAction.mockResolvedValueOnce({
      error: { message: 'INSTAGRAM_READINESS_TEST', requestId: 'live-publish' },
    })
    render(<RecoveryCard {...base} canRunExactOwnerRecovery scheduleStatus="failed" attempt={{
      id: finalInstagramAttemptId, status: 'failed', errorCode: 'PROVIDER_REJECTED', providerReference: null,
    }} />)

    fireEvent.click(screen.getByRole('button', { name: '인스타그램 다시 게시' }))

    await waitFor(() => expect(mocks.retryPublishAction).toHaveBeenCalledWith({
      workspaceId: base.workspaceId,
      failedAttemptId: finalInstagramAttemptId,
    }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('INSTAGRAM_READINESS_TEST'))
  })

  it('does not expose the exact Instagram recovery to a manager or another rejected attempt', () => {
    const { rerender } = render(<RecoveryCard {...base} scheduleStatus="failed" attempt={{
      id: finalInstagramAttemptId, status: 'failed', errorCode: 'PROVIDER_REJECTED', providerReference: null,
    }} />)
    expect(screen.queryByRole('button', { name: '인스타그램 다시 게시' })).not.toBeInTheDocument()

    rerender(<RecoveryCard {...base} canRunExactOwnerRecovery scheduleStatus="failed" attempt={{
      id: '40000000-0000-4000-8000-000000000001', status: 'failed', errorCode: 'PROVIDER_REJECTED', providerReference: null,
    }} />)
    expect(screen.queryByRole('button', { name: '인스타그램 다시 게시' })).not.toBeInTheDocument()
  })
})
