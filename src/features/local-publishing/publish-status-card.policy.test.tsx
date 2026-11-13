import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./actions/reconfirm-local-publish', () => ({
  reconfirmLocalPublishAction: vi.fn(async () => ({ data: { reconfirmed: true } })),
}))
vi.mock('./actions/retry-local-publish-before-submit', () => ({
  retryLocalPublishBeforeSubmitAction: vi.fn(async () => ({ data: { retried: true } })),
}))

import { PublishStatusCard, NAVER_POLICY_STOPPED_LABEL, type LocalPublishStatusEntry } from './publish-status-card'

const basePendingNaverJob: LocalPublishStatusEntry = {
  id: '10000000-0000-4000-8000-000000000001',
  status: 'device_waiting',
  channel: 'naver_blog',
  targetLabel: 'findk3 테스트 블로그',
  contentVersionId: '20000000-0000-4000-8000-000000000001',
  scheduledAt: '2026-08-19T05:00:00.000Z',
  autoExecuteUntil: '2026-08-19T05:30:00.000Z',
  failureCode: null,
}

describe('PublishStatusCard Naver Blog Policy Audit', () => {
  it('displays policy stopped notice for pending naver blog jobs', () => {
    const { unmount } = render(
      <PublishStatusCard
        entry={basePendingNaverJob}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />
    )
    expect(screen.getByText(NAVER_POLICY_STOPPED_LABEL)).toBeInTheDocument()
    unmount()
  })

  it('displays policy stopped notice for running and unknown_after_submit naver blog jobs', () => {
    for (const status of ['running', 'unknown_after_submit', 'reconfirmation_required'] as const) {
      const { unmount } = render(
        <PublishStatusCard
          entry={{ ...basePendingNaverJob, status }}
          workspaceId="30000000-0000-4000-8000-000000000001"
          canManage
        />
      )
      expect(screen.getByText(NAVER_POLICY_STOPPED_LABEL)).toBeInTheDocument()
      unmount()
    }
  })

  it('does not display policy stopped notice for daangn or succeeded jobs', () => {
    const daangnEntry: LocalPublishStatusEntry = {
      ...basePendingNaverJob,
      channel: 'daangn_business',
      status: 'device_waiting',
    }
    const { unmount: unmountDaangn } = render(
      <PublishStatusCard
        entry={daangnEntry}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />
    )
    expect(screen.queryByText(NAVER_POLICY_STOPPED_LABEL)).not.toBeInTheDocument()
    unmountDaangn()

    const succeededNaver: LocalPublishStatusEntry = {
      ...basePendingNaverJob,
      status: 'succeeded',
      resultUrl: 'https://blog.naver.com/testowner/123456789012',
    }
    const { unmount: unmountSucceeded } = render(
      <PublishStatusCard
        entry={succeededNaver}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />
    )
    expect(screen.queryByText(NAVER_POLICY_STOPPED_LABEL)).not.toBeInTheDocument()
    unmountSucceeded()
  })
})
