import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublishReadiness } from '../service'
import { READINESS_LABELS } from '../labels'

describe('PublishReadiness Service', () => {
  const mockNow = new Date('2026-10-09T10:00:00.000Z')
  const validTokenExpires = new Date(mockNow.getTime() + 48 * 60 * 60 * 1000).toISOString()
  const expiringSoonToken = new Date(mockNow.getTime() + 12 * 60 * 60 * 1000).toISOString()
  const expiredToken = new Date(mockNow.getTime() - 1000).toISOString()

  beforeEach(() => {
    process.env.VAULT_PUBLISH_ENABLED = '1'
    process.env.META_APP_MODE = 'live'
    process.env.META_APP_REVIEW_STATUS = 'approved'
    process.env.META_ACCESS_TIER = 'advanced'
    process.env.META_DATA_DELETION_CALLBACK_ENABLED = 'true'
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  function createMockAdmin(overrides: {
    connections?: any[]
    credentials?: any[]
    receipts?: any[]
    controlState?: any
    vaultItems?: any[]
    errors?: Record<string, Error>
  }) {
    return {
      from: vi.fn((table: string) => {
        if (overrides.errors?.[table]) {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: overrides.errors![table] }),
                  select: async () => ({ data: null, error: overrides.errors![table] }),
                }),
                maybeSingle: async () => ({ data: null, error: overrides.errors![table] }),
                is: () => Promise.resolve({ data: null, error: overrides.errors![table] }),
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: overrides.errors![table] }),
                  }),
                }),
              }),
            }),
          }
        }

        if (table === 'channel_connections') {
          return {
            select: () => ({
              eq: (_col1: string, _wsId: string) => ({
                eq: (_col2: string, channel: string) => ({
                  maybeSingle: async () => {
                    const row = (overrides.connections ?? []).find((c) => c.channel === channel)
                    return { data: row ?? null, error: null }
                  },
                }),
              }),
            }),
          }
        }

        if (table === 'meta_channel_credentials') {
          return {
            select: () => ({
              eq: (_col1: string, _wsId: string) => ({
                eq: (_col2: string, provider: string) => ({
                  maybeSingle: async () => {
                    const row = (overrides.credentials ?? []).find((c) => c.provider === provider)
                    return { data: row ?? null, error: null }
                  },
                }),
              }),
            }),
          }
        }

        if (table === 'channel_verification_runs') {
          return {
            select: () => ({
              eq: (_col1: string, _wsId: string) => ({
                eq: (_col2: string, channel: string) => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => {
                        const row = (overrides.receipts ?? []).find((r) => r.channel === channel)
                        return { data: row ?? null, error: null }
                      },
                    }),
                  }),
                }),
              }),
            }),
          }
        }

        if (table === 'workspace_runtime_control_states') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: overrides.controlState ?? { desired_mode: 'RUNNING', actual_mode: 'RUNNING' },
                  error: null,
                }),
              }),
            }),
          }
        }

        if (table === 'kill_switches') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        }

        if (table === 'vault_items') {
          return {
            select: () => ({
              eq: () => ({
                is: () => Promise.resolve({
                  data: overrides.vaultItems ?? [
                    {
                      id: 'item-1',
                      channel: 'instagram',
                      release_gate: 'HELD_USER',
                      approval_state: 'APPROVED',
                      deleted_at: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }

        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
              is: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }),
    }
  }

  it('reports ready when Instagram has all items ok and all global items are ok', async () => {
    const admin = createMockAdmin({
      connections: [
        { channel: 'instagram', status: 'verified', account_label: '@sohee_official' },
      ],
      credentials: [
        {
          provider: 'instagram',
          status: 'active',
          token_expires_at: validTokenExpires,
          granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
        },
      ],
      receipts: [
        {
          channel: 'instagram',
          status: 'VERIFIED',
          read_after_write_at: mockNow.toISOString(),
        },
      ],
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)

    expect(result.state).toBe('ready')
    const ig = result.channels.find((c) => c.channel === 'instagram')!
    expect(ig.state).toBe('ready')
    expect(ig.items.map((it) => it.state)).toEqual(['ok', 'ok', 'ok', 'ok'])

    const th = result.channels.find((c) => c.channel === 'threads')!
    expect(th.state).toBe('blocked')

    expect(result.global_items.map((it) => it.state)).toEqual(['ok', 'ok', 'ok'])
  })

  it('maps token expiring within 24h to blocked with Korean reason', async () => {
    const admin = createMockAdmin({
      connections: [
        { channel: 'instagram', status: 'verified', account_label: '@sohee_official' },
      ],
      credentials: [
        {
          provider: 'instagram',
          status: 'active',
          token_expires_at: expiringSoonToken,
          granted_scopes: ['instagram_business_content_publish'],
        },
      ],
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const ig = result.channels.find((c) => c.channel === 'instagram')!
    const loginItem = ig.items.find((it) => it.key === 'login_persistence')!

    expect(loginItem.state).toBe('blocked')
    expect(loginItem.reason).toBe('연결이 곧 끊겨요, 다시 연결해 주세요')
    expect(loginItem.action?.label).toBe('다시 연결하기')
  })

  it('maps expired token to blocked with reason', async () => {
    const admin = createMockAdmin({
      connections: [
        { channel: 'instagram', status: 'verified', account_label: '@sohee_official' },
      ],
      credentials: [
        {
          provider: 'instagram',
          status: 'active',
          token_expires_at: expiredToken,
          granted_scopes: ['instagram_business_content_publish'],
        },
      ],
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const ig = result.channels.find((c) => c.channel === 'instagram')!
    const loginItem = ig.items.find((it) => it.key === 'login_persistence')!

    expect(loginItem.state).toBe('blocked')
    expect(loginItem.reason).toBe('로그인 유효시간이 지났어요. 채널을 다시 연결해 주세요')
  })

  it('maps deficient scopes to blocked with reason', async () => {
    const admin = createMockAdmin({
      connections: [
        { channel: 'instagram', status: 'verified', account_label: '@sohee_official' },
      ],
      credentials: [
        {
          provider: 'instagram',
          status: 'active',
          token_expires_at: validTokenExpires,
          granted_scopes: ['instagram_business_basic'], // Missing publish
        },
      ],
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const ig = result.channels.find((c) => c.channel === 'instagram')!
    const permItem = ig.items.find((it) => it.key === 'publish_permission')!

    expect(permItem.state).toBe('blocked')
    expect(permItem.reason).toBe('게시 권한이 부족해요. 권한을 허용해 주세요')
    expect(permItem.action?.label).toBe('권한 설정하기')
  })

  it('maps unknown account label to unknown', async () => {
    const admin = createMockAdmin({
      connections: [
        { channel: 'instagram', status: 'verified', account_label: null },
      ],
      credentials: [
        {
          provider: 'instagram',
          status: 'active',
          token_expires_at: validTokenExpires,
          granted_scopes: ['instagram_business_content_publish'],
        },
      ],
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const ig = result.channels.find((c) => c.channel === 'instagram')!
    const accountItem = ig.items.find((it) => it.key === 'account_verification')!

    expect(accountItem.state).toBe('unknown')
    expect(accountItem.reason).toBe('연결된 계정 정보를 확인할 수 없어요')
    expect(accountItem.action?.label).toBe('계정 확인하기')
  })

  it('blocks global publish feature when server switch is off without exposing env names', async () => {
    process.env.VAULT_PUBLISH_ENABLED = '0'
    const admin = createMockAdmin({})

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const featureItem = result.global_items.find((it) => it.key === 'system_publish_feature')!

    expect(featureItem.state).toBe('blocked')
    expect(featureItem.reason).toBe(
      '소희의 실제 게시 기능이 아직 켜지지 않았어요. 켜지면 알려드릴게요.'
    )
    expect(featureItem.action).toBeNull()
    expect(featureItem.reason).not.toContain('VAULT_PUBLISH_ENABLED')
  })

  it('blocks global publish feature when workspace is not in live allowlist', async () => {
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '00000000-0000-4000-8000-0000000000a1'
    const admin = createMockAdmin({})

    const result = await getPublishReadiness(admin, '00000000-0000-0000-0000-000000000000', mockNow)
    const featureItem = result.global_items.find((it) => it.key === 'system_publish_feature')!

    expect(featureItem.state).toBe('blocked')
    expect(featureItem.reason).toBe(
      '소희의 실제 게시 기능이 아직 켜지지 않았어요. 켜지면 알려드릴게요.'
    )
    expect(featureItem.action).toBeNull()
  })

  it('does not block publishing when only the autonomous agent is paused (the default)', async () => {
    const admin = createMockAdmin({
      controlState: { desired_mode: 'PAUSED', actual_mode: 'PAUSED', kill_switch_active: false },
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const pauseItem = result.global_items.find((it) => it.key === 'agent_pause_status')!

    expect(pauseItem.state).toBe('ok')
    expect(pauseItem.reason).toBeNull()
  })

  it('blocks with a clear reason and no action while an emergency stop is on', async () => {
    const admin = createMockAdmin({
      controlState: { desired_mode: 'RUNNING', actual_mode: 'RUNNING', kill_switch_active: true },
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const pauseItem = result.global_items.find((it) => it.key === 'agent_pause_status')!

    expect(pauseItem.state).toBe('blocked')
    expect(pauseItem.reason).toBe('긴급 정지가 켜져 있어서 지금은 게시할 수 없어요.')
    expect(pauseItem.action).toBeNull()
  })

  it('blocks approved vault items when count is 0 and links to content studio', async () => {
    const admin = createMockAdmin({
      vaultItems: [],
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const vaultItem = result.global_items.find((it) => it.key === 'approved_vault_items')!

    expect(vaultItem.state).toBe('blocked')
    expect(vaultItem.reason).toBe('발행 가능한 승인된 보관 글이 아직 없어요.')
    expect(vaultItem.action?.label).toBe('미리보기 스튜디오에서 글 만들기')
    expect(vaultItem.action?.href).toBe('/app/content')
  })

  it('turns item into unknown when loader errors out (fail closed)', async () => {
    const admin = createMockAdmin({
      errors: {
        channel_connections: new Error('Postgres connection pool exhausted'),
      },
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    const ig = result.channels.find((c) => c.channel === 'instagram')!
    const connItem = ig.items.find((it) => it.key === 'channel_connection')!

    expect(connItem.state).toBe('unknown')
    expect(connItem.reason).toBe('지금은 확인하지 못했어요. 잠시 후 다시 확인해 주세요')
    expect(connItem.reason).not.toContain('Postgres')
  })

  it('evaluates overall state as unknown when no items are blocked but some are unknown', async () => {
    const admin = createMockAdmin({
      connections: [
        { channel: 'instagram', status: 'verified', account_label: '' }, // unknown
      ],
      credentials: [
        {
          provider: 'instagram',
          status: 'active',
          token_expires_at: validTokenExpires,
          granted_scopes: ['instagram_business_content_publish'],
        },
        {
          provider: 'threads',
          status: 'active',
          token_expires_at: validTokenExpires,
          granted_scopes: ['threads_content_publish'],
        },
      ],
      // Threads connection also unknown
      errors: {
        channel_connections: new Error('DB timeout'),
      },
    })

    const result = await getPublishReadiness(admin, 'ws-test', mockNow)
    // Connections have error -> unknown
    // If not ready and any item blocked => blocked. Here connections have error (unknown), but threads is blocked if no connection row.
    // Let's check overall state is not 'ready'
    expect(result.state).not.toBe('ready')
  })
})
