import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ContentDetail } from './types'
import type { ApprovalPreviewSnapshot } from './types'
import type { SocialPerformanceReport } from '@/features/reports/types'

const mockCollectAction = vi.fn()
vi.mock('@/features/reports/actions/collect-social-performance', () => ({
  collectSocialPerformanceAction: (input: unknown) => mockCollectAction(input),
}))

vi.mock('@/features/approvals/approval-panel', () => ({
  ApprovalPanel: () => <div data-testid="approval-panel" />,
}))

vi.mock('@/features/channel-studio/naver/ui/naver-review-step', () => ({
  NaverReviewStep: (props: {
    workspaceId: string
    contentId: string
    settings: { visibility: string; categoryName: string | null; imageCount: number }
  }) => (
    <div
      data-testid="naver-review-step"
      data-workspace={props.workspaceId}
      data-content={props.contentId}
      data-visibility={props.settings.visibility}
      data-image-count={props.settings.imageCount}
    >
      <button type="button">본문 복사</button>
      <a href="https://blog.naver.com/GoBlogWrite.naver">글쓰기 링크</a>
    </div>
  ),
}))

import { WorkDetail } from './work-detail'

it('hands only the opaque current version to conversation review without embedding copy or a client return URL', () => {
  render(<WorkDetail detail={detail} conversationWorkbenchEnabled />)
  expect(screen.getByRole('link', { name: '이 원고를 소희와 검토' })).toHaveAttribute('href', `/app/conversations?workRef=${detail.currentVersionId}`)
})

const workspaceId = '10000000-0000-4000-8000-000000000001'
const detail: ContentDetail = {
  id: '20000000-0000-4000-8000-000000000001',
  title: '여름 관리 게시물',
  status: 'draft',
  channel: 'instagram',
  currentVersionId: '30000000-0000-4000-8000-000000000002',
  currentVersionNumber: 2,
  createdAt: '2026-08-10T01:00:00.000Z',
  updatedAt: '2026-08-10T02:00:00.000Z',
  source: 'actual',
  versions: [
    {
      id: '30000000-0000-4000-8000-000000000002',
      versionNumber: 2,
      caption: '두 번째 문안',
      hashtags: ['#여름'],
      disclosure: 'AI 생성 이미지',
      fingerprint: 'b'.repeat(64),
      revisionReason: '표지 변경',
      createdAt: '2026-08-10T02:00:00.000Z',
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      mediaCount: 1,
      media: [{
        id: '40000000-0000-4000-8000-000000000002',
        position: 1,
        mimeType: 'image/png',
        altText: '바뀐 여름 관리 표지',
        role: 'cover',
        rightsStatus: 'confirmed',
      }],
      structuredPayload: null,
      knowledgeIds: [],
      harnessRuleIds: [],
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      versionNumber: 1,
      caption: '첫 번째 문안',
      hashtags: ['#여름'],
      disclosure: 'AI 생성 이미지',
      fingerprint: 'a'.repeat(64),
      revisionReason: null,
      createdAt: '2026-08-10T01:00:00.000Z',
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      mediaCount: 1,
      media: [{
        id: '40000000-0000-4000-8000-000000000001',
        position: 1,
        mimeType: 'image/png',
        altText: '기존 여름 관리 표지',
        role: 'cover',
        rightsStatus: 'confirmed',
      }],
      structuredPayload: null,
      knowledgeIds: [],
      harnessRuleIds: [],
    },
  ],
}

const socialReport: SocialPerformanceReport = {
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-31T23:59:59.999Z',
  posts: [{
    workItemId: '70000000-0000-4000-8000-000000000001',
    workTitle: detail.title,
    contentItemId: detail.id,
    contentVersionId: detail.versions[0].id,
    versionNumber: 2,
    channel: 'instagram',
    scheduleId: '80000000-0000-4000-8000-000000000001',
    scheduledAt: '2026-08-11T01:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: '90000000-0000-4000-8000-000000000001',
    deliveryStatus: 'succeeded',
    providerPostReference: 'ig-post-123',
    publishedAt: '2026-08-11T01:02:00.000Z',
    collectionStatus: 'succeeded',
    collectionPeriodStart: '2026-08-11T01:02:00.000Z',
    collectionPeriodEnd: '2026-08-12T01:02:00.000Z',
    collectedAt: '2026-08-12T01:03:00.000Z',
    metrics: [{ metric: 'likes', state: 'available', value: 7 }],
    reactions: [{
      id: 'a0000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      category: 'comment',
      occurredAt: '2026-08-11T02:00:00.000Z',
      text: '예약 가능한가요?',
      providerPostReference: 'ig-post-123',
    }],
  }],
  unlinkedReactions: [],
}

const approvedPreview: ApprovalPreviewSnapshot = {
  workspaceId,
  contentId: detail.id,
  versionId: detail.currentVersionId!,
  versionNumber: 2,
  fingerprint: detail.versions[0].fingerprint,
  approval: { id: '60000000-0000-4000-8000-000000000001', status: 'approved', fingerprint: detail.versions[0].fingerprint },
  channel: 'instagram',
  account: { connectionId: '61000000-0000-4000-8000-000000000001', label: '@sohee.ai', status: 'connected' },
  caption: '게시 문구',
  hashtags: [],
  disclosure: '',
  text: '게시 문구',
  media: [],
  issues: [],
}

describe('WorkDetail', () => {
  it('shows exact ordered media, alt text, rights, evidence, and version changes', () => {
    render(<WorkDetail detail={detail} workspaceId={workspaceId} />)

    expect(screen.getByRole('img', { name: '바뀐 여름 관리 표지' })).toHaveAttribute(
      'src',
      expect.stringContaining(`/api/workspaces/${workspaceId}/media/${detail.versions[0].media[0].id}`),
    )
    expect(screen.getAllByText('1번 · 표지')).toHaveLength(2)
    expect(screen.getAllByText('사용권 확인됨')).toHaveLength(2)
    expect(screen.getAllByText('내용 확인됨')).toHaveLength(2)
    expect(screen.getByText('이전 버전과 이미지 변경 1건')).toBeInTheDocument()
  })

  it('reuses the exact published version and customer reaction in the work detail', () => {
    render(<WorkDetail detail={detail} workspaceId={workspaceId} socialReport={socialReport} />)

    expect(screen.getByRole('heading', { name: '게시 결과와 고객 반응' })).toBeInTheDocument()
    expect(screen.getByText('인스타그램 · 게시 버전 v2')).toBeInTheDocument()
    expect(screen.getByText(/채널 게시물 ig-post-123/)).toBeInTheDocument()
    expect(screen.getByText('좋아요 7')).toBeInTheDocument()
    expect(screen.getByText(/예약 가능한가요\?/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '리포트에서 전체 흐름 보기' })).toHaveAttribute(
      'href',
      `/app/reports?view=reactions&work=${detail.id}`,
    )
  })

  it('restores the approved current-version publish panel only after a failed delivery', () => {
    const failedReport: SocialPerformanceReport = {
      ...socialReport,
      posts: [{ ...socialReport.posts[0], deliveryStatus: 'failed', providerPostReference: null }],
    }

    const { rerender } = render(<WorkDetail
      detail={{ ...detail, status: 'scheduled' }}
      role="owner"
      workspaceId={workspaceId}
      socialReport={failedReport}
      preview={approvedPreview}
    />)
    expect(screen.getByTestId('approval-panel')).toBeInTheDocument()

    rerender(<WorkDetail
      detail={{ ...detail, status: 'scheduled' }}
      role="owner"
      workspaceId={workspaceId}
      socialReport={socialReport}
      preview={approvedPreview}
    />)
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument()

    rerender(<WorkDetail
      detail={{ ...detail, status: 'approved' }}
      role="owner"
      workspaceId={workspaceId}
      socialReport={socialReport}
      preview={approvedPreview}
    />)
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument()

    rerender(<WorkDetail
      detail={{ ...detail, status: 'scheduled' }}
      role="owner"
      workspaceId={workspaceId}
      socialReport={{
        ...socialReport,
        posts: [{ ...socialReport.posts[0], deliveryStatus: 'pending', providerPostReference: null }],
      }}
      preview={approvedPreview}
    />)
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument()
  })

  it('renders Naver manual publishing helper (copy button, write link) without auto-publishing wording', () => {
    render(
      <WorkDetail
        detail={{ ...detail, channel: 'naver_blog', status: 'approved' }}
        role="owner"
        workspaceId={workspaceId}
        preview={{ ...approvedPreview, channel: 'naver_blog' }}
      />,
    )

    expect(screen.getByRole('button', { name: '본문 복사' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '글쓰기 링크' })).toHaveAttribute(
      'href',
      'https://blog.naver.com/GoBlogWrite.naver',
    )
    expect(screen.getByTestId('naver-review-step')).toHaveAttribute('data-content', detail.id)
    expect(screen.getByTestId('naver-review-step')).toHaveAttribute('data-image-count', '1')
    expect(screen.queryByTestId('exact-control')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(/자동 게시|자동 실행/)).not.toBeInTheDocument()
  })

  it('does not render NaverReviewStep when workspaceId or currentVersionId is missing', () => {
    const { rerender } = render(
      <WorkDetail
        detail={{ ...detail, channel: 'naver_blog', currentVersionId: null }}
        workspaceId={workspaceId}
      />,
    )
    expect(screen.queryByTestId('naver-review-step')).not.toBeInTheDocument()

    rerender(
      <WorkDetail
        detail={{ ...detail, channel: 'naver_blog' }}
        workspaceId={undefined}
      />,
    )
    expect(screen.queryByTestId('naver-review-step')).not.toBeInTheDocument()
  })

  it('네이버 블로그 버전 목록에서 공개 범위/게시 상태를 표시하지 않는다 (사용자가 직접 선택)', () => {
    const naverDetail: ContentDetail = {
      ...detail,
      channel: 'naver_blog',
      versions: [
        {
          ...detail.versions[0],
          structuredPayload: {
            channel: 'naver_blog',
            title: '블로그 제목',
            introduction: '소개',
            sections: [{ heading: '소제목', body: '본문' }],
            keywords: ['키워드'],
            imagePlacements: [],
            cta: '문의하기',
            visibility: 'public',
          },
        },
      ],
    }

    render(<WorkDetail detail={naverDetail} workspaceId={workspaceId} />)

    expect(screen.queryByText(/네이버 게시 상태/)).not.toBeInTheDocument()
    expect(screen.queryByText(/전체공개/)).not.toBeInTheDocument()
  })

  describe('성과 새로고침 (Social Performance Refresh)', () => {
    it('게시 성공 및 providerPostReference가 있는 경우에만 "성과 새로고침" 버튼이 노출된다', () => {
      const { rerender } = render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      expect(screen.getByRole('button', { name: '성과 새로고침' })).toBeInTheDocument()

      // providerPostReference가 없으면 노출되지 않음
      const noRefReport: SocialPerformanceReport = {
        ...socialReport,
        posts: [{ ...socialReport.posts[0], providerPostReference: null }],
      }
      rerender(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={noRefReport}
        />,
      )
      expect(screen.queryByRole('button', { name: '성과 새로고침' })).not.toBeInTheDocument()

      // deliveryStatus가 failed이면 노출되지 않음
      const failedReport: SocialPerformanceReport = {
        ...socialReport,
        posts: [{ ...socialReport.posts[0], deliveryStatus: 'failed' }],
      }
      rerender(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={failedReport}
        />,
      )
      expect(screen.queryByRole('button', { name: '성과 새로고침' })).not.toBeInTheDocument()
    })

    it('불러오는 중(pending) 상태에서는 "불러오는 중…"이 표시되고 비활성화된다', async () => {
      let resolveAction!: (val: unknown) => void
      mockCollectAction.mockReturnValue(
        new Promise((res) => {
          resolveAction = res
        }),
      )

      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      const refreshButton = screen.getByRole('button', { name: '성과 새로고침' })
      act(() => {
        refreshButton.click()
      })

      expect(screen.getByRole('button', { name: '불러오는 중…' })).toBeDisabled()

      await act(async () => {
        resolveAction({
          data: {
            collectionId: 'col-1',
            status: 'succeeded',
            snapshot: {
              collectedAt: '2026-08-12T05:00:00.000Z',
              metrics: [{ metric: 'likes', state: 'available', value: 20 }],
            },
          },
        })
      })

      expect(screen.getByRole('button', { name: '성과 새로고침' })).toBeDisabled() // 30s 쿨다운 중
    })

    it('성과 새로고침 성공 시 스냅샷 지표와 수집 시각이 갱신된다', async () => {
      mockCollectAction.mockResolvedValue({
        data: {
          collectionId: 'col-1',
          status: 'succeeded',
          snapshot: {
            collectedAt: '2026-08-12T05:00:00.000Z',
            metrics: [
              { metric: 'views', state: 'available', value: 100 },
              { metric: 'likes', state: 'available', value: 20 },
            ],
          },
        },
      })

      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      const refreshButton = screen.getByRole('button', { name: '성과 새로고침' })
      await act(async () => {
        refreshButton.click()
      })

      expect(screen.getByText(/조회 100 · 좋아요 20/)).toBeInTheDocument()
      expect(screen.getByText(/2:00|14:00/)).toBeInTheDocument()
    })

    it('데이터가 없는 지표는 가짜 0 대신 "확인하지 못했어요"를 렌더링한다', async () => {
      mockCollectAction.mockResolvedValue({
        data: {
          collectionId: 'col-1',
          status: 'succeeded',
          snapshot: {
            collectedAt: '2026-08-12T05:00:00.000Z',
            metrics: [
              { metric: 'views', state: 'no_data', value: null },
            ],
          },
        },
      })

      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      const refreshButton = screen.getByRole('button', { name: '성과 새로고침' })
      await act(async () => {
        refreshButton.click()
      })

      expect(screen.getByText(/조회 확인하지 못했어요/)).toBeInTheDocument()
      expect(screen.queryByText(/조회 0/)).not.toBeInTheDocument()
    })

    it('권한 부족(permission_denied) 시 안내 메시지와 /app/channels 링크가 노출된다', async () => {
      mockCollectAction.mockResolvedValue({
        data: {
          collectionId: 'col-1',
          status: 'permission_denied',
        },
      })

      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      const refreshButton = screen.getByRole('button', { name: '성과 새로고침' })
      await act(async () => {
        refreshButton.click()
      })

      expect(screen.getByText('채널 연결 권한을 확인해 주세요')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: /채널 연결/ })
      expect(link).toHaveAttribute('href', '/app/channels')
    })

    it('일반 실패 시 안내 메시지가 노출된다', async () => {
      mockCollectAction.mockResolvedValue({
        error: {
          message: '채널 성과를 수집하지 못했습니다.',
          requestId: 'social-performance-collect',
        },
      })

      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      const refreshButton = screen.getByRole('button', { name: '성과 새로고침' })
      await act(async () => {
        refreshButton.click()
      })

      expect(screen.getByText('성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    })

    it('화면 어디에도 크레딧 관련 문구가 노출되지 않는다', () => {
      const { container } = render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
        />,
      )

      expect(container.textContent).not.toContain('크레딧')
      expect(container.textContent).not.toContain('credit')
    })
  })

  describe('게시물 임베드 (PostEmbed 연결)', () => {
    it('소셜 리포트에 destinationUrl 이 있으면 게시물 미리 보기 버튼이 렌더링되고 클릭 시 iframe이 표시된다', async () => {
      const reportWithEmbed: SocialPerformanceReport = {
        ...socialReport,
        posts: [{
          ...socialReport.posts[0],
          destinationUrl: 'https://www.instagram.com/p/C_abc123/',
        }],
      }

      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={reportWithEmbed}
        />,
      )

      const toggleButton = screen.getByRole('button', { name: '게시물 미리 보기' })
      expect(toggleButton).toBeInTheDocument()

      await act(async () => {
        toggleButton.click()
      })

      const iframe = screen.getByTitle('인스타그램 게시물 미리 보기')
      expect(iframe).toBeInTheDocument()
      expect(iframe).toHaveAttribute('src', 'https://www.instagram.com/p/C_abc123/embed')
    })

    it('post에 destinationUrl이 없어도 fallbackPermalink가 주어지면 PostEmbed 가 렌더링된다', async () => {
      render(
        <WorkDetail
          detail={{ ...detail, status: 'published' }}
          workspaceId={workspaceId}
          socialReport={socialReport}
          fallbackPermalink="https://www.threads.com/@sohee/post/xyz789"
        />,
      )

      const toggleButton = screen.getByRole('button', { name: '게시물 미리 보기' })
      expect(toggleButton).toBeInTheDocument()

      await act(async () => {
        toggleButton.click()
      })

      const iframe = screen.getByTitle('스레드 게시물 미리 보기')
      expect(iframe).toBeInTheDocument()
      expect(iframe).toHaveAttribute('src', 'https://www.threads.com/@sohee/post/xyz789/embed')
    })
  })

})
