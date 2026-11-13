import { describe, expect, it } from 'vitest'
import { decodeReleaseRef, preflightRelease, releaseRef, releaseStatus, requestRelease, type ReleaseDependencies } from './release-service'
import type { VaultItem } from '../../types'

const item = (id: string, channel: VaultItem['channel'] = 'threads'): VaultItem => ({ id, workspaceId: 'shop', contentId: 'post', versionId: 'version', channel, releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: new Date().toISOString(), heldBy: null, targetDate: null, approvedFingerprint: 'a'.repeat(64), fingerprintSchemaVersion: 3, policyVersion: 'vault-save-v1', specVersion: '2026.10.1', approvalState: 'APPROVED', approvedBy: null, bundleId: null, idempotencyKey: id, deletedAt: null, createdAt: '', updatedAt: '' })
const verified = { connection: 'VERIFIED' as const, tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(), providerReview: 'APPROVED' as const, accountId: 'shop-account' }
function deps(overrides: Partial<ReleaseDependencies> = {}): ReleaseDependencies {
  return {
    listItems: async () => [item('good'), item('bad')],
    readConnectionHealth: async () => verified,
    readiness: async () => 'PUBLISH_READY',
    runPreflight: async (_workspace, id) => ({ overall: id === 'good' ? 'PASS' : 'FAIL', canRelease: id === 'good', items: [{ code: 'FINGERPRINT', status: id === 'good' ? 'PASS' : 'FAIL', message: id === 'good' ? '승인한 내용과 현재 내용이 같아요' : '승인 후 내용이 달라졌어요', action: id === 'good' ? null : '변경 내용을 다시 승인해 주세요' }], blockedReasons: id === 'good' ? [] : ['승인 후 내용이 달라졌어요'] }),
    markRequested: async () => true,
    ...overrides,
  }
}
describe('release gate', () => {
  it('rejects a paused workspace before selecting a batch, and a blocked channel before persisted release', async () => {
    const changes: string[] = []
    await expect(requestRelease('shop', [releaseRef('good')], deps({ readInterventionState: async () => ({ blocked: true, label: '소희가 잠시 멈췄어요' }), markRequested: async (_, id) => { changes.push(id); return true } }))).rejects.toThrow('소희가 잠시 멈췄어요')
    await expect(requestRelease('shop', [releaseRef('good')], deps({ readInterventionState: async (_ws, ch) => ({ blocked: ch === 'threads', label: '소희가 잠시 멈췄어요' }), markRequested: async (_, id) => { changes.push(id); return true } }))).rejects.toThrow('소희가 잠시 멈췄어요')
    expect(changes).toEqual([])
  })
  it('locks pending review, disconnected channel and unsupported channels with user reasons', async () => {
    const pending = deps({ readConnectionHealth: async () => ({ ...verified, providerReview: 'PENDING' }) })
    expect((await releaseStatus('shop', pending)).open).toBe(false)
    await expect(requestRelease('shop', [releaseRef('good')], pending)).rejects.toThrow('Meta 앱 심사')
    const disconnected = deps({ readConnectionHealth: async () => ({ ...verified, connection: 'DISCONNECTED' }) })
    await expect(requestRelease('shop', [releaseRef('good')], disconnected)).rejects.toThrow('채널을 연결')
    const unsupported = deps({ listItems: async () => [item('naver', 'naver_blog')] })
    await expect(requestRelease('shop', [releaseRef('naver')], unsupported)).rejects.toThrow('네이버 연동')
  })
  it('requests only fresh passing items, never a failing item', async () => {
    const changed: string[] = []
    const result = await requestRelease('shop', [releaseRef('good'), releaseRef('bad')], deps({ markRequested: async (_workspace, id) => { changed.push(id); return true } }))
    expect(result.requested).toBe(1)
    expect(result.items.find(row => row.item_ref === releaseRef('bad'))?.reason_label).toContain('승인 후 내용이 달라졌어요')
    expect(changed).toEqual(['good'])
  })
  it('records one release request only after a successful state change', async () => {
    const recorded: string[] = []
    const sent = await requestRelease('shop', [releaseRef('good'), releaseRef('bad')], deps({
      markRequested: async (_workspace, id) => id === 'good',
      recordReleaseRequested: async (_workspace, selected) => { recorded.push(selected.id) },
    }))
    expect(sent.requested).toBe(1)
    expect(recorded).toEqual(['good'])
  })
  it('does not emit a release event if the conditional update fails', async () => {
    const recorded: string[] = []
    const sent = await requestRelease('shop', [releaseRef('good')], deps({
      markRequested: async () => false,
      recordReleaseRequested: async (_workspace, selected) => { recorded.push(selected.id) },
    }))
    expect(sent.requested).toBe(0)
    expect(recorded).toEqual([])
  })
  it('allows supported passing posts while unsupported posts remain blocked', async () => {
    const changed: string[] = []
    const mixed = deps({ listItems: async () => [item('good'), item('naver', 'naver_blog')], markRequested: async (_ws, id) => { changed.push(id); return true } })
    expect((await releaseStatus('shop', mixed)).open).toBe(true)
    const report = await preflightRelease('shop', 'owner', mixed)
    expect(report.passed).toBe(1)
    expect(report.needs_review).toBe(1)
    expect(report.items.find(row => row.item_ref === releaseRef('naver'))?.reason_label).toContain('네이버 연동')
    expect((await requestRelease('shop', [releaseRef('good')], mixed)).requested).toBe(1)
    expect(changed).toEqual(['good'])
  })
  it('rejects malformed or non-workspace selections and fails closed on unavailable health', async () => {
    await expect(requestRelease('shop', ['foreign'], deps())).rejects.toThrow('보관 항목')
    await expect(requestRelease('shop', ['good', 'good'], deps())).rejects.toThrow('보관 항목')
    expect((await releaseStatus('shop', deps({ readConnectionHealth: async () => null }))).open).toBe(false)
  })
  it('reevaluates gates before loading status or running preflight', async () => {
    let gate: VaultItem['releaseGate'] = 'HELD_PROVIDER_PENDING'
    const calls: string[] = []
    const d = deps({
      reevaluate: async () => { calls.push('reevaluate'); gate = 'HELD_USER' },
      listItems: async () => { calls.push('list'); return [{ ...item('good'), releaseGate: gate }] },
    })
    await releaseStatus('shop', d)
    await preflightRelease('shop', 'owner', d)
    expect(calls).toEqual(['reevaluate', 'list', 'reevaluate', 'list'])
    expect(gate).toBe('HELD_USER')
  })
  it('encodes UUIDs as opaque 22-char tokens without leaking raw UUID strings on naive base64 decode, and decodes back', () => {
    const rawUuid = '123e4567-e89b-12d3-a456-426614174000'
    const ref = releaseRef(rawUuid)
    expect(ref).toHaveLength(22)
    expect(Buffer.from(ref, 'base64url').toString('utf8')).not.toBe(rawUuid)
    expect(decodeReleaseRef(ref)).toBe(rawUuid)
  })
  it('formats account labels and never exposes provider IDs or tokens', async () => {
    const withLabel = deps({
      readConnectionHealth: async () => ({ ...verified, accountLabel: 'my_bakery' }),
    })
    const status = await releaseStatus('shop', withLabel)
    const threadsConn = status.connections.find(c => c.channel === 'threads')
    expect(threadsConn?.account_label).toBe('@my_bakery')

    const preflight = await preflightRelease('shop', 'owner', withLabel)
    expect(preflight.items[0]?.account_label).toBe('@my_bakery')

    // Numeric provider ID or missing label fallbacks to "연결된 계정"
    const withIdOnly = deps({
      readConnectionHealth: async () => ({ ...verified, accountLabel: '17841400234567' }),
    })
    const idPreflight = await preflightRelease('shop', 'owner', withIdOnly)
    expect(idPreflight.items[0]?.account_label).toBe('연결된 계정')
  })
})
