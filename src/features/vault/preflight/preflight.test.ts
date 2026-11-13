import { describe, expect, it } from 'vitest'
import { calculateVaultFingerprintV3, type VaultFingerprintV3Input } from '../fingerprint/fingerprint'
import type { VaultItem, VaultPreflightRun } from '../types'
import type { VaultReader, VaultServiceRoleWriter } from '../model/vault-repository'
import { evaluatePreflight, runPreflight, summarizePreflights, type PreflightSnapshot, type PreflightPorts } from './index'
import { PgVaultPreflightPorts } from './pg-ports'

const now = new Date('2026-10-07T12:00:00.000Z')
const digest = 'a'.repeat(64)
const fingerprintInput: VaultFingerprintV3Input = {
  workspaceId: 'workspace', contentId: 'content', versionId: 'version', channel: 'instagram', targetAccountId: 'account-1', title: '제목',
  textBlockRenderSpec: { channel: 'instagram', blocks: [{ type: 'body', text: '본문' }], digest },
  tags: [], settings: { category: null, visibility: 'public', coupon: null }, images: [{ position: 0, renditionContentDigest: digest }],
}
const item: VaultItem = {
  id: 'item', workspaceId: 'workspace', contentId: 'content', versionId: 'version', channel: 'instagram',
  releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: '2026-10-01T12:00:00.000Z', heldBy: null, targetDate: null,
  approvedFingerprint: calculateVaultFingerprintV3(fingerprintInput), fingerprintSchemaVersion: 3, policyVersion: 'v1', specVersion: 'v1',
  approvalState: 'APPROVED', approvedBy: null, bundleId: null, idempotencyKey: 'key', deletedAt: null,
  createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
}
const snapshot: PreflightSnapshot = {
  fingerprint: { fingerprintSchemaVersion: 3, payload: fingerprintInput },
  validUntil: null, imageRights: 'VALID', imageQc: 'VALID',
  policyChanges: [{ policyId: 'approval-policy', version: 'v1', approvalSensitive: true }],
  approvedPolicyVersions: { 'approval-policy': 'v1' }, approvedAccountId: 'account-1',
}
const health = { connection: 'VERIFIED' as const, tokenExpiresAt: '2026-10-08T12:00:00.000Z', providerReview: 'APPROVED' as const, accountId: 'account-1' }
const check = (changes: Partial<PreflightSnapshot> = {}, overrides: Partial<VaultItem> = {}, h = health) =>
  evaluatePreflight({ ...item, ...overrides }, { ...snapshot, ...changes }, h, now)

describe('release preflight', () => {
  it('passes seven checks and marks absent content expiry not applicable', () => {
    const result = check()
    expect(result.canRelease).toBe(true)
    expect(result.items).toHaveLength(8)
    expect(result.items.find(i => i.code === 'CONTENT_EXPIRY')?.status).toBe('NOT_APPLICABLE')
  })
  it.each([
    ['FINGERPRINT', { fingerprint: { fingerprintSchemaVersion: 3 as const, payload: { ...fingerprintInput, title: '변경' } } }, {}, health],
    ['CONTENT_EXPIRY', { validUntil: '2026-10-07T12:00:00.000Z' }, {}, health],
    ['HOLD_AGE', {}, { heldAt: '2026-09-22T12:00:00.000Z' }, health],
    ['CONNECTION', {}, {}, { ...health, tokenExpiresAt: '2026-10-07T11:00:00.000Z' }],
    ['ACCOUNT', {}, {}, { ...health, accountId: 'account-2' }],
    ['IMAGE_RIGHTS', { imageRights: 'EXPIRED' }, {}, health],
    ['IMAGE_QC', { imageQc: 'EXPIRED' }, {}, health],
    ['POLICY', { policyChanges: [{ policyId: 'approval-policy', version: 'v2', approvalSensitive: true }] }, {}, health],
  ] as const)('%s violation blocks release with its own reason', (code, changes, overrides, h) => {
    const result = check(changes, overrides, h)
    expect(result.canRelease).toBe(false)
    expect(result.overall).toBe('FAIL')
    expect(result.items.find(i => i.code === code)?.status).toBe('FAIL')
    expect(result.items.find(i => i.code === code)?.action).toBeTruthy()
  })
  it('unknown evidence fails closed; absent expiry remains not applicable, not unknown', () => {
    const result = check({ fingerprint: null, imageRights: 'UNKNOWN', policyChanges: null })
    expect(result.canRelease).toBe(false)
    expect(result.overall).toBe('UNKNOWN')
    expect(result.items.find(i => i.code === 'FINGERPRINT')?.status).toBe('UNKNOWN')
    expect(result.items.find(i => i.code === 'CONTENT_EXPIRY')?.status).toBe('NOT_APPLICABLE')
  })
  it('holds non-v3 approvals when account provenance is missing, and does not release an unapproved item', () => {
    expect(check({ approvedAccountId: null }).items.find(i => i.code === 'ACCOUNT')?.status).toBe('UNKNOWN')
    expect(check({}, { approvalState: 'INVALIDATED' }).canRelease).toBe(false)
  })
  it('ignores nonsensitive policy changes, and handles not-yet-supported channels explicitly', () => {
    expect(check({ policyChanges: [{ policyId: 'display', version: 'v2', approvalSensitive: false }] }).items.find(i => i.code === 'POLICY')?.status).toBe('PASS')
    const unsupported = check({}, { channel: 'naver_blog' })
    expect(unsupported.items.find(i => i.code === 'CONNECTION')?.status).toBe('NOT_APPLICABLE')
    expect(unsupported.canRelease).toBe(false)
  })
  it('does not leak codes, identifiers, or SHA in any user-facing messages', () => {
    const results = [check(), check({ fingerprint: null, validUntil: 'broken', imageQc: 'UNKNOWN' }), check({ imageRights: 'EXPIRED' })]
    for (const result of results) for (const i of result.items) {
      expect(`${i.message} ${i.action ?? ''}`).not.toMatch(/SHA|[a-f0-9]{64}|FINGERPRINT|UNKNOWN|FAIL|PASS|workspace|account-1|item/)
    }
  })
  it('persists only evidence via the narrow repository port, leaving release_gate unchanged', async () => {
    const recorded: Array<Omit<VaultPreflightRun, 'id' | 'runAt'>> = []
    const ports: PreflightPorts = {
      vault: {
        getItem: async () => item,
        recordPreflightRun: async (run) => { recorded.push(run); return { ...run, id: 'run-1', runAt: now.toISOString() } },
      },
      readSnapshot: async () => ({ ...snapshot, imageRights: 'EXPIRED' }),
      readConnectionHealth: async () => health,
    }
    // Compile-time contract: the only writer is recordPreflightRun; no publication/action methods exist.
    type ExpectedWriter = Pick<VaultServiceRoleWriter, 'recordPreflightRun'>
    type ExpectedReader = Pick<VaultReader, 'getItem'>
    const _: ExpectedWriter & ExpectedReader = ports.vault
    void _
    const result = await runPreflight(ports, { workspaceId: 'workspace', itemId: 'item', triggeredBy: null, now })
    expect(result.canRelease).toBe(false)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].items).toEqual(result.items)
    expect(item.releaseGate).toBe('HELD_USER')
    expect(Object.keys(ports.vault).sort()).toEqual(['getItem', 'recordPreflightRun'])
  })
  it('treats configured hold threshold as inclusive and invalid timestamps as unknown', () => {
    expect(check({}, { heldAt: '2026-09-23T12:00:00.000Z' }).items.find(i => i.code === 'HOLD_AGE')?.status).toBe('PASS')
    expect(evaluatePreflight(item, snapshot, health, now, 5).items.find(i => i.code === 'HOLD_AGE')?.status).toBe('FAIL')
    expect(check({}, { heldAt: 'bad-date' }).items.find(i => i.code === 'HOLD_AGE')?.status).toBe('UNKNOWN')
  })
  it('fails closed on snapshot and health read errors without changing gate', async () => {
    const runs: Array<Omit<VaultPreflightRun, 'id' | 'runAt'>> = []
    const result = await runPreflight({
      vault: {
        getItem: async () => item,
        recordPreflightRun: async run => { runs.push(run); return { ...run, id: 'run', runAt: now.toISOString() } },
      },
      readSnapshot: async () => { throw new Error('unavailable') },
      readConnectionHealth: async () => { throw new Error('unavailable') },
    }, { workspaceId: item.workspaceId, itemId: item.id, triggeredBy: null, now })
    expect(result.overall).toBe('UNKNOWN')
    expect(result.canRelease).toBe(false)
    expect(runs[0].overall).toBe('UNKNOWN')
    expect(item.releaseGate).toBe('HELD_USER')
  })
  it('summarizes batch results with user-readable blocked reasons', () => {
    const summary = summarizePreflights([check(), check({ imageRights: 'EXPIRED' }), check({ fingerprint: null })])
    expect(summary).toMatchObject({ passed: 1, needsReview: 2 })
    expect(summary.blockedReasons).toHaveLength(2)
  })
})

describe('C-2 PgVaultPreflightPorts settings config source', () => {
  const makeMockDb = (payloadSettings: any) => {
    return {
      from: (table: string) => {
        const query: any = {
          select: () => query,
          eq: () => query,
          order: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: async () => ({
            data: table === 'content_items' ? { title: '제목' }
              : table === 'content_versions' ? { caption: '본문', hashtags: [] }
              : table === 'vault_variant_payloads' ? {
                payload: {
                  title: '제목',
                  text: '본문',
                  hashtags: [],
                  media: [],
                  settings: payloadSettings,
                  textBlockRenderSpec: { channel: 'instagram', blocks: [{ type: 'body', text: '본문' }], digest: 'digest-1' },
                },
              } : null,
            error: null,
          }),
        }
        return query
      },
    }
  }

  it('reads settings (category, visibility, coupon) from payload settings source rather than hardcoding', async () => {
    const db = makeMockDb({
      approved_target_account_id: 'account-1',
      approved_policy_versions: { 'channel-spec': 'v1', 'vault-save': 'v1' },
      valid_until: null,
      category: '식음료',
      visibility: 'PRIVATE',
      coupon: 'DISCOUNT10',
    })
    const ports = new PgVaultPreflightPorts(db as any)
    const snapshotResult = await ports.readSnapshot('workspace', item)
    expect(snapshotResult).not.toBeNull()
    expect((snapshotResult?.fingerprint?.payload as VaultFingerprintV3Input).settings).toEqual({
      category: '식음료',
      visibility: 'PRIVATE',
      coupon: 'DISCOUNT10',
    })
  })

  it('fails closed (null snapshot -> UNKNOWN) if settings source is corrupted or unavailable', async () => {
    const db = makeMockDb({
      approved_target_account_id: 'account-1',
      // visibility가 비어있거나 올바르지 않은 타입인 경우
      visibility: '',
    })
    const ports = new PgVaultPreflightPorts(db as any)
    const snapshotResult = await ports.readSnapshot('workspace', item)
    expect(snapshotResult).toBeNull()
  })
})
