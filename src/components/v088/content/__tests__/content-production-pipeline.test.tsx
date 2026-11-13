import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentProductionPipeline } from '../content-production-pipeline'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

// 가드는 실제 연결 확인(probe)을 거친다. 이 테스트는 승인 흐름을 보는 것이므로 연결 확인은
// 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다.
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

const CONTENT_ID = 'content-1'
const APPROVE_URL = '/api/workspaces/ws-1/content/approvals'

const contentRecord = {
  contentId: CONTENT_ID,
  workspaceId: 'ws-1',
  channel: 'INSTAGRAM',
  title: '가을 시술 안내',
  status: 'QC',
  currentVersionId: 'ver-1',
  versionNumber: 1,
  caption: '가을 시술 안내드립니다.',
  hashtags: ['#뷰티'],
  fingerprint: 'fp-1',
  isApproved: false,
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('ContentProductionPipeline 승인 외부 쓰기 가드', () => {
  let alertMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetPageActionGuardForTests()
    alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/content')) {
        return jsonResponse({ success: true, contents: [contentRecord] })
      }
      return jsonResponse({ success: true })
    }))
  })

  afterEach(() => {
    resetPageActionGuardForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderReady() {
    render(<ContentProductionPipeline workspaceId="ws-1" />)
    return screen.findByRole('button', { name: '이 원고 승인하기' })
  }

  function approvalCalls() {
    return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([input]) => String(input) === APPROVE_URL,
    )
  }

  it('승인 요청을 한 번만 보낸다 (중복 클릭)', async () => {
    const pending = deferred<Response>()
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/content')) {
          return jsonResponse({ success: true, contents: [contentRecord] })
        }
        return pending.promise
      },
    )

    const button = await renderReady()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(approvalCalls()).toHaveLength(1))
    expect(alertMock).toHaveBeenCalledWith(DUPLICATE_WRITE_COPY)

    pending.resolve(jsonResponse({ success: true }))
    await waitFor(() =>
      expect(screen.getByText('✓ 승인 완료 (불변 영속)')).toBeTruthy(),
    )
    // 승인이 끝난 뒤에도 요청은 한 번뿐이다.
    expect(approvalCalls()).toHaveLength(1)
  })

  it('오프라인이면 요청을 내보내지 않고 안내만 한다', async () => {
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const button = await renderReady()
      fireEvent.click(button)

      await waitFor(() => expect(alertMock).toHaveBeenCalledWith(OFFLINE_WRITE_COPY))
      expect(approvalCalls()).toHaveLength(0)
    } finally {
      onlineSpy.mockRestore()
    }
  })

  it('실패 후 다시 누르면 재시도할 수 있다 (차단이 남지 않는다)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    let attempt = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/content')) {
        return jsonResponse({ success: true, contents: [contentRecord] })
      }
      attempt += 1
      if (attempt === 1) {
        return jsonResponse({ success: false, error: { message: '원고 승인 처리 실패' } }, false)
      }
      return jsonResponse({ success: true })
    })

    const button = await renderReady()
    fireEvent.click(button)
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('원고 승인 처리 실패'))

    fireEvent.click(button)
    await waitFor(() => expect(approvalCalls()).toHaveLength(2))
  })
})
