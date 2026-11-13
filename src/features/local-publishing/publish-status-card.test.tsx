import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./actions/reconfirm-local-publish', () => ({
  reconfirmLocalPublishAction: vi.fn(async () => ({ data: { reconfirmed: true } })),
}))
vi.mock('./actions/retry-local-publish-before-submit', () => ({
  retryLocalPublishBeforeSubmitAction: vi.fn(async () => ({ data: { retried: true } })),
}))

import { PublishStatusCard, type LocalPublishStatusEntry } from './publish-status-card'

const expired: LocalPublishStatusEntry = {
  id: '10000000-0000-4000-8000-000000000001',
  status: 'reconfirmation_required',
  channel: 'daangn_business',
  targetLabel: 'findk3 테스트 블로그',
  contentVersionId: '20000000-0000-4000-8000-000000000001',
  scheduledAt: '2026-08-19T05:00:00.000Z',
  autoExecuteUntil: '2026-08-19T05:30:00.000Z',
  failureCode: 'DEADLINE_EXPIRED',
}

describe('PublishStatusCard', () => {
  it('requires reconfirmation without exposing internal version or automation identifiers', () => {
    render(<PublishStatusCard entry={expired} workspaceId="30000000-0000-4000-8000-000000000001" canManage />)
    expect(screen.getByText('예약 시간이 30분 넘게 지났어요')).toBeInTheDocument()
    expect(screen.getByText('findk3 테스트 블로그')).toBeInTheDocument()
    expect(screen.queryByText(expired.contentVersionId)).not.toBeInTheDocument()
    expect(screen.queryByText('콘텐츠 버전')).not.toBeInTheDocument()
    expect(screen.queryByText('자동 실행 마감')).not.toBeInTheDocument()
    expect(screen.getByText('게시 예정')).toBeInTheDocument()
    expect(screen.getByText('비공개')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 내용 다시 확인' })).toBeInTheDocument()
  })

  it('never offers another submit when the browser already submitted but the result is unknown', () => {
    render(<PublishStatusCard entry={{ ...expired, status: 'unknown_after_submit', failureCode: 'UNKNOWN_RESULT' }} workspaceId="30000000-0000-4000-8000-000000000001" canManage />)
    expect(screen.getByText('게시 결과 확인 중')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /다시 게시/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '게시 내용 다시 확인' })).not.toBeInTheDocument()
  })

  it('does not allow reviewers to reconfirm execution', () => {
    render(<PublishStatusCard entry={expired} workspaceId="30000000-0000-4000-8000-000000000001" canManage={false} />)
    expect(screen.queryByRole('button', { name: '게시 내용 다시 확인' })).not.toBeInTheDocument()
  })

  it('shows four exact visibility labels and friendly category/login guidance', () => {
    const workspaceId = '30000000-0000-4000-8000-000000000001'
    for (const [visibility, label] of [['public', '전체공개'], ['neighbor', '이웃공개'], ['mutual_neighbor', '서로이웃공개'], ['private', '비공개']] as const) {
      const { unmount } = render(<PublishStatusCard entry={{ ...expired, visibility }} workspaceId={workspaceId} canManage />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
    const missing = render(<PublishStatusCard entry={{ ...expired, status: 'failed_before_submit', failureCode: 'CATEGORY_NOT_FOUND' }} workspaceId={workspaceId} canManage />)
    expect(screen.getByText('선택한 카테고리를 네이버에서 찾지 못했어요. 카테고리 목록을 새로 가져와 주세요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '문제를 확인하고 다시 실행' })).not.toBeInTheDocument()
    missing.unmount()
    const reauth = render(<PublishStatusCard entry={{ ...expired, status: 'failed_before_submit', failureCode: 'REAUTH_REQUIRED' }} workspaceId={workspaceId} canManage />)
    expect(screen.getByText('네이버 로그인이 필요해요. 크롬에서 네이버에 로그인한 뒤 다시 시도해 주세요.')).toBeInTheDocument()
    reauth.unmount()
    render(<PublishStatusCard entry={{ ...expired, status: 'failed_before_submit', failureCode: 'DRAFT_RECOVERY_PENDING' }} workspaceId={workspaceId} canManage />)
    expect(screen.getByText('네이버 글쓰기 화면에 작성 중인 글이 있어요. 그 글을 저장하거나 지운 뒤 다시 시도해 주세요.')).toBeInTheDocument()
  })

  it('offers only a guarded retry for a Naver failure before submit', () => {
    render(<PublishStatusCard entry={{ ...expired, channel: 'naver_blog', status: 'failed_before_submit', failureCode: 'UI_DRIFT' }} workspaceId="30000000-0000-4000-8000-000000000001" canManage />)
    expect(screen.getByRole('button', { name: '문제를 확인하고 다시 실행' })).toBeInTheDocument()
  })

  it('renders result url link on success only when URL is a valid Naver blog post', () => {
    render(
      <PublishStatusCard
        entry={{
          ...expired,
          status: 'succeeded',
          resultUrl: 'https://m.blog.naver.com/testowner/123456789012',
        }}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />,
    )
    const link = screen.getByRole('link', { name: '글 보기' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://blog.naver.com/testowner/123456789012')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('never renders result link for javascript: URLs or external hosts', () => {
    const { rerender } = render(
      <PublishStatusCard
        entry={{
          ...expired,
          status: 'succeeded',
          resultUrl: 'javascript:alert(1)',
        }}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />,
    )
    expect(screen.queryByRole('link', { name: '글 보기' })).not.toBeInTheDocument()

    rerender(
      <PublishStatusCard
        entry={{
          ...expired,
          status: 'succeeded',
          resultUrl: 'https://evil.attacker.com/some/post',
        }}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />,
    )
    expect(screen.queryByRole('link', { name: '글 보기' })).not.toBeInTheDocument()
  })

  it('renders phase progress text when phase is available', () => {
    render(
      <PublishStatusCard
        entry={{
          ...expired,
          status: 'running',
          phase: 'editor_ready',
        }}
        workspaceId="30000000-0000-4000-8000-000000000001"
        canManage
      />,
    )
    expect(screen.getByText('진행 단계')).toBeInTheDocument()
    expect(screen.getByText('글 입력')).toBeInTheDocument()
  })
})
