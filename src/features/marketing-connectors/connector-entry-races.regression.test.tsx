// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConnectorEntry } from './connector-entry'

const context = vi.hoisted(() => ({ workspaceId: 'workspace-a' }))
vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => context.workspaceId,
}))

function createSnapshot(
  workspaceId: string,
  options?: {
    connections?: Array<{ connectorId: string; status: 'connected' | 'disconnected'; lastSyncAt: string | null; capabilities: string[] }>
    pendingDeletions?: string[]
  }
) {
  return {
    workspaceId,
    storageReady: true,
    connections: options?.connections ?? [
      {
        connectorId: 'google_calendar',
        status: 'connected',
        lastSyncAt: '2026-11-10T09:00:00Z',
        capabilities: ['events_read'],
      },
    ],
    ...(options?.pendingDeletions !== undefined ? { pendingDeletions: options.pendingDeletions } : {}),
  }
}

describe('ConnectorEntry 비동기 레이스 및 응답 검증 (races regression)', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
    context.workspaceId = 'workspace-a'
  })

  afterEach(() => {
    global.fetch = originalFetch
    context.workspaceId = 'workspace-a'
  })

  describe('잘못된 DELETE receipt를 200이라도 성공처럼 처리 금지 및 상태 재확인', () => {
    const invalidReceiptCases = [
      {
        name: 'ok가 false인 경우',
        receipt: { ok: false, connectorId: 'google_calendar', consentGeneration: 1, pendingDeletion: true },
      },
      {
        name: 'ok 필드가 누락된 경우',
        receipt: { connectorId: 'google_calendar', consentGeneration: 1, pendingDeletion: true },
      },
      {
        name: 'connectorId가 요청한 커넥터와 다른 경우',
        receipt: { ok: true, connectorId: 'instagram', consentGeneration: 1, pendingDeletion: true },
      },
      {
        name: 'consentGeneration이 분수인 경우 (1.5)',
        receipt: { ok: true, connectorId: 'google_calendar', consentGeneration: 1.5, pendingDeletion: true },
      },
      {
        name: 'consentGeneration이 0 이하인 경우',
        receipt: { ok: true, connectorId: 'google_calendar', consentGeneration: 0, pendingDeletion: true },
      },
      {
        name: 'pendingDeletion이 boolean이 아닌 문자열인 경우 ("true")',
        receipt: { ok: true, connectorId: 'google_calendar', consentGeneration: 1, pendingDeletion: 'true' },
      },
      {
        name: '응답 본문이 유효한 JSON이 아닌 경우',
        rawBody: 'invalid-json-response',
      },
    ]

    for (const testCase of invalidReceiptCases) {
      it(`200 OK라도 ${testCase.name} 시 가짜 성공을 배제하고 서버 결과 불명 상태를 재확인하거나 에러를 표시한다`, async () => {
        let deleteCallCount = 0
        let refetchTriggered = false

        global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (options?.method === 'DELETE') {
            deleteCallCount++
            if (testCase.rawBody) {
              return Promise.resolve(new Response(testCase.rawBody, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }))
            }
            return Promise.resolve(new Response(JSON.stringify(testCase.receipt), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }))
          }

          // GET snapshot
          if (deleteCallCount > 0) {
            refetchTriggered = true
          }
          return Promise.resolve(new Response(JSON.stringify(createSnapshot('workspace-a')), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        })

        render(<ConnectorEntry />)

        // 초기 로드 대기
        await screen.findByText('구글 캘린더')

        // 연결됨 탭 이동
        const connectedTab = screen.getByRole('tab', { name: /연결됨/i })
        fireEvent.click(connectedTab)

        // 연결 해제 버튼 클릭
        const disconnectBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
        fireEvent.click(disconnectBtn)

        // 가짜 성공(삭제 완료 notice)이 노출되지 않아야 함
        expect(screen.queryByText(/정보 수집을 중단했으며 자료 삭제는 확인 중입니다/i)).not.toBeInTheDocument()

        // 서버 결과 불명(unknown)이므로:
        // 1) 상태 재확인을 위한 GET 재조회가 수행되었거나,
        // 2) 혹은 에러/불명 안내가 노출되어 이전 스냅샷이 온전히 유지되지 않아야 함
        await waitFor(() => {
          const hasError = screen.queryByText(/연결 해제 오류|오류/i) !== null
          expect(refetchTriggered || hasError).toBe(true)
        })
      })
    }
  })

  describe('동시 해제 방지 및 single-flight 보장', () => {
    it('생산성 커넥터 2개 제공 시 A 해제 진행 중 B 해제 버튼이 UI에서 차단되고 서버로 동시 DELETE가 나가지 않는다', async () => {
      let resolveDeleteGoogle: (value: Response) => void
      const delayedGooglePromise = new Promise<Response>((resolve) => {
        resolveDeleteGoogle = resolve
      })

      const deleteUrls: string[] = []
      let googleSignalAborted = false

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          deleteUrls.push(url as string)
          if ((url as string).includes('google_calendar') || JSON.stringify(options?.body).includes('google_calendar')) {
            options?.signal?.addEventListener('abort', () => {
              googleSignalAborted = true
            })
            return delayedGooglePromise
          }
          return Promise.resolve(new Response(JSON.stringify({ ok: true, connectorId: 'apple_calendar', pendingDeletion: false, consentGeneration: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        }

        return Promise.resolve(new Response(JSON.stringify(createSnapshot('workspace-a', {
          connections: [
            { connectorId: 'google_calendar', status: 'connected', lastSyncAt: '2026-11-10T09:00:00Z', capabilities: ['events_read'] },
            { connectorId: 'apple_calendar', status: 'connected', lastSyncAt: '2026-11-10T09:00:00Z', capabilities: ['events_read'] },
          ],
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      render(<ConnectorEntry />)
      await screen.findByText('구글 캘린더')
      await screen.findByText('애플 캘린더')

      // 연결됨 탭으로 이동
      fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))

      const googleBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
      const appleBtn = screen.getByRole('button', { name: /애플 캘린더 연결 해제/i })

      // 1. Google Calendar 해제 시작
      fireEvent.click(googleBtn)

      // 2. Google Calendar는 해제 진행 중
      expect(googleBtn).toBeDisabled()

      // 3. Apple Calendar 해제 버튼도 차단(disabled)되어야 함!
      expect(appleBtn).toBeDisabled()

      // 4. 차단된 Apple Calendar 버튼을 클릭 시도해도 서버로 DELETE가 추가로 나가지 않아야 함
      fireEvent.click(appleBtn)
      expect(deleteUrls.length).toBe(1)
      expect(googleSignalAborted).toBe(false)

      // 5. Google Calendar 해제 완료
      resolveDeleteGoogle!(new Response(JSON.stringify({
        ok: true,
        connectorId: 'google_calendar',
        pendingDeletion: false,
        consentGeneration: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      // 첫 번째 작업 완료 후 busy 상태 해소
      await waitFor(() => {
        expect(screen.queryByText(/해제 중/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('GET snapshot durable pendingDeletions 복원 및 해소', () => {
    it('Entry remount 또는 A->B->A 전환 시 GET snapshot의 pendingDeletions로부터 미완료 안내를 복원한다', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const requestedWs = (url as string).includes('workspace-b') ? 'workspace-b' : 'workspace-a'
        return Promise.resolve(new Response(JSON.stringify(createSnapshot(requestedWs, {
          pendingDeletions: requestedWs === 'workspace-a' ? ['google_calendar'] : [],
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      const view = render(<ConnectorEntry />)

      // workspace-a 첫 마운트: snapshot에 pendingDeletions가 있으므로 안내 표시 복원
      expect(await screen.findByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).toBeInTheDocument()

      // B로 전환
      context.workspaceId = 'workspace-b'
      view.rerender(<ConnectorEntry />)
      await waitFor(() => {
        expect(screen.queryByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).not.toBeInTheDocument()
      })

      // 다시 A로 복귀 (A->B->A): durable snapshot으로부터 안내 복원 확인
      context.workspaceId = 'workspace-a'
      view.rerender(<ConnectorEntry />)
      expect(await screen.findByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).toBeInTheDocument()
    })

    it('GET snapshot에서 pendingDeletions: [] 명시 확인 시 이전 임시 notice를 해소하고, undefined인 경우 유지한다', async () => {
      let pendingDeletionsInSnapshot: string[] | undefined = undefined

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          const body = JSON.parse((options?.body as string) || '{}')
          const isGoogle = body.connectorId === 'google_calendar'
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            connectorId: body.connectorId,
            pendingDeletion: isGoogle,
            consentGeneration: 1,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        }

        return Promise.resolve(new Response(JSON.stringify(createSnapshot('workspace-a', {
          connections: [
            { connectorId: 'google_calendar', status: 'connected', lastSyncAt: '2026-11-10T09:00:00Z', capabilities: ['events_read'] },
            { connectorId: 'apple_calendar', status: 'connected', lastSyncAt: '2026-11-10T09:00:00Z', capabilities: ['events_read'] },
          ],
          pendingDeletions: pendingDeletionsInSnapshot,
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      render(<ConnectorEntry />)
      await screen.findByText('구글 캘린더')

      // 1. DELETE 실행 -> receipt에 pendingDeletion: true가 있어 임시 notice 발생
      //    동시에 handleRetry()로 GET 스냅샷 재조회 발생
      //    이때 pendingDeletionsInSnapshot은 undefined임
      pendingDeletionsInSnapshot = undefined
      fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))

      // GET 스냅샷의 pendingDeletions가 undefined여도 완료 판정이 아니므로 notice 유지 확인
      await waitFor(() => {
        expect(screen.getByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).toBeInTheDocument()
      })

      // 2. 백엔드에서 삭제가 완료되어 다음 재조회 시 pendingDeletions: [] (빈 배열) 반환 준비
      pendingDeletionsInSnapshot = []

      // 두 번째 커넥터(Apple Calendar) 해제 실행 -> handleRetry 재조회 트리거
      const appleBtn = await screen.findByRole('button', { name: /애플 캘린더 연결 해제/i })
      fireEvent.click(appleBtn)

      // GET snapshot에서 pendingDeletions: [] 명시 확인 시 이전 임시 notice 해소 확인
      await waitFor(() => {
        expect(screen.queryByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).not.toBeInTheDocument()
      })
    })
  })

  describe('워크스페이스 전환 시 지연된 DELETE 응답의 간섭 방지', () => {
    it('A에서 DELETE 진행 중 B로 전환된 후 signal을 무시하는 delayed A 성공 응답이 도착해도 B의 notice/오류를 바꾸지 않는다', async () => {
      let resolveDeleteA: (value: Response) => void
      const delayedDeletePromise = new Promise<Response>((resolve) => {
        resolveDeleteA = resolve
      })

      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          return delayedDeletePromise
        }

        const requestedWs = (url as string).includes('workspace-b') ? 'workspace-b' : 'workspace-a'
        return Promise.resolve(new Response(JSON.stringify(createSnapshot(requestedWs)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      const view = render(<ConnectorEntry />)
      await screen.findByText('구글 캘린더')

      // 연결됨 탭 이동 및 A에서 해제 클릭
      fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))

      // 해제 요청 진행 중 workspace-b로 전환
      context.workspaceId = 'workspace-b'
      view.rerender(<ConnectorEntry />)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('workspace-b'),
          expect.anything()
        )
      })

      // 뒤늦은 A의 성공 응답
      resolveDeleteA!(new Response(JSON.stringify({
        ok: true,
        connectorId: 'google_calendar',
        pendingDeletion: true,
        consentGeneration: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByText(/정보 수집을 중단했으며 자료 삭제는 확인 중입니다/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/연결 해제 오류/i)).not.toBeInTheDocument()
    })

    const delayedFailureCases = [
      {
        name: 'malformed receipt 응답',
        action: (resolve: (v: Response) => void) =>
          resolve(new Response(JSON.stringify({ ok: false, connectorId: 'google_calendar' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })),
      },
      {
        name: '깨진 JSON 응답',
        action: (resolve: (v: Response) => void) =>
          resolve(new Response('not-valid-json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })),
      },
      {
        name: '네트워크 reject',
        action: (_: unknown, reject: (err: Error) => void) =>
          reject(new Error('네트워크 연결 끊김')),
      },
    ]

    for (const failCase of delayedFailureCases) {
      it(`A 해제 진행 중 B로 전환 후 A의 ${failCase.name} 도착 시 B에 오류나 notice를 표시하지 않는다`, async () => {
        let resolveDeleteA: (value: Response) => void
        let rejectDeleteA: (reason: Error) => void
        const delayedDeletePromise = new Promise<Response>((resolve, reject) => {
          resolveDeleteA = resolve
          rejectDeleteA = reject
        })

        global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (options?.method === 'DELETE') {
            return delayedDeletePromise
          }

          const requestedWs = (url as string).includes('workspace-b') ? 'workspace-b' : 'workspace-a'
          return Promise.resolve(new Response(JSON.stringify(createSnapshot(requestedWs)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        })

        const view = render(<ConnectorEntry />)
        await screen.findByText('구글 캘린더')

        // A에서 해제 클릭
        fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
        fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))

        // B로 전환
        context.workspaceId = 'workspace-b'
        view.rerender(<ConnectorEntry />)

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('workspace-b'),
            expect.anything()
          )
        })

        // A의 실패 응답 도착
        failCase.action(resolveDeleteA!, rejectDeleteA!)

        await new Promise((r) => setTimeout(r, 50))
        // B 화면에 A의 오류나 안내가 절대 침범하지 않아야 함
        expect(screen.queryByText(/연결 해제 오류|네트워크|유효하지 않은|파싱/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/정보 수집을 중단했으며 자료 삭제는 확인 중입니다/i)).not.toBeInTheDocument()
      })
    }

    it('A -> B -> A 전환 시 과거 epoch 1의 지연된 DELETE 응답이 새 A(epoch 2)의 상태를 바꾸지 않는다', async () => {
      let resolveDeleteEpoch1: (value: Response) => void
      const delayedEpoch1Promise = new Promise<Response>((resolve) => {
        resolveDeleteEpoch1 = resolve
      })

      let deleteCall = 0
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          deleteCall++
          if (deleteCall === 1) {
            return delayedEpoch1Promise
          }
        }

        const requestedWs = (url as string).includes('workspace-b') ? 'workspace-b' : 'workspace-a'
        return Promise.resolve(new Response(JSON.stringify(createSnapshot(requestedWs)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      const view = render(<ConnectorEntry />)
      await screen.findByText('구글 캘린더')

      // 1. A(epoch 1)에서 해제 클릭
      fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))

      // 2. B로 전환
      context.workspaceId = 'workspace-b'
      view.rerender(<ConnectorEntry />)
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('workspace-b'),
          expect.anything()
        )
      })

      // 3. 다시 A(epoch 2)로 복귀
      context.workspaceId = 'workspace-a'
      view.rerender(<ConnectorEntry />)
      await waitFor(() => {
        expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
      })

      // 4. 이제 과거 epoch 1의 지연된 DELETE 성공 응답이 뒤늦게 도착
      resolveDeleteEpoch1!(new Response(JSON.stringify({
        ok: true,
        connectorId: 'google_calendar',
        pendingDeletion: true,
        consentGeneration: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await new Promise((r) => setTimeout(r, 50))
      // 과거 epoch 1의 응답이 새 A에 notice나 에러를 주입하지 않아야 함
      expect(screen.queryByText(/정보 수집을 중단했으며 자료 삭제는 확인 중입니다/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/연결 해제 오류/i)).not.toBeInTheDocument()
    })
  })

  describe('A 해제 notice 상태에서 B 전환 시 잔존 상태 제거', () => {
    it('A에서 해제 notice가 표시된 후 B로 전환하면 이전 안내 및 선택/에러 상태가 깨끗이 제거된다', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            connectorId: 'google_calendar',
            pendingDeletion: true,
            consentGeneration: 1,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        }

        const requestedWs = (url as string).includes('workspace-b') ? 'workspace-b' : 'workspace-a'
        return Promise.resolve(new Response(JSON.stringify(createSnapshot(requestedWs)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      const view = render(<ConnectorEntry />)
      await screen.findByText('구글 캘린더')

      // 해제 실행
      fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))

      // A에서 안내 문구 표시 확인
      await waitFor(() => {
        expect(screen.getByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).toBeInTheDocument()
      })

      // 재조회 완료 후 상세 보기 클릭하여 상세 다이얼로그 오픈
      const detailBtn = await screen.findByRole('button', { name: /구글 캘린더 상세 정보 보기/i })
      fireEvent.click(detailBtn)
      expect(await screen.findByRole('dialog', { name: '구글 캘린더' })).toBeInTheDocument()

      // B로 전환
      context.workspaceId = 'workspace-b'
      view.rerender(<ConnectorEntry />)

      // B로 전환된 후 이전 워크스페이스 A의 안내 문구와 상세 다이얼로그가 제거되어야 함
      await waitFor(() => {
        expect(screen.queryByText('정보 수집을 중단했으며 자료 삭제는 확인 중입니다.')).not.toBeInTheDocument()
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText(/연결 해제 오류/i)).not.toBeInTheDocument()
    })
  })

  describe('Finding 2: 현재 epoch 비확정 mutation failure (network reject) 처리', () => {
    it('현재 DELETE fetch network reject 시 이전 connected snapshot을 숨기고 결과불명 한국어 global error 노출 및 GET retry를 수행한다', async () => {
      let getCount = 0
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'DELETE') {
          return Promise.reject(new TypeError('Failed to fetch (network disconnected)'))
        }

        getCount++
        return Promise.resolve(new Response(JSON.stringify(createSnapshot('workspace-a')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      })

      render(<ConnectorEntry />)
      await screen.findByText('구글 캘린더')

      fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))
      fireEvent.click(screen.getByRole('button', { name: /구글 캘린더 연결 해제/i }))

      // 1. 결과불명 한국어 global error 노출
      const errorMsg = await screen.findByText(/연결 해제 요청 결과를 확인하지 못했습니다/i)
      expect(errorMsg).toBeInTheDocument()

      // 2. 이전 connected snapshot 숨김 (alert 화면으로 전환되어 연결됨 탭 카드가 숨겨짐)
      expect(screen.queryByRole('tab', { name: /연결됨/i })).not.toBeInTheDocument()

      // 3. GET retry 수행 확인 (초기 로드 1회 + 비확정 실패 후 재조회 >= 2)
      await waitFor(() => {
        expect(getCount).toBeGreaterThanOrEqual(2)
      })
    })
  })
})
