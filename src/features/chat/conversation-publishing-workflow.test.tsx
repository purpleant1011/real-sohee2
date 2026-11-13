import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

const mocks = vi.hoisted(() => ({
  partialRevision: vi.fn(),
  restore: vi.fn(),
  meta: vi.fn(),
  dispatch: vi.fn(),
  load: vi.fn(),
  loadStyleSummary: vi.fn(),
  wake: vi.fn(),
  probe: vi.fn(async () => true),
  mediaStatus: {
    total: 1, loaded: 1, failedPositions: [] as number[], ready: true,
  },
}))

vi.mock('@/features/image-style/actions/load-style-summary', () => ({
  loadWorkspaceStyleSummaryAction: mocks.loadStyleSummary,
}))

vi.mock('./actions/partial-content-revision', () => ({
  partialContentRevisionAction: mocks.partialRevision,
}))
vi.mock('./actions/naver-meta-revision', () => ({ naverMetaRevisionAction: mocks.meta }))
vi.mock('./actions/restore-naver-version', () => ({
  restoreNaverVersionAction: mocks.restore,
}))
vi.mock('./actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: mocks.load,
}))
vi.mock('./actions/load-post-publish-care', () => ({
  loadPostPublishCare: vi.fn(async () => ({
    ok: true,
    state: {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      comment_watch: { enabled: true, available: true, reason: null },
      reaction_report: { enabled: true, available: true, reason: null, needsSetup: false },
      always_on: {
        dm: { active: true, reason: null },
        booking_inquiry: { active: true, reason: null },
      },
    },
  })),
}))
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({
  approveAndDispatchAction: mocks.dispatch,
}))
vi.mock('@/features/image-style/overlay/overlay-composer', () => ({
  OverlayComposer: ({ workspaceId, baseUrl, onSaved }: {
    workspaceId: string
    baseUrl: string | null
    onSaved?: (saved: { assetId: string; url: string }) => void
  }) => (
    <div data-testid="overlay-composer" data-workspace-id={workspaceId} data-base-url={baseUrl ?? ''}>
      <button
        type="button"
        onClick={() => onSaved?.({ assetId: '50000000-0000-4000-8000-000000000009', url: '/x' })}
      >
        스텁 저장
      </button>
    </div>
  ),
}))
vi.mock('@/features/local-publishing/wake-browser-connector', () => ({
  wakeBrowserConnector: mocks.wake,
}))
vi.mock('@/features/local-publishing/actions/create-pairing-code', () => ({
  createPairingCodeAction: vi.fn(),
}))
// 발행 가드의 실제 연결 확인(probe)은 jsdom 에서 항상 실패한다. 이 테스트는 발행 흐름을 보는 것이므로
// 연결 확인은 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다(ANI-1778).
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: () => mocks.probe() }
})
vi.mock('@/features/approvals/channel-preview-card', async () => {
  const React = await import('react')
  return {
    ChannelPreviewCard: ({ preview, onMediaReadinessChange, onMediaStatusChange }: {
      preview: ApprovalPreviewSnapshot
      onMediaReadinessChange: (ready: boolean) => void
      onMediaStatusChange?: (status: typeof mocks.mediaStatus) => void
    }) => {
      React.useEffect(() => {
        onMediaReadinessChange(mocks.mediaStatus.ready)
        onMediaStatusChange?.(mocks.mediaStatus)
      }, [onMediaReadinessChange, onMediaStatusChange, preview.versionId])
      return <article aria-label={`${preview.channel} v${preview.versionNumber} 미리보기`}>
        {preview.text}
        {preview.media.map((media) => <span key={media.id}>{media.altText}</span>)}
      </article>
    },
  }
})

import { dispatchNaverBlockSelect } from './naver-block-select-event'
import { ConversationPublishingWorkflow } from './conversation-publishing-workflow'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

function preview(versionNumber: number, approvalStatus: 'unreviewed' | 'approved' = 'unreviewed'): ApprovalPreviewSnapshot {
  const versionId = `30000000-0000-4000-8000-${String(versionNumber).padStart(12, '0')}`
  const fingerprint = String(versionNumber).repeat(64).slice(0, 64)
  return {
    workspaceId: '10000000-0000-4000-8000-000000000001',
    contentId: '20000000-0000-4000-8000-000000000001',
    versionId,
    versionNumber,
    fingerprint,
    approval: {
      id: approvalStatus === 'approved' ? '40000000-0000-4000-8000-000000000001' : null,
      status: approvalStatus,
      fingerprint: approvalStatus === 'approved' ? fingerprint : null,
    },
    channel: 'instagram',
    naverRevisionReadiness: 'ready',
    account: {
      connectionId: '50000000-0000-4000-8000-000000000001',
      label: '@studio_byreum',
      status: 'connected',
    },
    caption: `정확한 본문 v${versionNumber}`,
    hashtags: ['#자연눈썹'],
    disclosure: 'AI 보조 제작',
    text: `정확한 본문 v${versionNumber}\n\n#자연눈썹\n\nAI 보조 제작`,
    media: [{
      id: '60000000-0000-4000-8000-000000000001',
      position: 1,
      mimeType: 'image/png',
      altText: '첫 번째 결과 이미지',
      src: '/media/one',
    }],
    issues: [],
  }
}

describe('ConversationPublishingWorkflow', () => {
  it('records Naver approval via approve_only without calling wakeBrowserConnector', async () => {
    const naver = { ...preview(3), channel: 'naver_blog' as const, visibility: 'public' as const }
    mocks.dispatch.mockResolvedValueOnce({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: naver.versionId,
        next: 'approved',
        scheduleId: null,
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })
    mocks.load.mockResolvedValue({
      data: {
        role: 'owner',
        preview: {
          ...naver,
          approval: {
            id: '40000000-0000-4000-8000-000000000001',
            status: 'approved',
            fingerprint: naver.fingerprint,
          },
        },
        receipt: null,
      },
    })
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)
    const button = screen.getByRole('button', { name: '공개 v3 네이버 원고 승인' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith({
      workspaceId: naver.workspaceId,
      contentId: naver.contentId,
      versionId: naver.versionId,
      fingerprint: naver.fingerprint,
      mode: 'approve_only',
      channelConnectionId: null,
      scheduledLocal: null,
      timezone: null,
    }))
    expect(mocks.wake).not.toHaveBeenCalled()
  })
  it('keeps the existing SNS edit path available without a Naver capability', () => {
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: { ...preview(3), naverRevisionReadiness: undefined }, receipt: null }} />)
    expect(screen.getByRole('button', { name: '문구 다듬기' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '문구 다듬기' }))
    expect(screen.getByRole('textbox', { name: '소희에게 수정할 문장을 알려주세요' })).toBeEnabled()
  })

  it.each(['not_ready', 'unavailable', undefined] as const)('blocks Naver revision controls without confirmed command readiness: %s', readiness => {
    const naver = { ...preview(3), channel: 'naver_blog' as const, naverRevisionReadiness: readiness,
      naverBlocks: [{ kind: 'paragraph' as const, text: '보존할 원고' }],
      naverCopy: { title: '보존할 제목', introduction: '도입', sections: [], keywords: ['안내'], cta: '문의' } }
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null,
      previousVersions: [{ id: '30000000-0000-4000-8000-000000000001', versionNumber: 1, createdAt: '2026-10-28T00:00:00Z', revisionReason: null }] }} />)
    expect(screen.getByRole('button', { name: '원고 문단 직접 수정' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '제목·태그 수정' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'v1 내용으로 새 버전 만들기' })).toBeDisabled()
    expect(screen.getByText(/원고 조회와 복사는 계속/)).toBeInTheDocument()
    expect(mocks.partialRevision).not.toHaveBeenCalled()
    expect(mocks.restore).not.toHaveBeenCalled()
    expect(mocks.meta).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    resetPageActionGuardForTests()
    setOnLine(true)
    mocks.probe.mockResolvedValue(true)
    mocks.partialRevision.mockResolvedValue({
      data: { preview: preview(4), revisionSummary: '본문만 수정했어요.' },
    })
    mocks.dispatch.mockResolvedValue({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: preview(3).versionId,
        next: 'approved',
        scheduleId: null,
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })
    mocks.load.mockResolvedValue({ data: { role: 'owner', preview: preview(3, 'approved'), receipt: null } })
    mocks.loadStyleSummary.mockResolvedValue({ error: { message: '기본값' } })
    mocks.wake.mockResolvedValue({ state: 'approved_job_started' })
    mocks.mediaStatus = { total: 1, loaded: 1, failedPositions: [], ready: true }
  })

  it('creates v4 from a caption-only instruction and moves every active label to v4', async () => {
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3), receipt: null }} />)

    fireEvent.click(screen.getByRole('button', { name: '본문 수정 지시' }))
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 수정할 문장을 알려주세요' }), {
      target: { value: '첫 문장만 더 짧고 자연스럽게 바꿔줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: '이 부분만 수정' }))

    await waitFor(() => expect(mocks.partialRevision).toHaveBeenCalledWith(expect.objectContaining({
      versionId: preview(3).versionId,
      fingerprint: preview(3).fingerprint,
      scope: 'caption',
      instruction: '첫 문장만 더 짧고 자연스럽게 바꿔줘',
    })))
    expect(await screen.findByText('v4 부분 수정 완료')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '이대로 승인' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '안전·게시 정보' })).toHaveTextContent('v4')
  })

  it('edits one Naver paragraph with visible diff and returns to unapproved v4', async () => {
    const current = { ...preview(3, 'approved'), channel: 'naver_blog' as const,
      naverBlocks: [{ kind: 'paragraph' as const, text: '기존 문단' }] }
    mocks.partialRevision.mockResolvedValue({ data: {
      preview: { ...preview(4), channel: 'naver_blog', naverBlocks: [{ kind: 'paragraph', text: '새 문단' }] },
      revisionSummary: '1번 문단을 수정했어요.',
      diff: { blockId: `${current.versionId}:0`, before: '기존 문단', after: '새 문단' },
    } })
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: current, receipt: null }} />)
    expect(screen.queryByRole('button', { name: '이미지 추가 생성' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '원고 문단 직접 수정' }))
    fireEvent.change(screen.getByRole('textbox', { name: '바꿀 문단 내용' }), { target: { value: '새 문단' } })
    expect(screen.getByRole('region', { name: '문단 변경 비교' })).toHaveTextContent('기존 문단')
    expect(screen.getByRole('region', { name: '문단 변경 비교' })).toHaveTextContent('새 문단')
    fireEvent.click(screen.getByRole('button', { name: '문단을 새 버전으로 저장' }))
    await waitFor(() => expect(mocks.partialRevision).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'naver_block', targetBlockIndex: 0, instruction: '새 문단', versionId: current.versionId, fingerprint: current.fingerprint,
    })))
    expect(await screen.findByText('v4 승인 대기')).toBeInTheDocument()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('shows the exact approval target and moves long evidence into a detail panel', () => {
    render(<ConversationPublishingWorkflow
      initialState={{ role: 'owner', preview: preview(3), receipt: null }}
      reviewContext={{
        evidence: ['승인된 브랜드 말투', '최근 상담 질문 12건'],
        limitations: ['실제 게시 반응은 아직 수집 전이에요.'],
        unresolvedQuestions: ['행사 종료일을 확인해 주세요.'],
      }}
    />)

    const summary = screen.getByRole('group', { name: '안전·게시 정보' })
    expect(summary).toHaveTextContent('Instagram')
    expect(summary).toHaveTextContent('@studio_byreum')
    expect(summary).toHaveTextContent('v3')
    expect(summary).toHaveTextContent('이미지 1장')
    expect(screen.queryByText('최근 상담 질문 12건')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '근거 보기' }))

    const dialog = screen.getByRole('dialog', { name: '이 버전의 근거' })
    expect(dialog).toHaveTextContent('승인된 브랜드 말투')
    expect(dialog).toHaveTextContent('실제 게시 반응은 아직 수집 전이에요.')
    expect(dialog).toHaveTextContent('행사 종료일을 확인해 주세요.')
  })

  it('shows one large channel preview with direct edit actions and keeps technical details collapsed when ready', () => {
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3), receipt: null }} />)

    expect(screen.getByRole('region', { name: '대화 안 게시물 검토와 실행' })).toHaveAttribute('data-layout', 'single-column')
    expect(screen.getByRole('button', { name: '이미지 바꾸기' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '이미지 바꾸기' }))
    expect(screen.getByRole('link', { name: '우리 매장 이미지 스타일 설정' })).toHaveAttribute('href', '/app/settings/image-style')
    expect(screen.getByRole('button', { name: '문구 다듬기' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '이대로 승인' })).toBeEnabled()
    expect(screen.getByRole('group', { name: '안전·게시 정보' })).not.toHaveAttribute('open')
    expect(screen.queryByText('보이는 내용 그대로 승인해요')).not.toBeInTheDocument()
  })

  it('records approval first and requires a separate confirmed publish command', async () => {
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3), receipt: null }} />)

    fireEvent.click(screen.getByRole('button', { name: '이대로 승인' }))

    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'approve_only' })))
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: '지금 게시' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지금 게시' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    fireEvent.click(screen.getByRole('button', { name: '게시하기' }))

    await waitFor(() => expect(mocks.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'publish_now' })))
    expect(mocks.dispatch).toHaveBeenCalledTimes(2)
  })

  it('simplifies mobile publishing: one-line channel+account, collapsed 자세히 disclosure, and compact 한국 시간 schedule toggle', async () => {
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)

    // (a) channel and account in one line
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Instagram · @studio_byreum')

    // (e) collapsed '자세히' disclosure
    const summary = screen.getByRole('group', { name: '안전·게시 정보' })
    expect(summary).not.toHaveAttribute('open')
    expect(screen.getByText('자세히')).toBeInTheDocument()

    // (c) segmented toggle '지금 / 예약' with no Asia/Seoul jargon, showing '한국 시간'
    expect(screen.queryByLabelText(/예약 시각/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Asia\/Seoul/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '예약 게시' }))
    const timeInput = screen.getByLabelText('예약 시각 (한국 시간)')
    expect(timeInput).toBeInTheDocument()
    expect(screen.queryByText(/Asia\/Seoul/)).not.toBeInTheDocument()

    // button disabled before time input and confirmation
    const publishButton = screen.getByRole('button', { name: '게시하기' })
    expect(publishButton).toBeDisabled()

    fireEvent.change(timeInput, { target: { value: '2026-11-05T14:30' } })
    expect(publishButton).toBeDisabled()

    // (d) compact 1-line consent checkbox
    const checkbox = screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' })
    fireEvent.click(checkbox)
    expect(publishButton).toBeEnabled()

    // (b) primary action '게시하기'
    fireEvent.click(publishButton)
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'schedule',
      scheduledLocal: '2026-11-05T14:30',
      timezone: 'Asia/Seoul',
    })))
  })

  it('approves Naver version and shows manual publishing helper without waking connector', async () => {
    const naver = {
      ...preview(3),
      channel: 'naver_blog' as const,
      visibility: 'public' as const,
      account: { ...preview(3).account, label: 'findk3' },
    }
    mocks.dispatch.mockResolvedValueOnce({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: naver.versionId,
        next: 'approved',
        scheduleId: null,
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })
    mocks.load.mockResolvedValue({
      data: {
        role: 'owner',
        preview: {
          ...naver,
          approval: {
            id: '40000000-0000-4000-8000-000000000001',
            status: 'approved',
            fingerprint: naver.fingerprint,
          },
        },
        receipt: null,
      },
    })
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    fireEvent.click(screen.getByRole('button', { name: '공개 v3 네이버 원고 승인' }))

    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith({
      workspaceId: naver.workspaceId,
      contentId: naver.contentId,
      versionId: naver.versionId,
      fingerprint: naver.fingerprint,
      mode: 'approve_only',
      channelConnectionId: null,
      scheduledLocal: null,
      timezone: null,
    }))
    expect(mocks.wake).not.toHaveBeenCalled()
    expect(
      await screen.findByText('소희는 네이버 자동 게시를 하지 않아요. 글·사진을 준비해 드리고 직접 올리실 수 있게 도와요'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.'),
    ).toBeInTheDocument()
  })

  it('explains account connection requirement without rendering one-click setup inside workflow', () => {
    const naver = {
      ...preview(3), channel: 'naver_blog' as const, visibility: 'public' as const,
      account: { connectionId: null, label: 'findk3', status: 'disconnected' as const },
      issues: [{ code: 'channel_disconnected', message: '공식 채널을 다시 연결한 뒤 게시할 수 있어요.' }],
    }
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    expect(screen.queryByRole('list', { name: '네이버 게시 연결 상태' })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('findk3 계정 연결이 필요해요')
    expect(screen.getByRole('button', { name: 'findk3 연결을 완료해 주세요' })).toBeDisabled()
  })

  it('explains image verification progress beside the blocked Naver publish action', () => {
    mocks.mediaStatus = { total: 5, loaded: 2, failedPositions: [], ready: false }
    const naver = {
      ...preview(3), channel: 'naver_blog' as const, visibility: 'public' as const,
      account: { ...preview(3).account, label: 'findk3' },
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    const gate = screen.getByRole('status', { name: '게시 전 확인' })
    expect(gate).toHaveTextContent('이미지 2/5장 확인 중')
    expect(gate).toHaveTextContent('아래로 스크롤하지 않아도 소희가 자동으로 확인합니다.')
    expect(screen.getByRole('button', { name: '이미지 확인 중 2/5' })).toBeDisabled()
  })

  it('names failed image positions and offers one recovery action beside publishing', () => {
    mocks.mediaStatus = { total: 5, loaded: 4, failedPositions: [4], ready: false }
    const naver = {
      ...preview(3), channel: 'naver_blog' as const, visibility: 'public' as const,
      account: { ...preview(3).account, label: 'findk3' },
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('4번 이미지를 확인하지 못했어요')
    expect(screen.getByRole('button', { name: '실패한 이미지 다시 확인' })).toBeEnabled()
  })

  it('explains missing publish permission instead of showing a silent disabled button', () => {
    const naver = {
      ...preview(3), channel: 'naver_blog' as const, visibility: 'public' as const,
      account: { ...preview(3).account, label: 'findk3' },
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'viewer', preview: naver, receipt: null }} />)

    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('게시 권한이 필요해요')
    expect(screen.getByRole('button', { name: '소유자 또는 관리자에게 게시 승인을 요청해 주세요' })).toBeDisabled()
  })

  it('shows the complete readiness summary when Naver can publish', () => {
    const naver = {
      ...preview(3), channel: 'naver_blog' as const, visibility: 'public' as const,
      account: { ...preview(3).account, label: 'findk3' },
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    const gate = screen.getByRole('status', { name: '게시 전 확인' })
    expect(gate).toHaveTextContent('게시 준비 완료')
    expect(gate).toHaveTextContent('계정 연결')
    expect(gate).toHaveTextContent('정확한 버전')
    expect(gate).toHaveTextContent('이미지 1장')
    expect(gate).toHaveTextContent('게시 권한')
    expect(screen.getByRole('button', { name: '공개 v3 네이버 원고 승인' })).toBeEnabled()
  })

  it('repairs an oversized Threads result inside the current approval card', async () => {
    const secondMedia = {
      id: '60000000-0000-4000-8000-000000000002',
      position: 2,
      mimeType: 'image/png',
      altText: '두 번째 결과 이미지',
      src: '/media/two',
    }
    const threads = {
      ...preview(3),
      channel: 'threads' as const,
      disclosure: '',
      media: [...preview(3).media, secondMedia],
      issues: [
        { code: 'disclosure', message: '게시 고지를 확인해 주세요.' },
        { code: 'threads_media', message: 'Threads는 현재 이미지 1장까지 게시할 수 있어요.' },
      ],
    }
    const repaired = {
      ...preview(4),
      channel: 'threads' as const,
      media: [secondMedia],
      issues: [],
    }
    mocks.mediaStatus = { total: 2, loaded: 2, failedPositions: [], ready: true }
    mocks.partialRevision.mockResolvedValueOnce({
      data: { preview: repaired, revisionSummary: '2번 이미지를 Threads 대표 이미지로 선택했어요.' },
    })

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: threads, receipt: null }} />)

    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('Threads 이미지 수를 맞춰야 해요')
    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('Threads 이미지가 2장입니다. 대표 이미지 1장을 선택해 주세요.')
    expect(screen.getByRole('button', { name: '이대로 승인' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Threads에 사용할 대표 이미지' }), {
      target: { value: '2' },
    })
    const selectedPreview = screen.getByRole('article', { name: 'threads v3 미리보기' })
    expect(selectedPreview).toHaveTextContent('두 번째 결과 이미지')
    expect(selectedPreview).not.toHaveTextContent('첫 번째 결과 이미지')
    fireEvent.click(screen.getByRole('button', { name: '선택한 이미지 1장으로 새 버전 만들기' }))

    await waitFor(() => expect(mocks.partialRevision).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'media_limit',
      targetPosition: 2,
    })))
    expect(await screen.findByText('v4 부분 수정 완료')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '이대로 승인' })).toBeEnabled()
  })

  it('separates a missing disclosure from channel rules and repairs it in place', async () => {
    const missingDisclosure = {
      ...preview(3),
      disclosure: '',
      issues: [{ code: 'disclosure', message: '게시 고지를 확인해 주세요.' }],
    }
    const repaired = {
      ...preview(4),
      disclosure: 'AI를 활용해 제작한 이미지와 문안입니다.',
      issues: [],
    }
    mocks.partialRevision.mockResolvedValueOnce({
      data: { preview: repaired, revisionSummary: '안전한 게시 고지를 적용했어요.' },
    })

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: missingDisclosure, receipt: null }} />)

    const gate = screen.getByRole('status', { name: '게시 전 확인' })
    expect(gate).toHaveTextContent('게시 고지가 비어 있습니다. 안전한 기본 문구를 적용할 수 있어요.')
    expect(screen.getByTestId('channel-rules-status')).toHaveAttribute('data-complete', 'true')
    expect(screen.getByTestId('disclosure-status')).toHaveAttribute('data-complete', 'false')
    fireEvent.click(screen.getByRole('button', { name: '안전한 게시 고지를 적용하고 새 버전 만들기' }))

    await waitFor(() => expect(mocks.partialRevision).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'disclosure_repair',
    })))
    expect(await screen.findByRole('button', { name: '이대로 승인' })).toBeEnabled()
  })

  it('offers an image creation path when Instagram has no media', () => {
    const missingMedia = {
      ...preview(3),
      media: [],
      issues: [{ code: 'instagram_media', message: 'Instagram은 이미지 1장부터 10장까지 게시할 수 있어요.' }],
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: missingMedia, receipt: null }} />)

    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('Instagram 이미지가 없습니다. 이미지를 1장 이상 추가해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: 'Instagram 이미지 추가하기' }))
    expect(screen.getByText('어떤 이미지가 필요할지 알려주세요')).toBeInTheDocument()
  })

  it('offers channel-fit copy repair for an overlong post', () => {
    const overlong = {
      ...preview(3),
      issues: [{ code: 'instagram_text', message: 'Instagram 문구는 2,200자 이내로 줄여 주세요.' }],
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: overlong, receipt: null }} />)

    expect(screen.getByRole('status', { name: '게시 전 확인' })).toHaveTextContent('본문이 게시 가능한 길이를 넘었습니다. 채널에 맞게 줄여 주세요.')
    expect(screen.getByRole('button', { name: '채널 길이에 맞게 본문 줄이기' })).toBeEnabled()
  })

  it('published state: renders single completion card, no "게시하기" button, no consent text, no "정확한 버전", exactly one post link, plain history wording inside 자세히 details', () => {
    render(<ConversationPublishingWorkflow initialState={{
      role: 'owner',
      preview: { ...preview(3, 'approved'), channel: 'threads' as const },
      receipt: {
        next: 'published',
        scheduleId: '70000000-0000-4000-8000-000000000001',
        attemptId: '80000000-0000-4000-8000-000000000001',
        providerPostId: 'threads-post-1',
        destinationUrl: 'https://www.threads.com/@sohee/post/THREAD1',
        publishAt: '2026-08-14T09:00:00.000Z',
      },
    }} />)

    // 1. Single completion card rendered with channel, account, time, and verified link
    expect(screen.getByText('게시했어요')).toBeInTheDocument()
    expect(screen.getAllByText(/Threads · @studio_byreum/)).toHaveLength(2)
    const verifiedLink = screen.getByRole('link', { name: '게시물 확인하기' })
    expect(verifiedLink).toHaveAttribute('href', 'https://www.threads.com/@sohee/post/THREAD1')

    // 2. Exactly ONE post link (no duplicate '실제 게시물 열기')
    const allLinks = screen.getAllByRole('link')
    const postLinks = allLinks.filter(l => l.getAttribute('href')?.includes('threads.com'))
    expect(postLinks).toHaveLength(1)
    expect(screen.queryByRole('link', { name: '실제 게시물 열기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'SNS 게시 실행 결과' })).not.toBeInTheDocument()

    // 3. NO '게시하기' button
    expect(screen.queryByRole('button', { name: '게시하기' })).not.toBeInTheDocument()

    // 4. NO consent text or toggle
    expect(screen.queryByText(/게시 동의/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /계정에 지금 게시합니다/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '게시 시점' })).not.toBeInTheDocument()

    // 5. NO '정확한 버전' or '정확한 v' text in published state
    expect(screen.queryByText(/정확한 버전/)).not.toBeInTheDocument()
    expect(screen.queryByText(/정확한 v/)).not.toBeInTheDocument()

    // 6. Facts reachable inside collapsed '자세히' disclosure: reworded plainly '실행 기록은 대화에 남아 있어요'
    expect(screen.getByText('실행 기록은 대화에 남아 있어요')).toBeInTheDocument()

    // 7. Success live region announces '게시했어요'
    const statusRegions = screen.getAllByRole('status')
    expect(statusRegions.some(region => region.textContent?.includes('게시했어요'))).toBe(true)
  })

  it('scheduled state: still renders scheduled receipt article', () => {
    render(<ConversationPublishingWorkflow initialState={{
      role: 'owner',
      preview: { ...preview(3, 'approved'), channel: 'threads' as const },
      receipt: {
        next: 'scheduled',
        scheduleId: '70000000-0000-4000-8000-000000000001',
        attemptId: '80000000-0000-4000-8000-000000000001',
        providerPostId: 'threads-post-1',
        destinationUrl: null,
        publishAt: '2026-08-14T09:00:00.000Z',
      },
    }} />)

    expect(screen.getByRole('article', { name: 'SNS 게시 실행 결과' })).toHaveTextContent('v3 예약 게시가 기록됐어요.')
  })

  it('keeps the approval gate instead of replacing it with a heartbeat-based copy shortcut', async () => {
    const oldFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isOnline: false, canAutoPublish: false }) })
    try {
      const naver = { ...preview(3), channel: 'naver_blog' as const, visibility: 'private' as const,
        account: { ...preview(3).account, label: 'findk3' } }
      render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)
      await waitFor(() => expect(screen.getByRole('button', { name: '비공개 v3 네이버 원고 승인' })).toBeEnabled())
      // Allow the old one-shot heartbeat request to finish before checking its side effects.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(screen.queryByRole('button', { name: /복사.*네이버.*열기/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '비공개 v3 네이버 원고 승인' })).toBeEnabled()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(mocks.dispatch).not.toHaveBeenCalled()
    } finally { global.fetch = oldFetch }
  })

  it('renders manual helper notice for approved Naver version without ExactNaverExecutionControl', () => {
    const naver = {
      ...preview(3, 'approved'),
      channel: 'naver_blog' as const,
      visibility: 'private' as const,
      account: { ...preview(3).account, label: 'findk3' },
    }
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    expect(screen.queryByRole('button', { name: '승인한 이 글만 연결기에서 실행' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인한 이 글 게시 요청 만들기' })).not.toBeInTheDocument()
    expect(
      screen.getByText('소희는 네이버 자동 게시를 하지 않아요. 글·사진을 준비해 드리고 직접 올리실 수 있게 도와요'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.'),
    ).toBeInTheDocument()
  })


  it('ANI-1905: restores an older Naver version as a new unreviewed version', async () => {
    const naver = { ...preview(3), channel: 'naver_blog' as const, naverBlocks: [{ kind: 'paragraph' as const, text: '현재 문단' }] }
    mocks.restore.mockResolvedValue({ data: {
      preview: { ...preview(4), channel: 'naver_blog', naverBlocks: [{ kind: 'paragraph', text: '예전 문단' }] },
      summary: 'v1 내용을 새 버전으로 복원했어요.',
    } })
    render(<ConversationPublishingWorkflow initialState={{
      role: 'owner', preview: naver, receipt: null,
      previousVersions: [{ id: '30000000-0000-4000-8000-000000000001', versionNumber: 1, createdAt: '2026-10-28T00:00:00Z', revisionReason: null }],
    }} />)

    fireEvent.click(screen.getByRole('button', { name: 'v1 내용으로 새 버전 만들기' }))

    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith({
      workspaceId: naver.workspaceId, contentId: naver.contentId, versionId: naver.versionId,
      fingerprint: naver.fingerprint, sourceVersionId: '30000000-0000-4000-8000-000000000001',
    }))
    expect(await screen.findByText('v1 내용을 새 버전으로 복원했어요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'v3 내용으로 새 버전 만들기' })).toBeTruthy()
  })

  it('ANI-1905: hides restore for viewers and non-Naver channels', () => {
    const versions = [{ id: '30000000-0000-4000-8000-000000000001', versionNumber: 1, createdAt: '2026-10-28T00:00:00Z', revisionReason: null }]
    const { unmount } = render(<ConversationPublishingWorkflow initialState={{
      role: 'viewer', preview: { ...preview(3), channel: 'naver_blog' as const }, receipt: null, previousVersions: versions,
    }} />)
    expect(screen.queryByRole('button', { name: /새 버전 만들기/ })).toBeNull()
    unmount()
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3), receipt: null, previousVersions: versions }} />)
    expect(screen.queryByRole('button', { name: /새 버전 만들기/ })).toBeNull()
  })

  it('ANI-1905: saves only title and tags as a new Naver version', async () => {
    const naverCopy = { title: '기존 제목', introduction: '도입', sections: [{ heading: 'h', body: 'b' }], keywords: ['기존'], cta: '문의' }
    const naver = { ...preview(3), channel: 'naver_blog' as const, naverCopy }
    mocks.meta.mockResolvedValue({ data: {
      preview: { ...preview(4), channel: 'naver_blog', naverCopy: { ...naverCopy, title: '새 제목', keywords: ['새태그', '둘째'] } },
      summary: '제목과 태그를 새 버전으로 저장했어요.',
    } })
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    fireEvent.click(screen.getByRole('button', { name: '제목·태그 수정' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '새 제목' } })
    fireEvent.change(screen.getByRole('textbox', { name: '태그' }), { target: { value: '새태그, #둘째\n' } })
    fireEvent.click(screen.getByRole('button', { name: '제목·태그를 새 버전으로 저장' }))

    await waitFor(() => expect(mocks.meta).toHaveBeenCalledWith({
      workspaceId: naver.workspaceId, contentId: naver.contentId, versionId: naver.versionId, fingerprint: naver.fingerprint,
      title: '새 제목', keywords: ['새태그', '#둘째'],
    }))
    expect(await screen.findByText('제목과 태그를 새 버전으로 저장했어요.')).toBeTruthy()
  })

  it('ANI-1905: hides the title/tag editor from viewers', () => {
    const naverCopy = { title: '제목', introduction: '도입', sections: [{ heading: 'h', body: 'b' }], keywords: ['태그'], cta: '문의' }
    render(<ConversationPublishingWorkflow initialState={{ role: 'viewer', preview: { ...preview(3), channel: 'naver_blog' as const, naverCopy }, receipt: null }} />)
    expect((screen.getByRole('button', { name: '제목·태그 수정' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ANI-1906: a paragraph picked in the rail opens the direct-edit panel for the same content only', async () => {
    const naver = { ...preview(3), channel: 'naver_blog' as const, naverBlocks: [
      { kind: 'paragraph' as const, text: '첫 문단' }, { kind: 'paragraph' as const, text: '둘째 문단' },
      { kind: 'image' as const, mediaId: '50000000-0000-4000-8000-000000000001', altText: '사진' },
    ] }
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naver, receipt: null }} />)

    dispatchNaverBlockSelect({ contentId: '99999999-0000-4000-8000-000000000009', index: 1 })
    expect(screen.queryByRole('button', { name: '문단을 새 버전으로 저장' })).toBeNull()
    dispatchNaverBlockSelect({ contentId: naver.contentId, index: 2 })
    expect(screen.queryByRole('button', { name: '문단을 새 버전으로 저장' })).toBeNull()

    dispatchNaverBlockSelect({ contentId: naver.contentId, index: 1 })
    expect(await screen.findByRole('button', { name: '문단을 새 버전으로 저장' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: '바꿀 문단 내용' }) as HTMLTextAreaElement).value).toBe('둘째 문단')
  })

  it('disables "이대로 승인" by default when blanks remain, and enables it when "빈칸이 있어도 이대로 승인할게요" is ticked (soft gate)', async () => {
    const withPlaceholders = {
      ...preview(3),
      caption: '봄맞이 이벤트!\n기간: [이벤트 기간]\n참여: [문의 방법 또는 예약 방법]',
      text: '봄맞이 이벤트!\n기간: [이벤트 기간]\n참여: [문의 방법 또는 예약 방법]\n\n#이벤트',
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: withPlaceholders, receipt: null }} />)

    expect(screen.getByText('채워야 할 곳이 2개 있어요')).toBeInTheDocument()
    expect(screen.getByText('[이벤트 기간]')).toBeInTheDocument()
    expect(screen.getByText('[문의 방법 또는 예약 방법]')).toBeInTheDocument()
    expect(screen.getByText('문구 다듬기로 내용을 알려 주시면 채워 드려요.')).toBeInTheDocument()

    const approveButton = screen.getByRole('button', { name: '이대로 승인' })
    expect(approveButton).toBeDisabled()
    expect(screen.getByText('빈칸을 채우거나 아래 확인을 체크하면 승인할 수 있어요.')).toBeInTheDocument()

    // 문구 다듬기 stays enabled
    expect(screen.getByRole('button', { name: '문구 다듬기' })).toBeEnabled()

    // Soft gate checkbox exists and defaults to off
    const checkbox = screen.getByRole('checkbox', { name: '빈칸이 있어도 이대로 승인할게요' })
    expect(checkbox).not.toBeChecked()

    // Clicking approve while unchecked does not dispatch
    fireEvent.click(approveButton)
    expect(mocks.dispatch).not.toHaveBeenCalled()

    // Ticking checkbox enables the approve button
    fireEvent.click(checkbox)
    expect(approveButton).toBeEnabled()

    fireEvent.click(approveButton)
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'approve_only' })))
  })

  it('blocks Naver publish approval until checkbox is ticked', async () => {
    const naverWithPlaceholders = {
      ...preview(3),
      channel: 'naver_blog' as const,
      visibility: 'private' as const,
      account: { ...preview(3).account, label: 'findk3' },
      caption: '네이버 블로그 포스팅\n일시: [행사 일시]\n장소: [모임 장소]',
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: naverWithPlaceholders, receipt: null }} />)

    expect(screen.getByText('채워야 할 곳이 2개 있어요')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '비공개 v3 네이버 원고 승인' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(mocks.dispatch).not.toHaveBeenCalled()

    const checkbox = screen.getByRole('checkbox', { name: '빈칸이 있어도 이대로 승인할게요' })
    fireEvent.click(checkbox)
    expect(button).toBeEnabled()
  })

  it('hides execution choice card if an approved version still has unticked placeholders', () => {
    const approvedWithPlaceholders = {
      ...preview(3, 'approved'),
      caption: '이벤트 [이벤트 기간]',
    }

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: approvedWithPlaceholders, receipt: null }} />)

    expect(screen.queryByRole('section', { name: '승인 후 실행 선택' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '빈칸이 있어도 이대로 승인할게요' })).toBeInTheDocument()
  })

  it('HARD gate: blocks approval completely and does NOT show soft-gate override when info-request caption is returned', async () => {
    const infoRequestPreview = {
      ...preview(3),
      caption:
        '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요.\n\n이벤트명, 진행 기간, 대상, 제공 혜택, 참여 방법을 알려주시면 바이름 청라점의 따뜻하고 세련된 말투에 맞춰 작성해 드려요.',
      text: '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요.\n\n이벤트명, 진행 기간, 대상, 제공 혜택, 참여 방법을 알려주시면 바이름 청라점의 따뜻하고 세련된 말투에 맞춰 작성해 드려요.',
    }

    render(
      <ConversationPublishingWorkflow
        initialState={{ role: 'owner', preview: infoRequestPreview, receipt: null }}
      />,
    )

    // Distinct notice shown
    expect(
      screen.getByText('고객에게 보여줄 글이 아니라 소희의 정보 요청이에요.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('이벤트 정보를 알려주고 다시 만들어 주세요.'),
    ).toBeInTheDocument()

    // "이대로 승인" button must be disabled
    const approveButton = screen.getByRole('button', { name: '이대로 승인' })
    expect(approveButton).toBeDisabled()

    // Soft-gate checkbox ("빈칸이 있어도 이대로 승인할게요") must NOT be rendered (HARD gate)
    expect(
      screen.queryByRole('checkbox', { name: '빈칸이 있어도 이대로 승인할게요' }),
    ).not.toBeInTheDocument()

    // Clicking approve does not dispatch
    fireEvent.click(approveButton)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('D1 & (a) & (b): renders error inside publish card directly above primary button as a live region with retry affordance, without duplicate outside', async () => {
    mocks.dispatch.mockResolvedValueOnce({
      error: { message: '채널 권한이 만료되었습니다. 다시 연결해 주세요.' },
    })
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)

    const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
    const publishButton = screen.getByRole('button', { name: '게시하기' })

    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    expect(publishButton).toBeEnabled()

    fireEvent.click(publishButton)

    await waitFor(() => {
      const alert = publishCard.querySelector('[role="alert"]')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveTextContent('채널 권한이 만료되었습니다. 다시 연결해 주세요.')
    })

    const messages = screen.getAllByText('채널 권한이 만료되었습니다. 다시 연결해 주세요.')
    expect(messages).toHaveLength(1)

    const retryButton = screen.getByRole('button', { name: '다시 시도' })
    expect(retryButton).toBeInTheDocument()

    mocks.dispatch.mockResolvedValueOnce({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: preview(3).versionId,
        next: 'published',
        scheduleId: null,
        attemptId: null,
        providerPostId: 'p-1',
        errorCode: null,
      },
    })
    mocks.load.mockResolvedValueOnce({
      data: {
        role: 'owner',
        preview: preview(3, 'approved'),
        receipt: {
          next: 'published',
          scheduleId: 's-1',
          attemptId: 'a-1',
          providerPostId: 'p-1',
          destinationUrl: 'https://instagram.com/p/TEST',
          publishAt: '2026-11-03T10:00:00Z',
        },
      },
    })

    await waitFor(() => {
      fireEvent.click(retryButton)
      expect(mocks.dispatch).toHaveBeenCalledTimes(2)
    })
  })

  it('D2 & (c) & (e): disables publish button with one-line reason under it reflecting readiness, and pre-tap rejection is visible', async () => {
    const { unmount } = render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)

    const publishButton = screen.getByRole('button', { name: '게시하기' })
    expect(publishButton).toBeDisabled()
    expect(screen.getByText('게시 동의를 체크해 주세요')).toBeInTheDocument()

    unmount()
    const withIssue = {
      ...preview(3, 'approved'),
      issues: [{ code: 'meta_account_locked', message: 'Instagram 계정 승인이 필요해요.' }],
    }
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: withIssue, receipt: null }} />)

    const cardWithIssue = screen.getByRole('region', { name: '승인 후 실행 선택' })
    const buttonWithIssue = screen.getByRole('button', { name: '게시하기' })
    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    expect(buttonWithIssue).toBeDisabled()
    expect(within(cardWithIssue).getByText('Instagram 계정 승인이 필요해요.')).toBeInTheDocument()
  })

  it('D3 & (b): while pending shows "게시하는 중…", aria-busy, and spinner; uncertain outcome shows warning and prevents auto-retry', async () => {
    let resolveDispatch!: (val: unknown) => void
    const pendingPromise = new Promise((resolve) => { resolveDispatch = resolve })
    mocks.dispatch.mockReturnValueOnce(pendingPromise)

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    const publishButton = screen.getByRole('button', { name: '게시하기' })
    fireEvent.click(publishButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /게시하는 중…/ })).toBeDisabled()
      expect(screen.getByRole('button', { name: /게시하는 중…/ })).toHaveAttribute('aria-busy', 'true')
    })

    resolveDispatch({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: preview(3).versionId,
        next: 'unknown',
        scheduleId: null,
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('결과를 확인하고 있어요. 다시 누르지 마세요')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '게시하기' })).toBeDisabled()
    })
  })

  it('D5 & (d): renders offline probe failure inside publish card and scrolls into view', async () => {
    mocks.probe.mockResolvedValue(false)
    const scrollMock = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollMock

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    fireEvent.click(screen.getByRole('button', { name: '게시하기' }))

    const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
    await waitFor(() => {
      const alert = publishCard.querySelector('[role="alert"]')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveTextContent(/오프라인|인터넷 연결/)
    })

    expect(scrollMock).toHaveBeenCalledWith({ block: 'center' })
  })

  it('(b) success shows "게시했어요" and verified link only when verified destinationUrl exists', async () => {
    mocks.dispatch.mockResolvedValueOnce({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: preview(3).versionId,
        next: 'published',
        scheduleId: 's-1',
        attemptId: 'a-1',
        providerPostId: 'p-1',
        errorCode: null,
      },
    })
    mocks.load.mockResolvedValueOnce({
      data: {
        role: 'owner',
        preview: preview(3, 'approved'),
        receipt: {
          next: 'published',
          scheduleId: 's-1',
          attemptId: 'a-1',
          providerPostId: 'p-1',
          destinationUrl: 'https://instagram.com/p/TESTVERIFIED',
          publishAt: '2026-11-03T10:00:00Z',
        },
      },
    })

    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    fireEvent.click(screen.getByRole('button', { name: '게시하기' }))

    await waitFor(() => {
      expect(screen.getByText('게시했어요')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: '게시물 확인하기' })).toHaveAttribute('href', 'https://instagram.com/p/TESTVERIFIED')
      expect(screen.queryByRole('button', { name: '게시하기' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '승인 후 실행 선택' })).not.toBeInTheDocument()
    })
  })

  it('renders PostPublishCarePanel when published for Instagram/Threads, but not for Naver', async () => {
    // 1) Instagram published -> renders PostPublishCarePanel
    const igPublished = {
      role: 'owner' as const,
      preview: preview(3, 'approved'),
      receipt: {
        next: 'published' as const,
        scheduleId: 's-1',
        attemptId: 'a-1',
        providerPostId: 'p-1',
        destinationUrl: 'https://instagram.com/p/TESTVERIFIED',
        publishAt: '2026-11-03T10:00:00Z',
      },
    }
    const { unmount } = render(<ConversationPublishingWorkflow initialState={igPublished} />)

    expect(await screen.findByText('소희가 이어서 할 일')).toBeInTheDocument()
    expect(screen.getByText('댓글 확인 · 답글 초안 준비')).toBeInTheDocument()
    unmount()

    // 2) Naver published -> shows nothing for care panel
    const naverPublished = {
      role: 'owner' as const,
      preview: {
        ...preview(3, 'approved'),
        channel: 'naver_blog' as const,
      },
      receipt: {
        next: 'published' as const,
        scheduleId: 's-2',
        attemptId: 'a-2',
        providerPostId: 'n-1',
        destinationUrl: 'https://blog.naver.com/test',
        publishAt: '2026-11-03T10:00:00Z',
      },
    }
    render(<ConversationPublishingWorkflow initialState={naverPublished} />)
    expect(screen.queryByText('소희가 이어서 할 일')).toBeNull()
  })

  describe('publish feedback live region and DOM order across 5 states', () => {
    beforeEach(() => {
      resetPageActionGuardForTests()
      setOnLine(true)
      mocks.probe.mockResolvedValue(true)
    })

    it.each([
      { state: 'idle' as const },
      { state: 'pending' as const },
      { state: 'error' as const },
      { state: 'uncertain' as const },
    ])('guarantees exactly one live region directly preceding the primary button for state: $state', async ({ state }) => {
      let resolveDispatch!: (val: unknown) => void
      if (state === 'pending') {
        mocks.dispatch.mockReturnValueOnce(new Promise((resolve) => { resolveDispatch = resolve }))
      } else if (state === 'error') {
        mocks.dispatch.mockResolvedValueOnce({
          error: { message: '네트워크 연결을 확인해 주세요.' },
        })
      } else if (state === 'uncertain') {
        mocks.dispatch.mockResolvedValueOnce({
          data: {
            approvalId: '40000000-0000-4000-8000-000000000001',
            versionId: preview(3).versionId,
            next: 'unknown',
            scheduleId: null,
            attemptId: null,
            providerPostId: null,
            errorCode: null,
          },
        })
      }

      render(
        <ConversationPublishingWorkflow
          initialState={{
            role: 'owner',
            preview: preview(3, 'approved'),
            receipt: null,
          }}
        />,
      )

      const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
      const publishButton = within(publishCard).getByRole('button', { name: /게시하기|게시하는 중…/ })

      if (state !== 'idle') {
        fireEvent.click(within(publishCard).getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
        fireEvent.click(publishButton)

        if (state === 'pending') {
          await waitFor(() => {
            expect(within(publishCard).getByRole('button', { name: /게시하는 중…/ })).toBeInTheDocument()
          })
        } else if (state === 'error') {
          await waitFor(() => {
            expect(within(publishCard).getByText('네트워크 연결을 확인해 주세요.')).toBeInTheDocument()
          })
        } else if (state === 'uncertain') {
          await waitFor(() => {
            expect(within(publishCard).getByText('결과를 확인하고 있어요. 다시 누르지 마세요')).toBeInTheDocument()
          })
        }
      }

      // 1. Exactly one live region exists inside publish card (role="status" or role="alert", with aria-live)
      const liveRegions = publishCard.querySelectorAll('[aria-live]')
      expect(liveRegions).toHaveLength(1)
      const feedbackRegion = liveRegions[0] as HTMLElement

      const statusOrAlertRoles = publishCard.querySelectorAll('[role="status"], [role="alert"]')
      expect(statusOrAlertRoles).toHaveLength(1)
      expect(statusOrAlertRoles[0]).toBe(feedbackRegion)

      // 2. Feedback region precedes primary button in document order
      const positionToButton = feedbackRegion.compareDocumentPosition(publishButton)
      expect(Boolean(positionToButton & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

      // 3. Disabled-reason line stays under the button if disabled and reason exists
      const disabledReason = publishCard.querySelector('p[class*="publishDisabledReason"]')
      if (disabledReason) {
        const positionToReason = publishButton.compareDocumentPosition(disabledReason)
        expect(Boolean(positionToReason & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
      }

      // Cleanup pending promise and await write guard release
      if (state === 'pending' && resolveDispatch) {
        resolveDispatch({
          data: {
            approvalId: '40000000-0000-4000-8000-000000000001',
            versionId: preview(3).versionId,
            next: 'published',
            scheduleId: null,
            attemptId: null,
            providerPostId: 'p-1',
            errorCode: null,
          },
        })
        await waitFor(() => {
          expect(within(publishCard).queryByRole('button', { name: /게시하는 중…/ })).not.toBeInTheDocument()
        })
      }
    })

    it('success (published) state: removes publish card and primary button, announces "게시했어요" via live region', async () => {
      mocks.dispatch.mockResolvedValueOnce({
        data: {
          approvalId: '40000000-0000-4000-8000-000000000001',
          versionId: preview(3).versionId,
          next: 'published',
          scheduleId: 's-1',
          attemptId: 'a-1',
          providerPostId: 'p-1',
          errorCode: null,
        },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{
            role: 'owner',
            preview: preview(3, 'approved'),
            receipt: null,
          }}
        />,
      )

      const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
      const publishButton = within(publishCard).getByRole('button', { name: '게시하기' })

      fireEvent.click(within(publishCard).getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: '승인 후 실행 선택' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '게시하기' })).not.toBeInTheDocument()
        const statusRegions = screen.getAllByRole('status')
        expect(statusRegions.some((r) => r.textContent?.includes('게시했어요'))).toBe(true)
      })
    })
  })

  it('shows missing scope message and reconnect button directly above disabled primary button without raw scope names', () => {
    const scopeIssue = {
      code: 'channel_missing_scope',
      message: 'Threads 연결이 만료되었거나 권한이 없어요. 채널을 다시 연결해 주세요.',
      recoveryHref: '/app/channels',
    }
    const threadsPreview = {
      ...preview(3, 'approved'),
      channel: 'threads' as const,
      issues: [scopeIssue],
    }

    render(
      <ConversationPublishingWorkflow
        initialState={{
          role: 'owner',
          preview: threadsPreview,
          receipt: null,
        }}
      />,
    )

    const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
    const publishButton = within(publishCard).getByRole('button', { name: '게시하기' })

    // Primary button is disabled
    expect(publishButton).toBeDisabled()

    // Shows message and reconnect button directly above primary button
    expect(within(publishCard).getByText('Threads 연결이 만료되었거나 권한이 없어요. 채널을 다시 연결해 주세요.')).toBeInTheDocument()
    const reconnectLink = within(publishCard).getByRole('link', { name: '채널 다시 연결' })
    expect(reconnectLink).toHaveAttribute('href', '/app/channels')

    // Document position: reconnectLink precedes publishButton
    const position = reconnectLink.compareDocumentPosition(publishButton)
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

    // Never shows raw scope names
    expect(screen.queryByText(/threads_manage_insights/)).not.toBeInTheDocument()
    expect(screen.queryByText(/threads_basic/)).not.toBeInTheDocument()
  })

  it('shows reconnect button when post-tap error indicates reconnect is needed', async () => {
    mocks.dispatch.mockResolvedValueOnce({
      error: {
        message: '연결 권한이나 상태를 확인해 주세요. 채널을 다시 연결하면 해결될 수 있어요.',
        code: 'PUBLISH_NOT_DUE_OR_NOT_READY',
      },
    })

    render(
      <ConversationPublishingWorkflow
        initialState={{
          role: 'owner',
          preview: preview(3, 'approved'),
          receipt: null,
        }}
      />,
    )

    const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
    const publishButton = within(publishCard).getByRole('button', { name: '게시하기' })
    fireEvent.click(within(publishCard).getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }))
    fireEvent.click(publishButton)

    await waitFor(() => {
      expect(within(publishCard).getByText('연결 권한이나 상태를 확인해 주세요. 채널을 다시 연결하면 해결될 수 있어요.')).toBeInTheDocument()
      const reconnectLink = within(publishCard).getByRole('link', { name: '채널 다시 연결' })
      expect(reconnectLink).toHaveAttribute('href', '/app/channels')
    })
  })

  it('does not throw when preview.issues contains an issue with undefined or null message', () => {
    const withMalformedIssue = {
      ...preview(3),
      issues: [{ code: 'custom_issue' } as any],
    }
    expect(() => {
      render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: withMalformedIssue, receipt: null }} />)
    }).not.toThrow()
  })

  it('does not throw when preview.account is undefined or missing label in approved state', () => {
    const withMalformedAccount = {
      ...preview(3, 'approved'),
      account: undefined as any,
    }
    expect(() => {
      render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: withMalformedAccount, receipt: null }} />)
    }).not.toThrow()
  })

  it('does not throw RangeError when receipt.publishAt is invalid date string', () => {
    expect(() => {
      render(<ConversationPublishingWorkflow initialState={{
        role: 'owner',
        preview: preview(3, 'approved'),
        receipt: {
          next: 'published',
          scheduleId: '50000000-0000-4000-8000-000000000001',
          attemptId: '60000000-0000-4000-8000-000000000001',
          providerPostId: 'p123',
          destinationUrl: 'https://instagram.com/p/123',
          publishAt: 'not-a-valid-date-string',
        },
      }} />)
    }).not.toThrow()
  })

  it('does not crash if statusRegionRef scrollIntoView throws an exception', async () => {
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    const scrollSpy = vi.fn().mockImplementation(() => {
      throw new Error('scrollIntoView error in mobile webview')
    })
    window.HTMLElement.prototype.scrollIntoView = scrollSpy

    try {
      mocks.dispatch.mockResolvedValueOnce({
        error: {
          message: '네트워크 연결을 확인해 주세요.',
        },
      })

      render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3, 'approved'), receipt: null }} />)
      const publishCard = screen.getByRole('region', { name: '승인 후 실행 선택' })
      const publishButton = within(publishCard).getByRole('button', { name: '게시하기' })
      fireEvent.click(within(publishCard).getByRole('checkbox', { name: /계정에 지금 게시합니다/ }))
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(within(publishCard).getByText('네트워크 연결을 확인해 주세요.')).toBeInTheDocument()
      })
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('handles server action rejection gracefully in approve() without crashing', async () => {
    mocks.dispatch.mockRejectedValueOnce(new Error('Network request failed'))
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3), receipt: null }} />)
    const approveButton = screen.getByRole('button', { name: '이대로 승인' })
    fireEvent.click(approveButton)

    await waitFor(() => {
      expect(screen.getByText('승인 요청을 완료하지 못했어요. 다시 시도해 주세요.')).toBeInTheDocument()
    })
  })

  it('handles refreshPublishingState rejection gracefully in approve() without crashing', async () => {
    mocks.dispatch.mockResolvedValueOnce({
      data: {
        approvalId: '40000000-0000-4000-8000-000000000001',
        versionId: preview(3).versionId,
        next: 'approved',
        scheduleId: null,
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })
    mocks.load.mockRejectedValueOnce(new Error('Network error on refresh'))
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: preview(3), receipt: null }} />)
    const approveButton = screen.getByRole('button', { name: '이대로 승인' })
    fireEvent.click(approveButton)

    await waitFor(() => {
      expect(screen.getByText('최신 상태를 불러오지 못했어요. 다시 시도해 주세요.')).toBeInTheDocument()
    })
  })

  it('replaces image with composed overlay image using OverlayComposer and passes existingAssetId', async () => {
    const customPreview = {
      ...preview(3),
      media: [
        {
          id: '60000000-0000-4000-8000-000000000001',
          position: 1,
          mimeType: 'image/png',
          altText: '첫 번째 이미지',
          src: '/media/one.png',
        },
        {
          id: '60000000-0000-4000-8000-000000000002',
          position: 2,
          mimeType: 'image/png',
          altText: '두 번째 이미지',
          src: '/media/two.png',
        },
      ],
    }
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: customPreview, receipt: null }} />)

    fireEvent.click(screen.getByRole('button', { name: '이미지 바꾸기' }))

    // (b) 2번 이미지 선택 시 baseUrl이 2번 이미지의 src인지 검증
    fireEvent.change(screen.getByRole('combobox', { name: '교체할 이미지' }), { target: { value: '2' } })

    const composer = screen.getByTestId('overlay-composer')
    expect(composer).toHaveAttribute('data-workspace-id', customPreview.workspaceId)
    expect(composer).toHaveAttribute('data-base-url', '/media/two.png')

    // (a) details 열고 스텁 저장 → partialRevision 이 existingAssetId 와 scope 'image_replace', targetPosition 값으로 호출되는지
    expect(screen.getByText('문구·삽입컷 얹기 (전 사진 컷, 제목 문구)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '스텁 저장' }))

    await waitFor(() => expect(mocks.partialRevision).toHaveBeenCalledWith({
      workspaceId: customPreview.workspaceId,
      contentId: customPreview.contentId,
      versionId: customPreview.versionId,
      fingerprint: customPreview.fingerprint,
      scope: 'image_replace',
      instruction: '문구·삽입컷을 얹은 이미지로 교체',
      targetPosition: 2,
      orderedMediaIds: null,
      existingAssetId: '50000000-0000-4000-8000-000000000009',
    }))
  })

  it('adds image with composed overlay image using OverlayComposer and null baseUrl', async () => {
    const customPreview = preview(3)
    render(<ConversationPublishingWorkflow initialState={{ role: 'owner', preview: customPreview, receipt: null }} />)

    fireEvent.click(screen.getByRole('button', { name: '이미지 추가 생성' }))

    const composer = screen.getByTestId('overlay-composer')
    expect(composer).toHaveAttribute('data-workspace-id', customPreview.workspaceId)
    expect(composer).toHaveAttribute('data-base-url', '')

    expect(screen.getByText('문구·삽입컷 얹기 (전 사진 컷, 제목 문구)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '스텁 저장' }))

    await waitFor(() => expect(mocks.partialRevision).toHaveBeenCalledWith({
      workspaceId: customPreview.workspaceId,
      contentId: customPreview.contentId,
      versionId: customPreview.versionId,
      fingerprint: customPreview.fingerprint,
      scope: 'image_add',
      instruction: '문구·삽입컷을 얹은 이미지 추가',
      targetPosition: null,
      orderedMediaIds: null,
      existingAssetId: '50000000-0000-4000-8000-000000000009',
    }))
  })

  describe('현재 등록된 스타일 칩 영역', () => {
    it('(a) 등록된 경우 현재 등록 설정 칩 문구와 안내를 올바르게 표시한다', async () => {
      mocks.loadStyleSummary.mockResolvedValueOnce({
        data: {
          image: {
            configured: true,
            headline: '자연스러운 톤',
            referenceCount: 3,
            references: [],
            hasGuide: true,
            custom: true,
          },
          text: {
            configured: true,
            voiceSummary: '친근하고 정중하며 신뢰감을 주는 솔직한 문체로 이야기합니다.',
          },
        },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: preview(3), receipt: null }}
        />,
      )

      await waitFor(() => {
        expect(mocks.loadStyleSummary).toHaveBeenCalledWith({
          workspaceId: preview(3).workspaceId,
        })
      })

      const chipsList = await screen.findByRole('list', { name: '현재 등록된 스타일' })
      expect(chipsList).toBeInTheDocument()

      const imageChip = within(chipsList).getByRole('link', {
        name: '이미지 스타일 · 자연스러운 톤 · 기준 사진 3장',
      })
      expect(imageChip).toHaveAttribute('href', '/app/settings/image-style')

      const textChip = within(chipsList).getByRole('link', {
        name: '글 방식 · 친근하고 정중하며 신뢰감을 주는 솔직한 문체…',
      })
      expect(textChip).toHaveAttribute('href', '/app/settings/brand')

      expect(screen.getByText('다음 제작·수정부터 사용해요')).toBeInTheDocument()
    })

    it('(b) 미등록이면 "만들기" 문구와 href를 /app/settings/image-style 로 제공한다', async () => {
      mocks.loadStyleSummary.mockResolvedValueOnce({
        data: {
          image: {
            configured: false,
            headline: '',
            referenceCount: 0,
            references: [],
            hasGuide: false,
            custom: false,
          },
          text: {
            configured: false,
            voiceSummary: '',
          },
        },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: preview(3), receipt: null }}
        />,
      )

      const chipsList = await screen.findByRole('list', { name: '현재 등록된 스타일' })
      expect(chipsList).toBeInTheDocument()

      const imageChip = within(chipsList).getByRole('link', {
        name: '이미지 스타일 없음 · 만들기',
      })
      expect(imageChip).toHaveAttribute('href', '/app/settings/image-style')

      const textChip = within(chipsList).getByRole('link', {
        name: '글 방식 없음 · 만들기',
      })
      expect(textChip).toHaveAttribute('href', '/app/settings/image-style')

      expect(screen.getByText('다음 제작·수정부터 사용해요')).toBeInTheDocument()
    })

    it('(c) 실패하면 칩 영역이 없고 기존 렌더를 유지한다', async () => {
      mocks.loadStyleSummary.mockResolvedValueOnce({
        error: { message: '권한이 없습니다.' },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: preview(3), receipt: null }}
        />,
      )

      await waitFor(() => {
        expect(mocks.loadStyleSummary).toHaveBeenCalled()
      })

      expect(screen.queryByRole('list', { name: '현재 등록된 스타일' })).not.toBeInTheDocument()
      expect(screen.queryByText('다음 제작·수정부터 사용해요')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Instagram/)
    })

    it('(d) 네이버 채널에서는 이미지 칩이 없고 글 방식 칩만 렌더된다', async () => {
      mocks.loadStyleSummary.mockResolvedValueOnce({
        data: {
          image: {
            configured: true,
            headline: '모던한 스튜디오 분위기',
            referenceCount: 2,
            references: [],
            hasGuide: true,
            custom: true,
          },
          text: {
            configured: true,
            voiceSummary: '차분하고 정돈된 설명',
          },
        },
      })

      const naverPreview = {
        ...preview(3),
        channel: 'naver_blog' as const,
      }

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: naverPreview, receipt: null }}
        />,
      )

      const chipsList = await screen.findByRole('list', { name: '현재 등록된 스타일' })
      expect(chipsList).toBeInTheDocument()

      expect(within(chipsList).queryByRole('link', { name: /이미지 스타일/ })).not.toBeInTheDocument()

      const textChip = within(chipsList).getByRole('link', {
        name: '글 방식 · 차분하고 정돈된 설명',
      })
      expect(textChip).toHaveAttribute('href', '/app/settings/brand')
      expect(screen.getByText('다음 제작·수정부터 사용해요')).toBeInTheDocument()
    })

    it('(e) 이미 승인된 버전(v3 승인됨)에서 합성 오버레이 이미지를 교체하면 새 버전(v4)이 생성되어 다시 "승인 대기" 상태로 전환된다', async () => {
      const approvedPreview = {
        ...preview(3, 'approved'),
        media: [
          {
            id: '60000000-0000-4000-8000-000000000001',
            position: 1,
            mimeType: 'image/png',
            altText: '기존 승인 이미지',
            src: '/media/existing.png',
          },
        ],
      }

      const v4UnreviewedPreview = {
        ...preview(4, 'unreviewed'),
        media: [
          {
            id: '60000000-0000-4000-8000-000000000002',
            position: 1,
            mimeType: 'image/png',
            altText: '합성 오버레이 교체 이미지',
            src: '/media/overlay-replaced.png',
          },
        ],
      }

      mocks.partialRevision.mockResolvedValueOnce({
        data: {
          preview: v4UnreviewedPreview,
          revisionSummary: '문구·삽입컷을 얹은 이미지로 교체했어요.',
        },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: approvedPreview, receipt: null }}
        />,
      )

      // 기존에는 승인됨 배지가 표시됨
      expect(screen.getByText('v3 승인됨')).toBeInTheDocument()

      // 이미지 교체 패널 열기
      fireEvent.click(screen.getByRole('button', { name: '이미지 바꾸기' }))

      // 스텁 저장 클릭하여 합성 이미지로 교체 실행
      fireEvent.click(screen.getByRole('button', { name: '스텁 저장' }))

      await waitFor(() => {
        expect(mocks.partialRevision).toHaveBeenCalledWith(
          expect.objectContaining({
            scope: 'image_replace',
            existingAssetId: '50000000-0000-4000-8000-000000000009',
          }),
        )
      })

      // 새 버전 v4 승인 대기 상태로 전환 확인
      expect(await screen.findByText('v4 승인 대기')).toBeInTheDocument()
      expect(screen.queryByText('v3 승인됨')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '이대로 승인' })).toBeEnabled()
      })
    })
  })

  describe('체크리스트 80번 항목 전수 검증', () => {
    it('80-1: 등록 사업자(스타일 있음) vs 미등록 사업자(스타일 없음) 상태에 따른 칩 렌더링 검증', async () => {
      // 1. 등록 사업자 (스타일 있음: 기준 사진 8장, 글 방식 등록)
      mocks.loadStyleSummary.mockResolvedValueOnce({
        data: {
          image: {
            configured: true,
            headline: '시그니처 내추럴',
            referenceCount: 8,
            references: [],
            hasGuide: true,
            custom: true,
          },
          text: {
            configured: true,
            voiceSummary: '전문적이고 차분한 톤으로 솔직하게 전달합니다.',
          },
        },
      })

      const { unmount } = render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: preview(3), receipt: null }}
        />,
      )

      await waitFor(() => {
        expect(mocks.loadStyleSummary).toHaveBeenCalledWith({
          workspaceId: preview(3).workspaceId,
        })
      })

      const registeredChips = await screen.findByRole('list', { name: '현재 등록된 스타일' })
      expect(registeredChips).toBeInTheDocument()

      const registeredImageChip = within(registeredChips).getByRole('link', {
        name: '이미지 스타일 · 시그니처 내추럴 · 기준 사진 8장',
      })
      expect(registeredImageChip).toHaveAttribute('href', '/app/settings/image-style')

      const registeredTextChip = within(registeredChips).getByRole('link', {
        name: '글 방식 · 전문적이고 차분한 톤으로 솔직하게 전달합니다…',
      })
      expect(registeredTextChip).toHaveAttribute('href', '/app/settings/brand')
      expect(screen.getByText('다음 제작·수정부터 사용해요')).toBeInTheDocument()

      unmount()

      // 2. 미등록 사업자 (스타일 없음)
      mocks.loadStyleSummary.mockResolvedValueOnce({
        data: {
          image: {
            configured: false,
            headline: '',
            referenceCount: 0,
            references: [],
            hasGuide: false,
            custom: false,
          },
          text: {
            configured: false,
            voiceSummary: '',
          },
        },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: preview(3), receipt: null }}
        />,
      )

      const unregisteredChips = await screen.findByRole('list', { name: '현재 등록된 스타일' })
      expect(unregisteredChips).toBeInTheDocument()

      const unregisteredImageChip = within(unregisteredChips).getByRole('link', {
        name: '이미지 스타일 없음 · 만들기',
      })
      expect(unregisteredImageChip).toHaveAttribute('href', '/app/settings/image-style')

      const unregisteredTextChip = within(unregisteredChips).getByRole('link', {
        name: '글 방식 없음 · 만들기',
      })
      expect(unregisteredTextChip).toHaveAttribute('href', '/app/settings/image-style')
      expect(screen.getByText('다음 제작·수정부터 사용해요')).toBeInTheDocument()
    })

    it('80-2: 기준 사진 선택 -> 생성 -> 수정 -> 합성 이미지 교체(existingAssetId) -> 새 버전 생성 시 기존 승인 해제 및 vX 승인 대기 재승인 필요 상태로의 정확한 상태 전이 확인', async () => {
      // 등록 사업자 (기준 사진 8장 등록된 상태)
      mocks.loadStyleSummary.mockResolvedValueOnce({
        data: {
          image: {
            configured: true,
            headline: '따뜻한 감성',
            referenceCount: 8,
            references: [],
            hasGuide: true,
            custom: true,
          },
          text: {
            configured: true,
            voiceSummary: '차분하고 친절한 어조',
          },
        },
      })

      const approvedV3 = {
        ...preview(3, 'approved'),
        media: [
          {
            id: '60000000-0000-4000-8000-000000000001',
            position: 1,
            mimeType: 'image/png',
            altText: '1번 베이스 사진',
            src: '/media/photo-1.png',
          },
          {
            id: '60000000-0000-4000-8000-000000000002',
            position: 2,
            mimeType: 'image/png',
            altText: '2번 교체 대상 사진',
            src: '/media/photo-2.png',
          },
        ],
      }

      const unapprovedV4 = {
        ...preview(4, 'unreviewed'),
        media: [
          approvedV3.media[0]!,
          {
            id: '60000000-0000-4000-8000-000000000003',
            position: 2,
            mimeType: 'image/png',
            altText: '합성 오버레이 교체 사진',
            src: '/media/overlay-replaced-80.png',
          },
        ],
      }

      mocks.partialRevision.mockResolvedValueOnce({
        data: {
          preview: unapprovedV4,
          revisionSummary: '문구·삽입컷을 얹은 이미지로 교체했어요.',
        },
      })

      render(
        <ConversationPublishingWorkflow
          initialState={{ role: 'owner', preview: approvedV3, receipt: null }}
        />,
      )

      // 1. 등록 스타일 칩 렌더링 확인 (기준 사진 8장)
      const styleChip = await screen.findByRole('link', {
        name: '이미지 스타일 · 따뜻한 감성 · 기준 사진 8장',
      })
      expect(styleChip).toBeInTheDocument()

      // 2. 초기 상태 검증: v3 승인됨 및 승인 후 실행 섹션 노출 확인
      expect(screen.getByText('v3 승인됨')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: '승인 후 실행 선택' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '이대로 승인' })).not.toBeInTheDocument()

      // 3. 수정 흐름: 빠른 작업에서 '이미지 바꾸기' 패널 열기
      fireEvent.click(screen.getByRole('button', { name: '이미지 바꾸기' }))

      // 4. 교체할 이미지로 2번 사진 선택
      const positionSelect = screen.getByRole('combobox', { name: '교체할 이미지' })
      fireEvent.change(positionSelect, { target: { value: '2' } })

      // 5. OverlayComposer에 선택된 2번 사진의 baseUrl 전달 확인
      const composer = screen.getByTestId('overlay-composer')
      expect(composer).toHaveAttribute('data-base-url', '/media/photo-2.png')

      // 6. 합성 오버레이 저장 (existingAssetId 교체) 실행
      fireEvent.click(screen.getByRole('button', { name: '스텁 저장' }))

      // 7. partialContentRevisionAction 호출 파라미터 전수 확인
      await waitFor(() => {
        expect(mocks.partialRevision).toHaveBeenCalledWith({
          workspaceId: approvedV3.workspaceId,
          contentId: approvedV3.contentId,
          versionId: approvedV3.versionId,
          fingerprint: approvedV3.fingerprint,
          scope: 'image_replace',
          instruction: '문구·삽입컷을 얹은 이미지로 교체',
          targetPosition: 2,
          orderedMediaIds: null,
          existingAssetId: '50000000-0000-4000-8000-000000000009',
        })
      })

      // 8. 상태 전이 확인:
      // (a) 기존 v3 승인 해제 -> 'v4 승인 대기' 배지로 변경
      expect(await screen.findByText('v4 승인 대기')).toBeInTheDocument()
      expect(screen.queryByText('v3 승인됨')).not.toBeInTheDocument()

      // (b) 승인 후 실행 선택(게시하기 섹션) 제거됨
      expect(screen.queryByRole('region', { name: '승인 후 실행 선택' })).not.toBeInTheDocument()

      // (c) '이대로 승인' 버튼이 다시 활성화되어 재승인 필수 상태로 복귀
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '이대로 승인' })).toBeEnabled()
      })

      // (d) 안전·게시 정보 및 부분 수정 완료 안내 텍스트 확인
      expect(screen.getByRole('group', { name: '안전·게시 정보' })).toHaveTextContent('v4')
      expect(screen.getByText('부분 수정은 새 버전으로 남고 기존 승인은 이어지지 않아요.')).toBeInTheDocument()
      expect(screen.getByText('v4 부분 수정 완료')).toBeInTheDocument()

      // (e) 재승인 실행 검증: '이대로 승인' 버튼 클릭 시 새 버전 v4로 approve_only 디스패치
      mocks.dispatch.mockResolvedValueOnce({
        data: {
          approvalId: '40000000-0000-4000-8000-000000000002',
          versionId: unapprovedV4.versionId,
          next: 'approved',
          scheduleId: null,
          attemptId: null,
          providerPostId: null,
          errorCode: null,
        },
      })
      mocks.load.mockResolvedValueOnce({
        data: {
          role: 'owner',
          preview: { ...unapprovedV4, approval: { id: 'app-4', status: 'approved', fingerprint: unapprovedV4.fingerprint } },
          receipt: null,
        },
      })

      fireEvent.click(screen.getByRole('button', { name: '이대로 승인' }))

      await waitFor(() => {
        expect(mocks.dispatch).toHaveBeenCalledWith({
          workspaceId: unapprovedV4.workspaceId,
          contentId: unapprovedV4.contentId,
          versionId: unapprovedV4.versionId,
          fingerprint: unapprovedV4.fingerprint,
          mode: 'approve_only',
          channelConnectionId: null,
          scheduledLocal: null,
          timezone: null,
        })
      })
    })
  })
})


