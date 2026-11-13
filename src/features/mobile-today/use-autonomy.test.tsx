import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutonomy, type AutonomyControlResult } from './use-autonomy'

const WORKSPACE = 'ws-autonomy-test'
const ENDPOINT = `/api/workspaces/${WORKSPACE}/agent/control`

function serverState(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    desiredMode: 'RUNNING',
    actualMode: 'RUNNING',
    activeActionRunCount: 0,
    killSwitchActive: false,
    version: 3,
    updated_at: '2026-10-23T01:00:00.000Z',
    ...overrides,
  }
}

type FetchCall = [string, RequestInit | undefined]
type PostAnswer = () => Promise<Response>

/**
 * GET 은 서버 readback, POST 는 제어 요청이다.
 * `post` 가 주어지지 않으면 POST 자체가 일어나서는 안 되는 테스트로 본다.
 */
function stubServer(readbacks: Array<() => Promise<Response>>, post?: PostAnswer) {
  let readbackCount = 0
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (!post) throw new Error('unexpected POST')
      return post()
    }
    const next = readbacks[Math.min(readbackCount, readbacks.length - 1)]
    readbackCount += 1
    return next()
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function calls(mock: ReturnType<typeof stubServer>): FetchCall[] {
  return mock.mock.calls as unknown as FetchCall[]
}

function getCalls(mock: ReturnType<typeof stubServer>) {
  return calls(mock).filter(([, init]) => init?.method !== 'POST')
}

function postCalls(mock: ReturnType<typeof stubServer>) {
  return calls(mock).filter(([, init]) => init?.method === 'POST')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAutonomy — 서버 readback 기준 상태', () => {
  it('readback 성공 시 version·actualMode 를 그대로 노출한다', async () => {
    stubServer([async () => Response.json(serverState({ version: 3 }))])

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    expect(hook.result.current.state?.version).toBe(3)
    expect(hook.result.current.state?.actualMode).toBe('RUNNING')
    expect(hook.result.current.conflict).toBe(false)
    expect(hook.result.current.errorMessage).toBe('')
  })

  it('workspace 가 다른 응답은 신뢰하지 않고 error 로 fail-closed 한다', async () => {
    stubServer([async () => Response.json(serverState({ workspaceId: 'other-workspace' }))])

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('error'))

    expect(hook.result.current.state).toBeNull()
    expect(hook.result.current.errorMessage).toContain('응답 확인 필요')
  })
})

describe('useAutonomy — setPaused 제어 계약', () => {
  it('마지막 readback 의 version 을 expectedVersion 으로 보낸다', async () => {
    const mock = stubServer(
      [
        async () => Response.json(serverState({ version: 7 })),
        async () => Response.json(serverState({ version: 8, desiredMode: 'PAUSED', actualMode: 'PAUSED' })),
      ],
      async () => Response.json(serverState({ version: 8 }), { status: 200 }),
    )

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    await act(async () => {
      await hook.result.current.setPaused(true)
    })

    const [url, init] = postCalls(mock)[0]
    expect(url).toBe(ENDPOINT)
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ action: 'set_mode', desiredMode: 'PAUSED', expectedVersion: 7 })
    expect(typeof body.reason).toBe('string')
  })

  it('성공 응답 본문을 믿지 않고 readback 재조회로 표시를 채운다', async () => {
    const mock = stubServer(
      [
        async () => Response.json(serverState({ version: 3, actualMode: 'RUNNING' })),
        async () => Response.json(serverState({ version: 4, desiredMode: 'PAUSED', actualMode: 'ARMING' })),
      ],
      // 서버가 accepted 했더라도 본문은 표시 근거가 아니다(실제로는 PAUSED 라고 주장).
      async () => Response.json(serverState({ version: 4, desiredMode: 'PAUSED', actualMode: 'PAUSED' })),
    )

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.state?.version).toBe(3))

    let result: AutonomyControlResult | undefined
    await act(async () => {
      result = await hook.result.current.setPaused(true)
    })
    expect(result).toEqual({ ok: true })

    await waitFor(() => expect(hook.result.current.state?.version).toBe(4))
    expect(hook.result.current.state?.actualMode).toBe('ARMING')
    expect(getCalls(mock)).toHaveLength(2)
  })
})

describe('useAutonomy — 409 / 403 / 500 / 불확실 결과 회귀', () => {
  it('409 는 conflict 로 접히고 화면 상태를 error + conflict 로 올린다', async () => {
    stubServer(
      [async () => Response.json(serverState({ version: 3 }))],
      async () => Response.json({ error: 'VERSION_CONFLICT' }, { status: 409 }),
    )

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    let result: AutonomyControlResult | undefined
    await act(async () => {
      result = await hook.result.current.setPaused(true)
    })

    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    if (!result || result.ok) throw new Error('expected failure')
    expect(result.message).toContain('다른 기기에서 먼저 바뀌었어요')
    expect(hook.result.current.load).toBe('error')
    expect(hook.result.current.conflict).toBe(true)
    expect(hook.result.current.errorMessage).toContain('다른 기기에서 먼저 바뀌었어요')
    // 낙관적 전환 금지: 서버 readback 상태는 그대로 남는다.
    expect(hook.result.current.state?.desiredMode).toBe('RUNNING')
  })

  it('403 은 forbidden 이며 readback 상태·load 를 건드리지 않는다', async () => {
    const mock = stubServer(
      [async () => Response.json(serverState({ version: 3 }))],
      async () => Response.json({ error: 'FORBIDDEN' }, { status: 403 }),
    )

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    let result: AutonomyControlResult | undefined
    await act(async () => {
      result = await hook.result.current.setPaused(true)
    })

    expect(result).toMatchObject({ ok: false, kind: 'forbidden' })
    if (!result || result.ok) throw new Error('expected failure')
    expect(result.message).toContain('소유자 또는 관리자만')
    expect(hook.result.current.load).toBe('ready')
    expect(hook.result.current.conflict).toBe(false)
    expect(hook.result.current.state?.version).toBe(3)
    expect(getCalls(mock)).toHaveLength(1)
  })

  it('500 은 failed 이며 재조회(readback)를 발생시키지 않는다', async () => {
    const mock = stubServer(
      [async () => Response.json(serverState({ version: 3 }))],
      async () => Response.json({ error: 'SERVER_ERROR' }, { status: 500 }),
    )

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    let result: AutonomyControlResult | undefined
    await act(async () => {
      result = await hook.result.current.setPaused(false)
    })

    expect(result).toMatchObject({ ok: false, kind: 'failed' })
    if (!result || result.ok) throw new Error('expected failure')
    expect(result.message).toContain('변경을 적용하지 못했어요')
    expect(getCalls(mock)).toHaveLength(1)
    expect(hook.result.current.state?.version).toBe(3)
  })

  it('네트워크 예외는 "바뀌지 않았을 수 있음" 문구로 끝나고 상태를 바꾸지 않는다 (현 계약: failed)', async () => {
    const mock = stubServer(
      [async () => Response.json(serverState({ version: 3 }))],
      async () => {
        throw new TypeError('Failed to fetch')
      },
    )

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    let result: AutonomyControlResult | undefined
    await act(async () => {
      result = await hook.result.current.setPaused(true)
    })

    // 결과 불확실(transport 실패)은 성공으로도 확정 실패로도 단정하지 않는다.
    expect(result).toMatchObject({ ok: false, kind: 'failed' })
    if (!result || result.ok) throw new Error('expected failure')
    expect(result.message).toContain('상태는 바뀌지 않았을 수 있어요')
    // 성공으로 오인해 readback 을 다시 걸지 않는다(요청은 1회 GET + 1회 POST 뿐).
    expect(getCalls(mock)).toHaveLength(1)
    expect(postCalls(mock)).toHaveLength(1)
    expect(hook.result.current.load).toBe('error')
    expect(hook.result.current.state?.desiredMode).toBe('RUNNING')
  })

  it('readback 전에는 쓰기를 시도하지 않는다', async () => {
    const mock = stubServer([() => new Promise<Response>(() => {})])

    const hook = renderHook(() => useAutonomy(WORKSPACE))

    let result: AutonomyControlResult | undefined
    await act(async () => {
      result = await hook.result.current.setPaused(true)
    })

    expect(result).toMatchObject({ ok: false, kind: 'failed' })
    if (!result || result.ok) throw new Error('expected failure')
    expect(result.message).toContain('상태를 다시 확인한 뒤')
    expect(postCalls(mock)).toHaveLength(0)
  })
})

describe('useAutonomy — kill switch readback', () => {
  it('killSwitchActive 는 서버 값만 반영한다', async () => {
    stubServer([async () => Response.json(serverState({ killSwitchActive: true, actualMode: 'BLOCKED' }))])

    const hook = renderHook(() => useAutonomy(WORKSPACE))
    await waitFor(() => expect(hook.result.current.load).toBe('ready'))

    expect(hook.result.current.state?.killSwitchActive).toBe(true)
    expect(hook.result.current.state?.actualMode).toBe('BLOCKED')
  })
})
