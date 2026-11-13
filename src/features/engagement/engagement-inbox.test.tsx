import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/publish-readiness/readiness-card', () => ({
  ReadinessCard: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="publish-readiness-card" data-workspace-id={workspaceId} />
  ),
}))

import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import { EngagementInbox } from './engagement-inbox'
import type { EngagementCommentItem, EngagementCommentsResponse } from './types'

// 가드의 실제 연결 확인(probe)은 통과로 고정하고, 오프라인은 navigator 힌트로 만든다.
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

/** 앱을 나갔다 돌아오는 상황을 만든다(ANI-1725). */
function setDocumentVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/engagement',
  useSearchParams: () => mockSearchParams,
}))

const sampleComments: EngagementCommentItem[] = [
  {
    id: 'c-1',
    workspace_id: 'ws-1',
    channel_connection_id: 'conn-1',
    channel: 'instagram',
    channel_label: '인스타그램',
    account_label: '@sohee_cafe',
    provider_comment_id: 'p-1',
    provider_media_id: 'm-1',
    author_handle: 'happy_user',
    author_id: 'u-1',
    comment_text: '정말 친절하고 좋아요!',
    comment_created_at: '2026-10-08T10:00:00.000Z',
    classification: 'THANKS',
    classification_label: '감사',
    confidence: 0.95,
    status: 'DRAFTED',
    status_label: '초안 준비됨',
    failure_reason: null,
    created_at: '2026-10-08T10:00:00.000Z',
    updated_at: '2026-10-08T10:00:00.000Z',
    draft: {
      id: 'd-1',
      workspace_id: 'ws-1',
      comment_id: 'c-1',
      draft_text: '좋은 말씀 감사드려요! 늘 최선을 다하겠습니다.',
      approved_fingerprint: null,
      approved_by: null,
      approved_at: null,
      is_auto_approved: false,
      created_at: '2026-10-08T10:05:00.000Z',
      updated_at: '2026-10-08T10:05:00.000Z',
    },
  },
  {
    id: 'c-2',
    workspace_id: 'ws-1',
    channel_connection_id: 'conn-2',
    channel: 'threads',
    channel_label: '스레드',
    provider_comment_id: 'p-2',
    provider_media_id: 'm-2',
    author_handle: 'inquiry_user',
    author_id: 'u-2',
    comment_text: '안녕하세요 위치가 어디인가요?',
    comment_created_at: '2026-10-08T09:00:00.000Z',
    classification: 'QUESTION',
    classification_label: '질문',
    confidence: 0.9,
    status: 'APPROVED',
    status_label: '승인됨',
    failure_reason: null,
    created_at: '2026-10-08T09:00:00.000Z',
    updated_at: '2026-10-08T09:00:00.000Z',
    draft: {
      id: 'd-2',
      workspace_id: 'ws-1',
      comment_id: 'c-2',
      draft_text: '강남역 2번 출구 바로 앞에 있습니다.',
      approved_fingerprint: 'fp-2',
      approved_by: 'user-1',
      approved_at: '2026-10-08T09:05:00.000Z',
      is_auto_approved: false,
      created_at: '2026-10-08T09:05:00.000Z',
      updated_at: '2026-10-08T09:05:00.000Z',
    },
  },
  {
    id: 'c-3',
    workspace_id: 'ws-1',
    channel_connection_id: 'conn-1',
    channel: 'instagram',
    channel_label: '인스타그램',
    provider_comment_id: 'p-3',
    provider_media_id: 'm-3',
    author_handle: 'problem_user',
    author_id: 'u-3',
    comment_text: '답글이 왜 안 달리나요?',
    comment_created_at: '2026-10-08T08:00:00.000Z',
    classification: 'COMPLAINT',
    classification_label: '불만',
    confidence: 0.85,
    status: 'NEEDS_CHECK',
    status_label: '확인 필요',
    failure_reason: 'Provider timeout',
    created_at: '2026-10-08T08:00:00.000Z',
    updated_at: '2026-10-08T08:00:00.000Z',
    draft: {
      id: 'd-3',
      workspace_id: 'ws-1',
      comment_id: 'c-3',
      draft_text: '불편을 드려 죄송합니다. 확인해 드릴게요.',
      approved_fingerprint: null,
      approved_by: null,
      approved_at: null,
      is_auto_approved: false,
      created_at: '2026-10-08T08:05:00.000Z',
      updated_at: '2026-10-08T08:05:00.000Z',
    },
  },
  {
    id: 'c-4',
    workspace_id: 'ws-1',
    channel_connection_id: 'conn-1',
    channel: 'instagram',
    channel_label: '인스타그램',
    provider_comment_id: 'p-4',
    provider_media_id: 'm-4',
    author_handle: 'fan_user',
    author_id: 'u-4',
    comment_text: '최고예요 최고',
    comment_created_at: '2026-10-08T07:00:00.000Z',
    classification: 'THANKS',
    classification_label: '감사',
    confidence: 0.99,
    status: 'SENT',
    status_label: '답글 완료',
    failure_reason: null,
    created_at: '2026-10-08T07:00:00.000Z',
    updated_at: '2026-10-08T07:00:00.000Z',
    draft: {
      id: 'd-4',
      workspace_id: 'ws-1',
      comment_id: 'c-4',
      draft_text: '응원 감사합니다!',
      approved_fingerprint: 'fp-4',
      approved_by: 'user-1',
      approved_at: '2026-10-08T07:05:00.000Z',
      is_auto_approved: true,
      created_at: '2026-10-08T07:05:00.000Z',
      updated_at: '2026-10-08T07:05:00.000Z',
    },
  },
  {
    id: 'c-5',
    workspace_id: 'ws-1',
    channel_connection_id: 'conn-2',
    channel: 'threads',
    channel_label: '스레드',
    provider_comment_id: 'p-5',
    provider_media_id: 'm-5',
    author_handle: 'spam_user',
    author_id: 'u-5',
    comment_text: '광고 링크 클릭하세요',
    comment_created_at: '2026-10-08T06:00:00.000Z',
    classification: 'SPAM',
    classification_label: '스팸',
    confidence: 0.99,
    status: 'DISMISSED',
    status_label: '무시함',
    failure_reason: null,
    created_at: '2026-10-08T06:00:00.000Z',
    updated_at: '2026-10-08T06:00:00.000Z',
    draft: null,
  },
]

function makeMockResponse(overrides: Partial<EngagementCommentsResponse> = {}): EngagementCommentsResponse {
  return {
    items: sampleComments,
    send_enabled: true,
    cycle_enabled: true,
    ...overrides,
  }
}

describe('EngagementInbox Component', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    vi.restoreAllMocks()
    setOnLine(true)
    window.localStorage.clear()
    window.sessionStorage.clear()
    resetPageActionGuardForTests()
  })

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  describe('Banner states', () => {
    it('shows !cycle_enabled banner in neutral tone', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse({ cycle_enabled: false, send_enabled: false })}
          workspaceId="ws-1"
        />
      )
      const banner = screen.getByRole('status')
      expect(banner).toBeInTheDocument()
      expect(banner).toHaveTextContent('댓글 가져오기가 아직 꺼져 있어요')
    })

    it('shows cycle_enabled && !send_enabled banner', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse({ cycle_enabled: true, send_enabled: false })}
          workspaceId="ws-1"
        />
      )
      const banner = screen.getByRole('status')
      expect(banner).toBeInTheDocument()
      expect(banner).toHaveTextContent('답글 보내기가 아직 꺼져 있어요. 초안은 미리 확인할 수 있어요.')
    })

    it('shows no banner when both are enabled', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse({ cycle_enabled: true, send_enabled: true })}
          workspaceId="ws-1"
        />
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('Tab filtering & URL query persistence', () => {
    it('renders tabs with role=tablist, counts as text, and filters correctly', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      const tablist = screen.getByRole('tablist', { name: '댓글 필터' })
      expect(tablist).toBeInTheDocument()

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(4)

      // Check counts as text
      expect(screen.getByRole('tab', { name: /답글 필요 2/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /확인 필요 1/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /완료 1/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /무시함 1/ })).toBeInTheDocument()

      // Default active tab is 답글 필요 (shows c-1, c-2)
      expect(screen.getByText('@happy_user')).toBeInTheDocument()
      expect(screen.getByText('@inquiry_user')).toBeInTheDocument()
      expect(screen.queryByText('@problem_user')).not.toBeInTheDocument()
      expect(screen.queryByText('@fan_user')).not.toBeInTheDocument()
      expect(screen.queryByText('@spam_user')).not.toBeInTheDocument()

      // Switch to 확인 필요
      fireEvent.click(screen.getByRole('tab', { name: /확인 필요/ }))
      expect(screen.getByText('@problem_user')).toBeInTheDocument()
      expect(screen.queryByText('@happy_user')).not.toBeInTheDocument()

      // Switch to 완료
      fireEvent.click(screen.getByRole('tab', { name: /완료/ }))
      expect(screen.getByText('@fan_user')).toBeInTheDocument()
      expect(screen.queryByText('@problem_user')).not.toBeInTheDocument()

      // Switch to 무시함
      fireEvent.click(screen.getByRole('tab', { name: /무시함/ }))
      expect(screen.getByText('@spam_user')).toBeInTheDocument()
      expect(screen.queryByText('@fan_user')).not.toBeInTheDocument()
    })

    it('renders segmented control for comments and messages, switching views when clicked', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      expect(screen.getByRole('button', { name: '댓글' })).toBeInTheDocument()
      const msgBtn = screen.getByRole('button', { name: '메시지' })
      expect(msgBtn).toBeInTheDocument()
      expect(msgBtn).not.toBeDisabled()

      fireEvent.click(msgBtn)
      expect(msgBtn).toHaveAttribute('aria-pressed', 'true')
    })

    it('supports arrow-key keyboard navigation between tabs', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      const firstTab = screen.getByRole('tab', { name: /답글 필요/ })
      firstTab.focus()

      // Right arrow moves to 확인 필요
      fireEvent.keyDown(firstTab, { key: 'ArrowRight' })
      const secondTab = screen.getByRole('tab', { name: /확인 필요/ })
      expect(secondTab).toHaveAttribute('aria-selected', 'true')

      // Right arrow moves to 완료
      fireEvent.keyDown(secondTab, { key: 'ArrowRight' })
      const thirdTab = screen.getByRole('tab', { name: /완료/ })
      expect(thirdTab).toHaveAttribute('aria-selected', 'true')

      // Left arrow moves back to 확인 필요
      fireEvent.keyDown(thirdTab, { key: 'ArrowLeft' })
      expect(secondTab).toHaveAttribute('aria-selected', 'true')
    })

    it('respects tab in URL searchParams on initial load', () => {
      mockSearchParams = new URLSearchParams('tab=needs_check')
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      const secondTab = screen.getByRole('tab', { name: /확인 필요/ })
      expect(secondTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('@problem_user')).toBeInTheDocument()
    })
  })

  describe('Disabled send reason text & Approval edit notice', () => {
    it('disables primary send button with reason text when send_enabled is false', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse({ send_enabled: false })}
          workspaceId="ws-1"
        />
      )

      // MasterDetail empty state initially
      expect(screen.getByText('왼쪽에서 하나를 골라 보세요.')).toBeInTheDocument()

      // Select first comment to show detail
      fireEvent.click(screen.getByRole('button', { name: /happy_user/ }))

      const sendButtons = screen.getAllByRole('button', { name: /이 답글 보내기/ })
      for (const btn of sendButtons) {
        expect(btn).toBeDisabled()
      }
      expect(screen.getAllByText('답글 보내기가 아직 꺼져 있어요').length).toBeGreaterThan(0)
    })

    it('shows notice when editing draft after approval', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      // c-2 is APPROVED, select it
      fireEvent.click(screen.getByRole('button', { name: /inquiry_user/ }))

      const textarea = screen.getByDisplayValue('강남역 2번 출구 바로 앞에 있습니다.')
      fireEvent.change(textarea, { target: { value: '강남역 3번 출구 앞입니다.' } })

      expect(screen.getByText('내용을 고쳤어요. 보내기 전에 다시 확인해 주세요.')).toBeInTheDocument()
    })
  })

  describe('Confirmation dialog flow & double-click protection', () => {
    it('opens confirmation dialog, shows exact quote and channel warning, calls send once', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/send')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, status: 'SENT' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, draft: { fingerprint: 'reviewed-fingerprint' } }),
        })
      })
      globalThis.fetch = fetchSpy as any

      render(
        <EngagementInbox
          initialData={makeMockResponse({ send_enabled: true })}
          workspaceId="ws-1"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /happy_user/ }))
      const sendBtn = screen.getAllByRole('button', { name: /이 답글 보내기/ })[0]
      fireEvent.click(sendBtn)

      const dialog = screen.getByRole('dialog', { name: '이 답글을 보낼까요?' })
      expect(dialog).toBeInTheDocument()

      // Quote block contains exact draft
      expect(dialog).toHaveTextContent('좋은 말씀 감사드려요! 늘 최선을 다하겠습니다.')
      // Channel warning line with account label
      expect(dialog).toHaveTextContent('인스타그램 · @sohee_cafe 계정에 실제로 게시돼요. 보낸 뒤에는 소희에서 되돌릴 수 없어요.')

      // Confirm send
      const confirmBtn = screen.getByRole('button', { name: '보내기' })
      fireEvent.click(confirmBtn)
      // Rapid second click (should be guarded)
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Send endpoint was called exactly once
      const sendCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes('/send'))
      expect(sendCalls).toHaveLength(1)

      // Aria-live result shown
      expect(screen.getByText('답글을 올렸어요')).toBeInTheDocument()
    })

    it('오프라인이면 저장·전송 API 를 부르지 않고 이유를 보여 준다', async () => {
      setOnLine(false)
      const fetchSpy = vi.fn()
      globalThis.fetch = fetchSpy as any

      render(
        <EngagementInbox
          initialData={makeMockResponse({ send_enabled: true })}
          workspaceId="ws-1"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /happy_user/ }))
      fireEvent.click(screen.getAllByRole('button', { name: /이 답글 보내기/ })[0])
      fireEvent.click(screen.getByRole('button', { name: '보내기' }))

      expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
      const writeCalls = fetchSpy.mock.calls.filter((call) => /\/(draft|send)$/.test(String(call[0])))
      expect(writeCalls).toHaveLength(0)

      // 오프라인 발송은 큐에 쌓이지 않는다 — 재연결해도 저절로 나가지 않는다(ANI-1725).
      expect(window.localStorage.length).toBe(0)
      expect(window.sessionStorage.length).toBe(0)
      setOnLine(true)
      fireEvent(window, new Event('online'))
      await Promise.resolve()
      expect(
        fetchSpy.mock.calls.filter((call) => /\/(draft|send)$/.test(String(call[0]))),
      ).toHaveLength(0)
    })

    it('앱이 백그라운드에 다녀와도 전송 중인 같은 답글을 다시 보내지 않는다', async () => {
      let resolveSend!: (value: unknown) => void
      const pendingSend = new Promise((resolve) => {
        resolveSend = resolve
      })
      const fetchSpy = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, draft: { fingerprint: 'reviewed-fingerprint' } }) })
        }
        return pendingSend
      })
      globalThis.fetch = fetchSpy as any

      render(
        <EngagementInbox
          initialData={makeMockResponse({ send_enabled: true })}
          workspaceId="ws-1"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /happy_user/ }))
      fireEvent.click(screen.getAllByRole('button', { name: /이 답글 보내기/ })[0])
      const sendCalls = () =>
        fetchSpy.mock.calls.filter((call) => String(call[0]).includes('/send'))
      fireEvent.click(screen.getByRole('button', { name: '보내기' }))

      // 전송이 끝나기 전에 앱을 나갔다 돌아온다.
      await waitFor(() => expect(sendCalls()).toHaveLength(1))
      setDocumentVisibility('hidden')
      setDocumentVisibility('visible')

      // 복귀 후에도 전송 중 상태가 유지되고, 다시 눌러도 같은 답글은 두 번 나가지 않는다.
      const confirmAfterResume = screen.getByRole('button', { name: '보내기' })
      expect(confirmAfterResume).toBeDisabled()
      fireEvent.click(confirmAfterResume)
      await Promise.resolve()
      expect(sendCalls()).toHaveLength(1)

      resolveSend({ ok: true, json: () => Promise.resolve({ ok: true, status: 'SENT' }) })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(sendCalls()).toHaveLength(1)
    })

    it('does not send when the shown reply text could not be saved first', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'SENT' }) })
      })
      globalThis.fetch = fetchSpy as any

      render(<EngagementInbox initialData={makeMockResponse({ send_enabled: true })} workspaceId="ws-1" />)
      fireEvent.click(screen.getByRole('button', { name: /happy_user/ }))
      fireEvent.click(screen.getAllByRole('button', { name: /이 답글 보내기/ })[0])
      fireEvent.click(screen.getByRole('button', { name: '보내기' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(fetchSpy.mock.calls.filter((call) => String(call[0]).includes('/send'))).toHaveLength(0)
      expect(screen.getByText(/보내지 않았어요/)).toBeInTheDocument()
    })
  })

  describe('NEEDS_CHECK handling', () => {
    it('handles NEEDS_CHECK response, moves card to 확인 필요, offers NO retry button', async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/send')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ ok: false, status: 'NEEDS_CHECK' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, draft: { fingerprint: 'reviewed-fingerprint' } }),
        })
      })
      globalThis.fetch = fetchSpy as any

      render(
        <EngagementInbox
          initialData={makeMockResponse({ send_enabled: true })}
          workspaceId="ws-1"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /happy_user/ }))
      const sendBtn = screen.getAllByRole('button', { name: /이 답글 보내기/ })[0]
      fireEvent.click(sendBtn)

      const confirmBtn = screen.getByRole('button', { name: '보내기' })
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Shows NEEDS_CHECK guidance message
      expect(
        screen.getByText(/답글이 올라갔는지 확인해 주세요. 인스타그램 앱에서 확인한 뒤에 다시 보내지 말아 주세요./)
      ).toBeInTheDocument()

      // Move to 확인 필요 tab to check cards
      fireEvent.click(screen.getByRole('tab', { name: /확인 필요/ }))

      // Card must NOT have a retry button
      expect(screen.queryByRole('button', { name: /다시 시도/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /재시도/ })).not.toBeInTheDocument()
      // Card has only dismiss (무시) action
      expect(screen.getAllByRole('button', { name: /무시/ }).length).toBeGreaterThan(0)
    })
  })

  describe('Error vs Empty state distinction', () => {
    it('displays error state with retry button on load failure, never empty state', async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error('Network offline'))
      globalThis.fetch = fetchSpy as any

      render(<EngagementInbox workspaceId="ws-1" />)

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      expect(screen.getByText('댓글을 불러오지 못했어요')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument()
      expect(screen.queryByText('아직 답글이 필요한 댓글이 없어요')).not.toBeInTheDocument()
    })

    it('displays distinct tab-specific empty state on successful empty load', () => {
      render(
        <EngagementInbox
          initialData={{ items: [], send_enabled: true, cycle_enabled: true }}
          workspaceId="ws-1"
        />
      )

      expect(screen.getByText('아직 답글이 필요한 댓글이 없어요')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('tab', { name: /확인 필요/ }))
      expect(screen.getByText('확인이 필요한 댓글이 없어요')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('tab', { name: /완료/ }))
      expect(screen.getByText('완료된 답글이 아직 없어요')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('tab', { name: /무시함/ }))
      expect(screen.getByText('무시한 댓글이 없어요')).toBeInTheDocument()
    })
  })

  describe('Auto Reply Policy confirmation and disabled classes', () => {
    it('requires confirmation dialog when turning auto-reply ON, repeating help text', async () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      // Open auto reply panel
      fireEvent.click(screen.getByRole('button', { name: /자동 답글 규칙/ }))

      const toggle = screen.getByRole('checkbox', { name: /소희가 간단한 댓글에 알아서 답글 달기/ })
      expect(toggle).not.toBeChecked()

      // Click toggle
      fireEvent.click(toggle)

      // Confirmation dialog should open
      const dialog = screen.getByRole('dialog', { name: '자동 답글을 켤까요?' })
      expect(dialog).toBeInTheDocument()
      expect(dialog).toHaveTextContent(
        '켜면 감사·인사 같은 간단한 댓글에는 승인 없이 답글을 올려요. 불만·민감한 내용·스팸은 항상 직접 확인해요.'
      )

      // Confirm turn on
      fireEvent.click(screen.getByRole('button', { name: '켜기' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(toggle).toBeChecked()
    })

    it('disables 불만, 민감한 내용, 스팸 with explanation, and warns on 질문', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /자동 답글 규칙/ }))

      const complaintCheckbox = screen.getByRole('checkbox', { name: /불만/ })
      expect(complaintCheckbox).toBeDisabled()
      expect(complaintCheckbox).not.toBeChecked()

      const sensitiveCheckbox = screen.getByRole('checkbox', { name: /민감한 내용/ })
      expect(sensitiveCheckbox).toBeDisabled()
      expect(sensitiveCheckbox).not.toBeChecked()

      const spamCheckbox = screen.getByRole('checkbox', { name: /스팸/ })
      expect(spamCheckbox).toBeDisabled()
      expect(spamCheckbox).not.toBeChecked()

      // Explanation is present
      expect(screen.getAllByText('항상 직접 확인해요').length).toBe(3)

      // Question has warning line
      expect(screen.getByText('정확하지 않은 답이 나갈 수 있어요')).toBeInTheDocument()
    })
  })

  describe('Korean-only and No Code Leak assertions', () => {
    it('renders zero English status codes or technical identifiers in the UI', () => {
      const { container } = render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      const text = container.textContent || ''

      // No uppercase status code leaks
      const forbiddenCodes = [
        'RECEIVED',
        'CLASSIFIED',
        'DRAFTED',
        'APPROVED',
        'SENDING',
        'NEEDS_CHECK',
        'DISMISSED',
        'NEEDS_HUMAN',
        'ENGAGEMENT_',
        '예약됨',
      ]

      for (const code of forbiddenCodes) {
        expect(text).not.toContain(code)
      }

      // Regex check: No uppercase tokens with 4+ characters in Korean sentences
      expect(text).not.toMatch(/[가-힣]\s*[A-Z_]{4,}/)
    })
  })

  describe('MasterDetail 2단 분할 뷰 규격', () => {
    it('선택이 없으면 emptyDetail 안내를 표시하고, 카드 클릭 시 aria-current="true"와 우측 상세를 노출한다', () => {
      render(
        <EngagementInbox
          initialData={makeMockResponse()}
          workspaceId="ws-1"
        />
      )

      expect(screen.getByRole('region', { name: '댓글 목록' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: '댓글 답글 검토' })).toBeInTheDocument()
      expect(screen.getByText('왼쪽에서 하나를 골라 보세요.')).toBeInTheDocument()

      const firstCard = screen.getByRole('button', { name: /happy_user/ })
      expect(firstCard).not.toHaveAttribute('aria-current')

      fireEvent.click(firstCard)
      expect(firstCard).toHaveAttribute('aria-current', 'true')
      expect(screen.getByText('좋은 말씀 감사드려요! 늘 최선을 다하겠습니다.')).toBeInTheDocument()
    })
  })
})
