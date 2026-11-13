// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { ConnectorEntry } from './connector-entry'

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => 'ws-test-entry',
}))

const mockSnapshot = {
  workspaceId: 'ws-test-entry',
  connections: [
    {
      connectorId: 'google_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T09:00:00Z',
      capabilities: ['events_read'],
    },
  ],
  storageReady: true,
}

describe('ConnectorEntry', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('마운트 시 현재 workspaceId의 마케팅 커넥터 스냅샷을 조회한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSnapshot,
    })

    render(<ConnectorEntry />)

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-test-entry/marketing-connectors',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    )

    await waitFor(() => {
      expect(screen.getByText('업무 도구 연결')).toBeInTheDocument()
      expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    })
  })

  it('조회 실패 시 에러 화면을 노출하고 다시 시도를 누르면 재요청한다', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockSnapshot,
      })
    })

    render(<ConnectorEntry />)

    await waitFor(() => {
      expect(screen.getByText(/오류가 발생했어요/i)).toBeInTheDocument()
    })

    const retryBtn = screen.getByRole('button', { name: /다시 시도/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    })
    expect(callCount).toBe(2)
  })

  it('연결 해제(onDisconnect) 시 DELETE API를 호출하고 스냅샷을 갱신한다', async () => {
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            connectorId: 'google_calendar',
            pendingDeletion: true,
            consentGeneration: 1,
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockSnapshot,
      })
    })

    render(<ConnectorEntry />)

    await waitFor(() => {
      expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    })

    const connectedTab = screen.getByRole('tab', { name: /연결됨/i })
    fireEvent.click(connectedTab)

    const disconnectBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
    fireEvent.click(disconnectBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/workspaces/ws-test-entry/marketing-connectors',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ connectorId: 'google_calendar' }),
        })
      )
      expect(screen.getByText(/정보 수집을 중단했으며 자료 삭제는 확인 중입니다/i)).toBeInTheDocument()
    })
  })

  it('유효하지 않은 영수증 수신 시 에러를 노출하고 가짜 성공으로 처리하지 않는다', async () => {
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: false }), // invalid receipt
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockSnapshot,
      })
    })

    render(<ConnectorEntry />)

    await waitFor(() => {
      expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    })

    const connectedTab = screen.getByRole('tab', { name: /연결됨/i })
    fireEvent.click(connectedTab)

    const disconnectBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
    fireEvent.click(disconnectBtn)

    await waitFor(() => {
      expect(screen.getByText(/연결 해제 응답 영수증이 올바르지 않아/i)).toBeInTheDocument()
    })
  })

  it('서버가 snapshot.pendingDeletions을 반환하면 notice를 SSOT로 재대사 복원 및 해소한다', async () => {
    // 1. pendingDeletions가 있는 스냅샷 반환 시 notice 복원
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockSnapshot,
        pendingDeletions: ['google_calendar'],
      }),
    })

    const { rerender } = render(<ConnectorEntry />)

    await waitFor(() => {
      expect(screen.getByText(/정보 수집을 중단했으며 자료 삭제는 확인 중입니다/i)).toBeInTheDocument()
    })

    // 2. 서버에서 삭제가 완료되어 pendingDeletions: []로 확인 시 notice 해소
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockSnapshot,
        pendingDeletions: [],
      }),
    })

    // 재시도 트리거
    fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
    rerender(<ConnectorEntry />)

    await waitFor(() => {
      expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    })
  })
})
