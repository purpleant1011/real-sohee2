import { describe, it, expect, vi } from 'vitest'
import {
  getPersistedBrowserChannelState,
  mapBrowserChannelRow,
} from '../browser-channel-verification'

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'

/** browser_channel_connections 조회 체인을 흉내내며 실제로 호출된 조건을 기록한다. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: any = {
    select: vi.fn((...args: unknown[]) => { calls.push(['select', ...args]); return builder }),
    eq: vi.fn((...args: unknown[]) => { calls.push(['eq', ...args]); return builder }),
    order: vi.fn((...args: unknown[]) => { calls.push(['order', ...args]); return builder }),
    limit: vi.fn((...args: unknown[]) => { calls.push(['limit', ...args]); return builder }),
    maybeSingle: vi.fn(async () => result),
  }
  const from = vi.fn((table: string) => { calls.push(['from', table]); return builder })
  return { client: { from } as any, calls }
}

describe('브라우저 커넥터 채널 검증 (ANI-1776)', () => {
  it.each([
    ['connected', 'CONNECTED_UNVERIFIED'],
    ['reauth_required', 'READY_DEGRADED'],
    ['target_mismatch', 'CONNECTED_UNVERIFIED'],
    ['revoked', 'NOT_CONNECTED'],
    ['unavailable', 'UNKNOWN'],
    ['schema_drift_value', 'UNKNOWN'],
  ] as const)('%s → %s', (rowStatus, expected) => {
    expect(mapBrowserChannelRow('naver_blog', { status: rowStatus }).status).toBe(expected)
  })

  it('연결 행이 없으면 NOT_CONNECTED', () => {
    const state = mapBrowserChannelRow('daangn_business', null)
    expect(state.status).toBe('NOT_CONNECTED')
    expect(state.verified).toBe(false)
    expect(state.lastCheckedAt).toBeNull()
  })

  it('어떤 행에서도 게시 가능(verified=true)을 주장하지 않는다', () => {
    for (const status of ['connected', 'reauth_required', 'target_mismatch', 'revoked', 'unavailable', 'x']) {
      expect(mapBrowserChannelRow('naver_blog', { status, verified_at: '2026-10-20T01:00:00.000Z' }).verified).toBe(false)
    }
  })

  it('검증 시각은 verified_at 만 쓰고 last_seen_at 으로 대체하지 않는다', () => {
    expect(mapBrowserChannelRow('naver_blog', {
      status: 'connected',
      verified_at: '2026-10-20T01:00:00.000Z',
      last_seen_at: '2026-10-22T09:00:00.000Z',
    }).lastCheckedAt).toBe('2026-10-20T01:00:00.000Z')

    expect(mapBrowserChannelRow('naver_blog', {
      status: 'connected',
      last_seen_at: '2026-10-22T09:00:00.000Z',
    }).lastCheckedAt).toBeNull()
  })

  it('잘못된 시각 문자열은 null 로 닫는다', () => {
    expect(mapBrowserChannelRow('naver_blog', { status: 'connected', verified_at: 'nope' }).lastCheckedAt).toBeNull()
  })

  it('대상 불일치는 다른 계정으로 표시한다', () => {
    expect(mapBrowserChannelRow('daangn_business', { status: 'target_mismatch' }).connectedAccountMatches).toBe(false)
  })

  it('프로덕션 환경의 최신 연결만 실제 연결로 읽는다', async () => {
    const { client, calls } = fakeClient({
      data: { status: 'connected', external_account_label: '바이름 블로그', verified_at: '2026-10-20T01:00:00.000Z' },
      error: null,
    })

    const state = await getPersistedBrowserChannelState(WORKSPACE_ID, 'naver_blog', { adminClient: client })

    expect(state).toMatchObject({
      status: 'CONNECTED_UNVERIFIED',
      verified: false,
      accountLabel: '바이름 블로그',
      lastCheckedAt: '2026-10-20T01:00:00.000Z',
    })
    expect(calls).toContainEqual(['from', 'browser_channel_connections'])
    expect(calls).toContainEqual(['eq', 'workspace_id', WORKSPACE_ID])
    expect(calls).toContainEqual(['eq', 'channel', 'naver_blog'])
    expect(calls).toContainEqual(['eq', 'environment', 'production'])
  })

  it('조회 오류는 NOT_CONNECTED 가 아니라 UNKNOWN 으로 닫는다', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied for table' } })
    const state = await getPersistedBrowserChannelState(WORKSPACE_ID, 'daangn_business', { adminClient: client })

    expect(state.status).toBe('UNKNOWN')
    expect(state.verified).toBe(false)
    expect(state.blockerMessage).not.toMatch(/permission denied/)
  })

  it('예외도 UNKNOWN 으로 닫는다', async () => {
    const client = { from: vi.fn(() => { throw new Error('boom') }) } as any
    const state = await getPersistedBrowserChannelState(WORKSPACE_ID, 'naver_blog', { adminClient: client })
    expect(state.status).toBe('UNKNOWN')
  })
})

/**
 * [ANI-1776] 격리 테스트.
 * 이 어댑터는 service-role 클라이언트(RLS 우회)로 조회하므로, `.eq('workspace_id', ...)`
 * 필터가 유일한 테넌트 격리 경계다. 필터가 빠지면 다른 가게의 연결이 그대로 새어 나간다.
 */
describe('브라우저 커넥터 채널 검증 — 교차 테넌트 격리', () => {
  const WORKSPACE_A = '10000000-0000-4000-8000-00000000000a'
  const WORKSPACE_B = '10000000-0000-4000-8000-00000000000b'

  /** 실제 필터처럼 동작한다: 조건에 맞는 행만 돌려주고, 맞지 않으면 null. */
  function filteringClient(rows: Array<Record<string, unknown>>) {
    const builder: any = { filters: {} as Record<string, unknown> }
    for (const method of ['select', 'order', 'limit']) {
      builder[method] = vi.fn(() => builder)
    }
    builder.eq = vi.fn((column: string, value: unknown) => {
      builder.filters[column] = value
      return builder
    })
    builder.maybeSingle = vi.fn(async () => ({
      data: rows.find((row) => Object.entries(builder.filters).every(([key, value]) => row[key] === value)) ?? null,
      error: null,
    }))
    return { from: vi.fn(() => builder) } as any
  }

  const rows = [
    { workspace_id: WORKSPACE_A, channel: 'naver_blog', environment: 'production', status: 'connected', external_account_label: 'A 가게 블로그', verified_at: '2026-10-20T01:00:00.000Z' },
    { workspace_id: WORKSPACE_B, channel: 'naver_blog', environment: 'production', status: 'reauth_required', external_account_label: 'B 가게 블로그', verified_at: null },
  ]

  it('다른 워크스페이스의 연결을 읽지 않는다', async () => {
    const client = filteringClient(rows)

    const a = await getPersistedBrowserChannelState(WORKSPACE_A, 'naver_blog', { adminClient: client })
    const b = await getPersistedBrowserChannelState(WORKSPACE_B, 'naver_blog', { adminClient: client })

    expect(a).toMatchObject({ status: 'CONNECTED_UNVERIFIED', accountLabel: 'A 가게 블로그' })
    expect(b).toMatchObject({ status: 'READY_DEGRADED', accountLabel: 'B 가게 블로그' })
  })

  it('연결이 없는 워크스페이스는 이웃 가게 연결을 물려받지 않는다', async () => {
    const client = filteringClient(rows)
    const stranger = await getPersistedBrowserChannelState('10000000-0000-4000-8000-00000000000c', 'naver_blog', { adminClient: client })

    expect(stranger.status).toBe('NOT_CONNECTED')
    expect(stranger.accountLabel).toBeNull()
  })

  it('test 환경 연결 행은 실제 연결로 인정하지 않는다', async () => {
    const client = filteringClient([
      { workspace_id: WORKSPACE_A, channel: 'naver_blog', environment: 'test', status: 'connected', external_account_label: '테스트 환경', verified_at: '2026-10-20T01:00:00.000Z' },
    ])

    const state = await getPersistedBrowserChannelState(WORKSPACE_A, 'naver_blog', { adminClient: client })

    expect(state.status).toBe('NOT_CONNECTED')
    expect(state.verified).toBe(false)
  })
})
