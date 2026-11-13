import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/publish-readiness/readiness-card', () => ({
  ReadinessCard: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="publish-readiness-card" data-workspace-id={workspaceId} />
  ),
}))

// 외부 쓰기 가드는 실제 연결 확인(probe)을 거친다. 이 스위트는 발행 흐름을 보는 것이므로
// probe 는 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다(ANI-1778).
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import { ReleasePanel } from './release-panel'

const status = { open: true, reason_label: null, count: 2, connections: [
  { channel: 'threads', label: '스레드', open: true, reason_label: null, review_label: 'Meta 앱 심사 완료' },
  { channel: 'naver_blog', label: '네이버 블로그', open: false, reason_label: '네이버 연동은 준비 중이에요', review_label: '연동 준비 중' },
] }
const rows = { passed: 1, needs_review: 1, items: [
  { item_ref: 'pass-id', channel_label: '스레드', status_label: '통과', can_release: true, reason_label: null, action_label: null, checks: [{ status_label: '통과', message: '승인한 내용과 현재 내용이 같아요', action: null }] },
  { item_ref: 'fail-id', channel_label: '스레드', status_label: '재확인 필요', can_release: false, reason_label: '승인 후 내용이 달라졌어요', action_label: '변경 내용을 다시 승인해 주세요', checks: [{ status_label: '실패', message: '승인 후 내용이 달라졌어요', action: '변경 내용을 다시 승인해 주세요' }] },
] }
function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  setOnLine(true)
  resetPageActionGuardForTests()
})
afterEach(() => vi.unstubAllGlobals())
describe('ReleasePanel', () => {
  it.each([
    ['승인 후 내용이 달라졌어요', '변경 내용을 다시 승인해 주세요'],
    ['문구 유효기간이 지났어요', '문구와 유효기간을 수정하고 다시 승인해 주세요'],
    ['보관 기간이 길어 다시 확인해야 해요', '내용과 발행 대상을 다시 확인해 주세요'],
    ['채널 연결, 인증 또는 앱 심사 상태 때문에 발행할 수 없어요', '채널을 다시 연결하고 앱 심사 상태를 확인해 주세요'],
    ['승인한 계정과 현재 연결된 계정이 달라요', '올바른 계정을 연결하거나 다시 승인해 주세요'],
  ])('renders blocked reason and remedy for %s', async (reason, action) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: status }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { passed: 0, needs_review: 1, items: [{ item_ref: 'blocked', channel_label: '스레드', status_label: '재확인 필요', can_release: false, reason_label: reason, action_label: action, checks: [{ status_label: '실패', message: reason, action }] }] } }) }))
    render(<ReleasePanel workspaceId="shop" />)
    fireEvent.click(await screen.findByRole('button', { name: '발행 확인 시작' }))
    expect(await screen.findByText(`해결 방법 · ${action}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /선택한 글 0건 발행 요청/ })).toBeDisabled()
  })
  it('shows a locked button and the specific reason while review is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { ...status, open: false, reason_label: 'Meta 앱 심사가 끝나면 열려요', connections: [{ ...status.connections[0], open: false, review_label: 'Meta 앱 심사 대기 중' }] } }) }))
    render(<ReleasePanel workspaceId="shop" />)
    expect(await screen.findByText(/지금은 열 수 없어요 · Meta 앱 심사가 끝나면 열려요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '발행 확인 시작' })).toBeDisabled()
  })
  it('selects only passing posts and shows actionable failure reasons', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: status }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: rows }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { requested: 1, items: [], external_posts: 0 } }) }).mockResolvedValue({ ok: true, json: async () => ({ success: true, data: status }) })
    vi.stubGlobal('fetch', fetch)
    render(<ReleasePanel workspaceId="shop" />)
    fireEvent.click(await screen.findByRole('button', { name: '발행 확인 시작' }))
    expect(await screen.findByText('해결 방법 · 변경 내용을 다시 승인해 주세요')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /스레드.*통과/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /재확인 필요/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /선택한 글 1건 발행 요청/ }))
    await waitFor(() => expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ itemIds: ['pass-id'] }))
    expect(await screen.findByText(/1건의 발행 요청을 저장했어요/)).toBeInTheDocument()
  })
  it('shows account label in confirm dialog and keeps publish button disabled with reason if unverified', async () => {
    const reportData = {
      passed: 1,
      needs_review: 1,
      items: [
        {
          item_ref: 'verified-item',
          channel: 'instagram',
          channel_label: '인스타그램',
          account_label: '@sohee_cafe',
          status_label: '통과',
          can_release: true,
          reason_label: null,
          action_label: null,
          checks: [{ status_label: '통과', message: '승인 내용 동일', action: null }],
        },
        {
          item_ref: 'unverified-item',
          channel: 'threads',
          channel_label: '스레드',
          account_label: '연결된 계정',
          status_label: '재확인 필요',
          can_release: false,
          reason_label: '채널 연결 정보를 확인할 수 없어요',
          action_label: '채널을 연결해 주세요',
          checks: [{ status_label: '실패', message: '채널 연결 필요', action: null }],
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: status }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: reportData }) })
    )
    render(<ReleasePanel workspaceId="shop" />)
    fireEvent.click(await screen.findByRole('button', { name: '발행 확인 시작' }))

    // The unverified item has disabled publish button with visible reason
    const unverifiedReasons = await screen.findAllByText('채널 연결 정보를 확인할 수 없어요')
    expect(unverifiedReasons.length).toBeGreaterThanOrEqual(1)

    // Uncheck select-all so the individual publish button appears for passing item
    fireEvent.click(screen.getByRole('button', { name: '전체 선택 해제' }))

    // Both buttons exist: the unverified one is disabled, the passing one is enabled
    const publishButtons = screen.getAllByRole('button', { name: '발행하기' })
    const enabledBtn = publishButtons.find(btn => !btn.hasAttribute('disabled'))!
    const disabledBtn = publishButtons.find(btn => btn.hasAttribute('disabled'))!
    expect(enabledBtn).toBeDefined()
    expect(disabledBtn).toBeDefined()
    expect(disabledBtn).toBeDisabled()

    // Open confirmation dialog from enabled button
    fireEvent.click(enabledBtn)
    expect(await screen.findByText('인스타그램에 게시할까요?')).toBeInTheDocument()
    expect(screen.getByText(/인스타그램 · @sohee_cafe 계정에 실제로 게시돼요/)).toBeInTheDocument()
  })

  it('renders publish readiness card at the top with workspaceId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: status }) }))
    render(<ReleasePanel workspaceId="shop-abc" />)
    const readinessCard = await screen.findByTestId('publish-readiness-card')
    expect(readinessCard).toBeInTheDocument()
    expect(readinessCard).toHaveAttribute('data-workspace-id', 'shop-abc')
  })

  it('does not call the publish API while offline and shows the offline reason (ANI-1778)', async () => {
    const reportData = {
      passed: 1,
      needs_review: 0,
      items: [{
        item_ref: 'offline-item',
        channel: 'instagram',
        channel_label: '인스타그램',
        account_label: '@sohee_cafe',
        status_label: '통과',
        can_release: true,
        reason_label: null,
        action_label: null,
        checks: [{ status_label: '통과', message: '승인 내용 동일', action: null }],
      }],
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: status }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: reportData }) })
    vi.stubGlobal('fetch', fetch)
    render(<ReleasePanel workspaceId="shop" />)
    fireEvent.click(await screen.findByRole('button', { name: '발행 확인 시작' }))
    fireEvent.click(await screen.findByRole('button', { name: '전체 선택 해제' }))
    fireEvent.click(await screen.findByRole('button', { name: '발행하기' }))

    setOnLine(false)
    fireEvent.click(await screen.findByRole('button', { name: '실제 발행하기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_WRITE_COPY)
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/vault/publish'))).toBe(false)
  })
})
