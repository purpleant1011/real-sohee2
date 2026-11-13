import { describe, expect, it } from 'vitest'
import { extendFirstPostDraft, readDraftExtensionEvidence } from './first-post-draft-extension'

const NOW = Date.parse('2026-10-23T00:00:00Z')
const draft = { missionId: 'm', approvalFingerprint: 'fp', channels: [{ provider: 'instagram', handle: '@a' }, { provider: 'threads', handle: '@a' }] }
const cred = (provider: string, scopes: string[], expires = '2026-12-01T00:00:00Z') => ({ provider, status: 'active', granted_scopes: scopes, token_expires_at: expires, channel_connections: { external_account_id: 'x' } })
const receipt = (channel: string) => ({ channel, status: 'VERIFIED', read_after_write_at: '2026-10-22T00:00:00Z', created_at: '2026-10-22T00:00:00Z' })

describe('extendFirstPostDraft', () => {
  it('기존 필드와 승인 지문은 그대로 두고 필드만 더한다', () => {
    const out = extendFirstPostDraft(draft, { connections: [], credentials: [], receipts: [], now: NOW })
    expect(out.approvalFingerprint).toBe('fp')
    expect(out.missionId).toBe('m')
    expect(out.channels.map((c) => c.handle)).toEqual(['@a', '@a'])
    expect(out.costQuote).toEqual({ amountKrw: 0, source: 'POLICY' })
    expect(out.executionSurface).toBe('MOBILE_OK')
  })
  it('근거가 없으면 연결·게시 권한을 채우지 않는다', () => {
    const out = extendFirstPostDraft(draft, { connections: [], credentials: [], receipts: [], now: NOW })
    expect(out.channels[0]).not.toHaveProperty('connection')
    expect(out.channels[0]).not.toHaveProperty('publishPermission')
  })
  it('연결 상태는 channel_connections 에서만: connected/disconnected, error 는 생략', () => {
    const out = extendFirstPostDraft(draft, { connections: [{ channel: 'instagram', status: 'connected' }, { channel: 'threads', status: 'error' }], credentials: [], receipts: [], now: NOW })
    expect(out.channels[0]).toMatchObject({ connection: 'CONNECTED' })
    expect(out.channels[1]).not.toHaveProperty('connection')
    expect(extendFirstPostDraft(draft, { connections: [{ channel: 'instagram', status: 'disconnected' }], credentials: [], receipts: [], now: NOW }).channels[0]).toMatchObject({ connection: 'NOT_CONNECTED' })
  })
  it('게시 scope·토큰·최근 readback 이 모두 맞을 때만 GRANTED, 아니면 DENIED 도 아닌 생략', () => {
    const ok = extendFirstPostDraft(draft, { connections: [{ channel: 'instagram', status: 'connected' }], credentials: [cred('instagram', ['instagram_business_basic', 'instagram_business_content_publish'])], receipts: [receipt('instagram')], now: NOW })
    expect(ok.channels[0]).toMatchObject({ publishPermission: 'GRANTED' })
    const noScope = extendFirstPostDraft(draft, { connections: [], credentials: [cred('instagram', ['instagram_business_basic'])], receipts: [receipt('instagram')], now: NOW })
    expect(noScope.channels[0]).not.toHaveProperty('publishPermission')
    const noReceipt = extendFirstPostDraft(draft, { connections: [], credentials: [cred('instagram', ['instagram_business_basic', 'instagram_business_content_publish'])], receipts: [], now: NOW })
    expect(noReceipt.channels[0]).not.toHaveProperty('publishPermission')
  })

  describe('dataset_mode 명시 가산 (ANI-1768)', () => {
    it.each([
      ['ACTUAL', 'ACTUAL'],
      ['SHOWCASE_DEMO', 'SHOWCASE_DEMO'],
      ['TEST', 'TEST'],
    ])('정규 모드 %s 원값을 그대로 datasetMode 로 가산한다', (mode, expected) => {
      const out = extendFirstPostDraft(draft, { connections: [], credentials: [], receipts: [], datasetMode: mode as any, now: NOW })
      expect(out.datasetMode).toBe(expected)
      expect(out.approvalFingerprint).toBe('fp')
      expect(out.costQuote).toEqual({ amountKrw: 0, source: 'POLICY' })
      expect(out.executionSurface).toBe('MOBILE_OK')
    })

    it('CANARY 는 TEST 가 아니며 UNKNOWN 으로 fail-closed 한다 (CANARY≠TEST)', () => {
      const out = extendFirstPostDraft(draft, { connections: [], credentials: [], receipts: [], datasetMode: 'CANARY' as any, now: NOW })
      expect(out.datasetMode).toBe('UNKNOWN')
    })

    it.each([
      { mode: undefined, label: 'missing' },
      { mode: null, label: 'null' },
      { mode: 'UNKNOWN', label: 'UNKNOWN' },
      { mode: 'SOME_FUTURE_MODE', label: '미상' },
    ])('모드가 $label 이면 datasetMode: UNKNOWN', ({ mode }) => {
      const out = extendFirstPostDraft(draft, { connections: [], credentials: [], receipts: [], datasetMode: mode as any, now: NOW })
      expect(out.datasetMode).toBe('UNKNOWN')
    })

    it('초안 객체에 기존 datasetMode: ACTUAL 이 적혀 있어도 근거 기반으로 덮어쓴다 (기존 metadata ACTUAL 신뢰 금지)', () => {
      const legacyDraftWithActual = { ...draft, datasetMode: 'ACTUAL' }
      const out = extendFirstPostDraft(legacyDraftWithActual, { connections: [], credentials: [], receipts: [], datasetMode: 'UNKNOWN', now: NOW })
      expect(out.datasetMode).toBe('UNKNOWN')
    })
  })
})

describe('readDraftExtensionEvidence — workspace_registry.dataset_mode 연계', () => {
  function createAdmin(opts: {
    registryData?: any
    registryError?: any
    connectionsError?: any
    missingTable?: string
  } = {}) {
    return {
      from: (table: string) => {
        const query: any = {
          select: () => query,
          eq: (field: string, val: string) => {
            query._eq = query._eq || []
            query._eq.push([field, val])
            return query
          },
          in: () => query,
          order: () => query,
          maybeSingle: async () => {
            if (table === 'workspace_registry') {
              return { data: opts.registryData ?? null, error: opts.registryError ?? null }
            }
            return { data: null, error: null }
          },
          then: (resolve: any) => {
            if (table === opts.missingTable) return resolve({ data: null, error: null })
            if (table === 'channel_connections') {
              return resolve({ data: [], error: opts.connectionsError ?? null })
            }
            return resolve({ data: [], error: null })
          },
        }
        return query
      },
    }
  }

  it.each([
    ['ACTUAL', 'ACTUAL'],
    ['SHOWCASE_DEMO', 'SHOWCASE_DEMO'],
    ['TEST', 'TEST'],
  ])('workspace_registry 의 %s 를 datasetMode 로 읽는다', async (mode, expected) => {
    const evidence = await readDraftExtensionEvidence(
      createAdmin({ registryData: { dataset_mode: mode } }),
      'ws-1',
    )
    expect(evidence).not.toBeNull()
    expect(evidence?.datasetMode).toBe(expected)
  })

  it('CANARY 는 TEST 가 아니며 UNKNOWN 으로 평가한다 (CANARY≠TEST)', async () => {
    const evidence = await readDraftExtensionEvidence(
      createAdmin({ registryData: { dataset_mode: 'CANARY' } }),
      'ws-1',
    )
    expect(evidence).not.toBeNull()
    expect(evidence?.datasetMode).toBe('UNKNOWN')
  })

  it('registry 가 없거나(null) 에러거나 미상이면 datasetMode: UNKNOWN', async () => {
    const missing = await readDraftExtensionEvidence(
      createAdmin({ registryData: null }),
      'ws-1',
    )
    expect(missing?.datasetMode).toBe('UNKNOWN')

    const dbError = await readDraftExtensionEvidence(
      createAdmin({ registryError: { message: 'table not found' } }),
      'ws-1',
    )
    expect(dbError?.datasetMode).toBe('UNKNOWN')

    const unknownMode = await readDraftExtensionEvidence(
      createAdmin({ registryData: { dataset_mode: 'UNKNOWN_NEW_MODE' } }),
      'ws-1',
    )
    expect(unknownMode?.datasetMode).toBe('UNKNOWN')
  })

  it.each(['channel_connections', 'meta_channel_credentials', 'channel_verification_runs'])('%s 목록이 null 이면 빈 근거를 만들지 않는다', async (missingTable) => {
    expect(await readDraftExtensionEvidence(createAdmin({ missingTable }), 'ws-1')).toBeNull()
  })

  it('기존 connections/credentials/receipts 에러 시에는 전체 evidence 가 null 로 닫힌다', async () => {
    const failed = await readDraftExtensionEvidence(
      createAdmin({ connectionsError: { message: 'connection refused' } }),
      'ws-1',
    )
    expect(failed).toBeNull()
  })
})