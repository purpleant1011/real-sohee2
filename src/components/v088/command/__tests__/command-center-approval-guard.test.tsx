// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

const WS = '11111111-1111-4111-8111-111111111111'

const { probeMock } = vi.hoisted(() => ({ probeMock: vi.fn(async () => true) }))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

/** 실제 연결 확인(probe)만 테스트가 정한다. readOnline 은 실제 navigator.onLine 을 읽는다. */
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: probeMock }
})

vi.mock('@/hooks/use-workspace-context', () => ({
  useOptionalWorkspaceContext: () => ({ workspaceId: WS }),
}))
vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({ isPaused: false }),
}))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/agent-os/sohee-live-workboard', () => ({
  SoheeLiveWorkboard: () => null,
}))
vi.mock('@/components/v088/work/mission-console', () => ({ MissionConsole: () => null }))
vi.mock('@/components/v088/work/campaign-experiment-view', () => ({ CampaignExperimentView: () => null }))
vi.mock('@/components/v088/work/work-tab-views', () => ({
  RunningTasksView: () => null,
  WaitingTasksView: () => null,
  CompletedTasksView: () => null,
}))
/**
 * 수신함 카드 자체는 자기 테스트가 있다. 여기서는 이 화면이 승인·거절을
 * 외부 쓰기 가드를 거쳐 보내는지만 본다.
 */
vi.mock('@/components/v088/same-truth/EmployeeInbox', () => ({
  EmployeeInbox: ({ onApprove, onReject }: {
    onApprove?: (id: string) => void
    onReject?: (id: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onApprove?.('job-1')}>승인</button>
      <button type="button" onClick={() => onReject?.('job-1')}>거절</button>
    </div>
  ),
}))

import { CommandCenterClient } from '../command-center-client'

const READ_MODEL = {
  success: true,
  data: {
    businessName: { value: '바이름' },
    inbox: [{ id: 'job-1', status: 'approval_required' }],
    channels: [],
  },
}

function response(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  resetPageActionGuardForTests()
  probeMock.mockResolvedValue(true)
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('canonical-read-model')) return Promise.resolve(response(READ_MODEL))
    return Promise.resolve(response({ ok: true }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  // 오프라인 테스트가 navigator.onLine 스파이를 남기면 다음 테스트까지 오프라인으로 보인다.
  vi.restoreAllMocks()
  vi.mocked(toast.error).mockClear()
})

function callsTo(path: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(path)).length
}

async function renderCenter() {
  render(<CommandCenterClient />)
  // 수신함은 read model 이 도착한 뒤에야 그려진다.
  await screen.findByRole('button', { name: '승인' })
}

describe('지휘 화면 승인·거절 — 외부 쓰기 가드', () => {
  it.each([
    ['승인', '/api/channels/actions/approve'],
    ['거절', '/api/channels/actions/reject'],
  ])('오프라인에서 %s은 보내지 않는다(fail-closed)', async (label, path) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await renderCenter()

    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OFFLINE_WRITE_COPY))
    expect(callsTo(path)).toBe(0)
  })

  it('진행 중에 다시 눌러도 외부 요청은 한 번만 나간다', async () => {
    // 첫 승인 요청을 붙잡아 두어 '진행 중' 상태를 만든다.
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('canonical-read-model')) return Promise.resolve(response(READ_MODEL))
      if (url.includes('/api/channels/actions/approve')) return pending.then(() => response({ ok: true }))
      return Promise.resolve(response({ ok: true }))
    })

    await renderCenter()
    const approve = screen.getByRole('button', { name: '승인' })

    fireEvent.click(approve)
    fireEvent.click(approve)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(DUPLICATE_WRITE_COPY))
    expect(callsTo('/api/channels/actions/approve')).toBe(1)

    release()
  })
})
