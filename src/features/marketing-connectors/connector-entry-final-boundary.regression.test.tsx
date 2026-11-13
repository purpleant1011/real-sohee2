// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorEntry } from './connector-entry'

const context = vi.hoisted(() => ({ workspaceId: 'workspace-a' }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => context.workspaceId }))

const NOTICE = /정보 수집을 중단했으며 자료 삭제는 확인 중입니다/
const TIMEOUT_COPY = /결과를 확인하지 못했/

function snapshot(workspaceId: string) {
  return {
    workspaceId,
    storageReady: true,
    connections: [
      { connectorId: 'google_calendar', status: 'connected', lastSyncAt: '2026-11-10T09:00:00Z', capabilities: ['events_read'] },
      { connectorId: 'apple_calendar', status: 'connected', lastSyncAt: '2026-11-10T09:00:00Z', capabilities: ['events_read'] },
    ],
  }
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const receipt = (connectorId: string, pendingDeletion = true) => ({ ok: true, connectorId, pendingDeletion, consentGeneration: 1 })

async function openConnectedTab() {
  await screen.findByText('애플 캘린더')
  fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
}

describe('ConnectorEntry 최종 경계 (receipt 엄격 일치 / DELETE deadline)', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    context.workspaceId = 'workspace-a'
  })
  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
    context.workspaceId = 'workspace-a'
  })

  describe('receipt 요청/응답 ID 불일치', () => {
    it('Apple 해제 요청에 Google 성공 영수증이 오면 성공 안내 없이 snapshot을 숨기고 상태 재확인을 안내한다', async () => {
      let deleteBody: unknown
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          deleteBody = JSON.parse(String(options.body))
          return Promise.resolve(json(receipt('google_calendar')))
        }
        return Promise.resolve(json(snapshot('workspace-a')))
      })
      render(<ConnectorEntry />)
      await openConnectedTab()
      fireEvent.click(screen.getByRole('button', { name: /애플 캘린더 연결 해제/i }))

      expect(await screen.findByText(/영수증이 올바르지 않아/)).toBeInTheDocument()
      expect(deleteBody).toEqual({ connectorId: 'apple_calendar' })
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
      expect(screen.queryByText('구글 캘린더')).not.toBeInTheDocument()
    })
  })

  describe('DELETE 15000ms deadline', () => {
    type Mode = 'headers' | 'body'
    const cases: Array<[string, Mode]> = [
      ['응답 헤더가 오지 않을 때(signal 무시 fake)', 'headers'],
      ['응답 헤더 후 body JSON이 멈출 때', 'body'],
    ]

    for (const [name, mode] of cases) {
      it(`${name}: 15초 후 결과 불명 안내, 삭제 완료 단정 없음, 재시도로 mutex 복구`, async () => {
        let deleteCalls = 0
        let lateResolve: ((r: unknown) => void) | undefined
        global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
          if (options?.method === 'DELETE') {
            deleteCalls++
            if (deleteCalls === 1) {
              if (mode === 'headers') {
                return new Promise((resolve) => {
                  lateResolve = resolve
                })
              }
              return Promise.resolve({
                ok: true,
                status: 200,
                json: () =>
                  new Promise((resolve) => {
                    lateResolve = resolve
                  }),
              })
            }
            return Promise.resolve(json(receipt(JSON.parse(String(options.body)).connectorId, false)))
          }
          return Promise.resolve(json(snapshot('workspace-a')))
        })

        render(<ConnectorEntry />)
        await openConnectedTab()

        vi.useFakeTimers()
        fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))
        expect(deleteCalls).toBe(1)

        await act(async () => {
          await vi.advanceTimersByTimeAsync(14999)
        })
        expect(screen.queryByText(TIMEOUT_COPY)).not.toBeInTheDocument()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1)
        })
        vi.useRealTimers()

        expect(await screen.findByText(TIMEOUT_COPY)).toBeInTheDocument()
        expect(screen.queryByText('구글 캘린더')).not.toBeInTheDocument()
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
        expect(screen.queryByText(/삭제(가|를)? 완료/)).not.toBeInTheDocument()

        // 늦은 응답은 현재 상태를 바꾸지 못한다
        await act(async () => {
          lateResolve?.(mode === 'headers' ? json(receipt('google_calendar')) : receipt('google_calendar'))
          await new Promise((r) => setTimeout(r, 30))
        })
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
        expect(screen.getByText(TIMEOUT_COPY)).toBeInTheDocument()

        // 안전한 GET 재시도 -> mutex 복구 -> 다시 DELETE 가능
        fireEvent.click(screen.getByRole('button', { name: /다시 시도/i }))
        await screen.findByText('애플 캘린더')
        fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
        fireEvent.click(screen.getByRole('button', { name: /애플 캘린더 연결 해제/i }))
        await waitFor(() => expect(deleteCalls).toBe(2))
      })
    }

    it('timeout 후 안내가 사라지지 않는 조용한 무시가 아니라 timeout abort signal이 발동한다', async () => {
      let aborted = false
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          options.signal?.addEventListener('abort', () => {
            aborted = true
          })
          return new Promise(() => {})
        }
        return Promise.resolve(json(snapshot('workspace-a')))
      })
      render(<ConnectorEntry />)
      await openConnectedTab()
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      vi.useRealTimers()
      expect(aborted).toBe(true)
      expect(await screen.findByText(TIMEOUT_COPY)).toBeInTheDocument()
    })

    it('workspace 전환 abort는 timeout 안내를 만들지 않고, 전환 후 timer가 새 workspace를 건드리지 않는다', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') return new Promise(() => {})
        return Promise.resolve(json(snapshot(String(url).includes('workspace-b') ? 'workspace-b' : 'workspace-a')))
      })
      const view = render(<ConnectorEntry />)
      await openConnectedTab()
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))
      context.workspaceId = 'workspace-b'
      await act(async () => {
        view.rerender(<ConnectorEntry />)
        await vi.advanceTimersByTimeAsync(20000)
      })
      vi.useRealTimers()
      await screen.findByText('구글 캘린더')
      expect(screen.queryByText(TIMEOUT_COPY)).not.toBeInTheDocument()
    })

    it('정상 응답이 deadline 안에 오면 timer가 남아 결과를 덮지 않는다', async () => {
      global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') return Promise.resolve(json(receipt('google_calendar')))
        return Promise.resolve(json(snapshot('workspace-a')))
      })
      render(<ConnectorEntry />)
      await openConnectedTab()
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))
      await screen.findByText('애플 캘린더')
      await waitFor(() => expect(screen.getByText(NOTICE)).toBeInTheDocument())
      vi.useFakeTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000)
      })
      vi.useRealTimers()
      expect(screen.queryByText(TIMEOUT_COPY)).not.toBeInTheDocument()
      expect(screen.getByText(NOTICE)).toBeInTheDocument()
    })
  })
})
