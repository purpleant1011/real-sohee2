import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NaverPublishResult } from './naver-publish-result'
import type { LocalPublishStatusEntry } from '@/features/local-publishing/publish-status-card'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const baseEntry: LocalPublishStatusEntry = {
  id: '33333333-3333-4333-8333-333333333333',
  status: 'running',
  channel: 'naver_blog',
  targetLabel: 'findk3 테스트 블로그',
  contentVersionId: '44444444-4444-4444-4444-444444444444',
  scheduledAt: null,
  autoExecuteUntil: null,
  failureCode: null,
  visibility: 'public',
  phase: 'editor_ready',
}

const expected = {
  title: '가을철 피부관리 안내',
  categoryName: '일상',
  imageCount: 4,
}

describe('NaverPublishResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders registered URL submission form instead of server HTML verification', () => {
    render(
      <NaverPublishResult
        workspaceId={WORKSPACE}
        entry={{ ...baseEntry, status: 'succeeded', resultUrl: 'https://blog.naver.com/testowner/123456789012' }}
        expected={expected}
        contentId="55555555-5555-4555-8555-555555555555"
        versionId={baseEntry.contentVersionId}
      />,
    )

    // Should render URL registration form instead of server HTML verification
    expect(screen.getByText('게시 URL 등록')).toBeInTheDocument()
    expect(screen.getByLabelText(/올린 글 주소/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /올린 글 주소 기록/ })).toBeInTheDocument()

    // Server verification status labels must NOT be present
    expect(screen.queryByText('네이버에 올라간 글을 직접 읽어 확인하고 있어요…')).not.toBeInTheDocument()
    expect(screen.queryByText('확인됨')).not.toBeInTheDocument()
  })

  it('sends the versionId accepted by the cross-post API without claiming an external publication', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) })
    vi.stubGlobal('fetch', request)
    render(
      <NaverPublishResult
        workspaceId={WORKSPACE}
        entry={{ ...baseEntry, status: 'succeeded', resultUrl: 'https://blog.naver.com/testowner/123456789012' }}
        expected={expected}
        contentId="55555555-5555-4555-8555-555555555555"
        versionId={baseEntry.contentVersionId}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /인스타·스레드.*변환/ }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const [url, init] = request.mock.calls[0]
    expect(url).toBe(`/api/workspaces/${WORKSPACE}/naver-posts/55555555-5555-4555-8555-555555555555/cross-post`)
    expect(JSON.parse(init.body)).toEqual({ versionId: baseEntry.contentVersionId })
    expect(await screen.findByText(/보관함에 준비되었어요/)).toBeInTheDocument()
    expect(screen.queryByText(/1초 만에 올리기/)).not.toBeInTheDocument()
  })

  it('does not offer a manager-only conversion to a read-only member', () => {
    render(
      <NaverPublishResult
        workspaceId={WORKSPACE}
        entry={{ ...baseEntry, status: 'succeeded' }}
        expected={expected}
        contentId="content"
        versionId={baseEntry.contentVersionId}
        canManage={false}
      />,
    )
    expect(screen.getByRole('button', { name: /인스타·스레드.*변환/ })).toBeDisabled()
  })

  it('does not render "글 보기" button for javascript: or external URLs', () => {
    const dangerousEntry: LocalPublishStatusEntry = {
      ...baseEntry,
      status: 'succeeded',
      phase: 'succeeded',
      resultUrl: 'javascript:alert(1)',
    }

    render(
      <NaverPublishResult
        workspaceId={WORKSPACE}
        entry={dangerousEntry}
        expected={expected}
      />,
    )

    expect(screen.queryByRole('link', { name: '글 보기' })).not.toBeInTheDocument()
  })

  it('displays canonical failure copy and never offers auto-retry for UNKNOWN_RESULT', () => {
    const unknownResultEntry: LocalPublishStatusEntry = {
      ...baseEntry,
      status: 'unknown_after_submit',
      failureCode: 'UNKNOWN_RESULT',
    }

    render(
      <NaverPublishResult
        workspaceId={WORKSPACE}
        entry={unknownResultEntry}
        expected={expected}
      />,
    )

    expect(
      screen.getByText('게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })
})
