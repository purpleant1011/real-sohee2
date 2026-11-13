import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { applyVaultEdit, affectedImageChannels, isReleaseCandidate, restorationDeadline, type VaultEditRepository } from './index'
import { toUserVaultItemDto } from '../query/formatters'
import type { VaultItem, VaultVariantPayload, VaultEvent } from '../types'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const media = (s: string) => ({ position: 0, type: 'image' as const, mimeType: 'image/jpeg', sizeBytes: 100, renditionContentDigest: digest(s) })
const ws = uuid(1)
const actor = uuid(2)
function fake() {
  const items = new Map<string, VaultItem>()
  const payloads = new Map<string, VaultVariantPayload>()
  const events: VaultEvent[] = []
  function add(n: number, channel: VaultItem['channel'], withImage = true) {
    const id = uuid(n)
    const item: VaultItem = { id, workspaceId: ws, contentId: uuid(20), versionId: uuid(21), channel, releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: '2026-10-07T00:00:00Z', heldBy: actor, targetDate: null, approvedFingerprint: digest(`approval-${n}`), fingerprintSchemaVersion: 3, policyVersion: 'vault-save-v1', specVersion: 'old', approvalState: 'APPROVED', approvedBy: actor, bundleId: null, idempotencyKey: String(n), deletedAt: null, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }
    const payload: VaultVariantPayload = { id: uuid(n + 100), workspaceId: ws, vaultItemId: id, payload: { title: '제목', text: '본문', hashtags: ['태그'], media: withImage ? [media('old')] : [], settings: { approved_target_account_id: 'account', approved_policy_versions: { 'vault-save': 'vault-save-v1' }, category: null, visibility: 'PUBLIC', coupon: null }, targetAccountId: 'account', textBlockRenderSpec: { channel, blocks: [{ type: 'body', text: '본문' }], digest: digest(JSON.stringify(['body', channel, '본문'])) } }, previewArtifacts: {}, createdAt: item.createdAt, updatedAt: item.updatedAt }
    items.set(id, item); payloads.set(id, payload)
    return item
  }
  const repository: VaultEditRepository = {
    async getItem(w, id) { return w === ws ? items.get(id) ?? null : null },
    async getPayload(w, id) { return w === ws ? payloads.get(id) ?? null : null },
    async listImageCandidates(w) { return w === ws ? [...items.values()] : [] },
    async changeMany(w, mutations) {
      if (w !== ws || mutations.some(m => items.get(m.item.id)?.updatedAt !== m.expectedVersion)) return null
      const versions: Record<string, string> = {}
      for (const { item, changes, payload, event } of mutations) {
        const current = items.get(item.id)!
        items.set(item.id, { ...current, ...changes, updatedAt: new Date(Date.parse(current.updatedAt) + 1000).toISOString() })
        versions[item.id] = items.get(item.id)!.updatedAt
        if (payload) payloads.set(item.id, { ...payloads.get(item.id)!, payload })
        events.push({ id: uuid(999), workspaceId: ws, vaultItemId: item.id, actorId: actor, occurredAt: new Date().toISOString(), eventType: event.eventType, payload: event.payload })
      }
      return versions
    },
  }
  return { add, items, payloads, events, repository }
}
const ref = (item: VaultItem) => toUserVaultItemDto(item).item_ref
const run = async (repo: VaultEditRepository, item: VaultItem, operation: Parameters<typeof applyVaultEdit>[1]['operation'], changes?: Parameters<typeof applyVaultEdit>[1]['changes']) => applyVaultEdit(repo, { workspaceId: ws, actorId: actor, itemRef: ref(item), operation, changes, expectedVersion: (await repo.getItem(ws, item.id))?.updatedAt ?? item.updatedAt, now: new Date('2026-10-07T12:00:00Z') })

describe('vault edit rules', () => {
  it('treats the same instant in RPC (Z) and PostgREST (+00:00) renderings as one version', async () => {
    const f = fake(); const a = f.add(3, 'threads', false)
    f.items.set(a.id, { ...f.items.get(a.id)!, updatedAt: '2026-10-07T01:02:03.12+00:00' })
    const input = (expectedVersion: string) => ({ workspaceId: ws, actorId: actor, itemRef: ref(a), operation: 'hold' as const, expectedVersion, now: new Date() })
    await expect(applyVaultEdit({ ...f.repository, changeMany: async () => ({ [a.id]: '2026-10-07T01:02:04.000000Z' }) }, input('2026-10-07T01:02:03.120000Z'))).resolves.toMatchObject({ updated_at: '2026-10-07T01:02:04.000000Z' })
    await expect(applyVaultEdit(f.repository, input('2026-10-07T01:02:03.121000Z'))).rejects.toMatchObject({ status: 409 })
  })
  it('rejects an old tab version before any operation and retains payload and event; retry with latest works', async () => {
    const f = fake(); const a = f.add(3, 'threads', false)
    const input = (operation: Parameters<typeof applyVaultEdit>[1]['operation'], expectedVersion: string) => ({ workspaceId: ws, actorId: actor, itemRef: ref(a), operation, changes: { text: '두 번째 탭' }, expectedVersion, now: new Date() })
    await applyVaultEdit(f.repository, { ...input('edit', a.updatedAt), changes: { text: '첫 번째 탭' } })
    const latest = f.items.get(a.id)!.updatedAt
    expect(latest).not.toBe(a.updatedAt)
    for (const operation of ['edit', 'replace_shared_image', 'reapprove', 'hold', 'resume', 'delete', 'restore'] as const) {
      await expect(applyVaultEdit(f.repository, input(operation, a.updatedAt))).rejects.toMatchObject({ status: 409, message: '보관 항목이 다른 곳에서 변경됐어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.' })
    }
    expect(f.events).toHaveLength(1)
    expect(f.payloads.get(a.id)!.payload.text).toBe('첫 번째 탭')
    await applyVaultEdit(f.repository, input('edit', latest))
    expect(f.payloads.get(a.id)!.payload.text).toBe('두 번째 탭')
    expect(f.events).toHaveLength(2)
  })
  it('returns the committed version, not a later tab write observed during response reread', async () => {
    const f = fake(); const a = f.add(3, 'threads', false)
    const originalChange = f.repository.changeMany
    f.repository.changeMany = async (workspace, mutations) => {
      const result = await originalChange(workspace, mutations)
      if (result) f.items.set(a.id, { ...f.items.get(a.id)!, updatedAt: '2026-10-07T00:00:03.000Z' })
      return result
    }
    const result = await applyVaultEdit(f.repository, { workspaceId: ws, actorId: actor, itemRef: ref(a), expectedVersion: a.updatedAt, operation: 'hold', now: new Date() })
    expect(result.updated_at).toBe('2026-10-07T00:00:01.000Z')
  })
  it('allows exactly one of two simultaneous edits with the same version', async () => {
    const f = fake(); const a = f.add(3, 'threads', false)
    const input = (text: string) => ({ workspaceId: ws, actorId: actor, itemRef: ref(a), expectedVersion: a.updatedAt, operation: 'edit' as const, changes: { text }, now: new Date() })
    const results = await Promise.allSettled([applyVaultEdit(f.repository, input('가')), applyVaultEdit(f.repository, input('나'))])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.status)).toEqual([409])
    expect(f.events).toHaveLength(1)
  })
  it('invalidates only the text-edited variant and audits its previous approved fingerprint', async () => {
    const f = fake(); const a = f.add(3, 'instagram'); const b = f.add(4, 'threads')
    await run(f.repository, a, 'edit', { text: '본문!' })
    expect(f.items.get(a.id)?.approvalState).toBe('INVALIDATED')
    expect(f.items.get(b.id)?.approvalState).toBe('APPROVED')
    expect(f.events[0].eventType).toBe('approval_invalidated')
    expect(f.events[0].payload.previousApprovedFingerprint).toBe(a.approvedFingerprint)
    expect(f.items.get(a.id)?.approvedFingerprint).toBeNull()
    expect(isReleaseCandidate(f.items.get(a.id)!)).toBe(false)
  })
  it('invalidates image-using siblings but not text-only variants', async () => {
    const f = fake(); const a = f.add(3, 'instagram'); const b = f.add(4, 'naver_blog'); const c = f.add(5, 'threads', false)
    expect(affectedImageChannels([a, b, c], id => f.payloads.get(id)!.payload, digest('old'))).toEqual(['instagram', 'naver_blog'])
    await run(f.repository, a, 'replace_shared_image', { image: { oldDigest: digest('old'), replacement: media('new') } })
    expect(f.items.get(a.id)?.approvalState).toBe('INVALIDATED')
    expect(f.items.get(b.id)?.approvalState).toBe('INVALIDATED')
    expect(f.items.get(c.id)?.approvalState).toBe('APPROVED')
  })
  it('keeps approval for date-only changes; reapproves changed or policy-stale content after spec checks', async () => {
    const f = fake(); const a = f.add(3, 'instagram')
    await run(f.repository, a, 'edit', { targetDate: '2026-10-08' })
    expect(f.items.get(a.id)?.approvedFingerprint).toBe(a.approvedFingerprint)
    expect(f.items.get(a.id)?.approvalState).toBe('APPROVED')
    await run(f.repository, a, 'edit', { text: '수정' })
    await run(f.repository, a, 'reapprove')
    expect(f.items.get(a.id)?.approvalState).toBe('APPROVED')
    expect(f.items.get(a.id)?.approvedFingerprint).toMatch(/^[a-f0-9]{64}$/)
    f.items.set(a.id, { ...f.items.get(a.id)!, approvalState: 'NEEDS_REAPPROVAL' })
    await run(f.repository, f.items.get(a.id)!, 'reapprove')
    expect(f.items.get(a.id)?.approvalState).toBe('APPROVED')
  })
  it('holds, resumes, soft-deletes and restores before day 30; blocks deleted release candidates', async () => {
    const f = fake(); const a = f.add(3, 'threads', false)
    await run(f.repository, a, 'hold')
    expect(isReleaseCandidate(f.items.get(a.id)!)).toBe(true)
    await run(f.repository, a, 'resume')
    expect(f.items.get(a.id)?.releaseGate).toBe('HELD_USER')
    await run(f.repository, a, 'delete')
    expect(isReleaseCandidate(f.items.get(a.id)!)).toBe(false)
    expect(restorationDeadline(f.items.get(a.id)!.deletedAt!)).toBe('2026-11-06T12:00:00.000Z')
    await run(f.repository, a, 'restore')
    expect(f.items.get(a.id)?.deletedAt).toBeNull()
    await run(f.repository, a, 'delete')
    await expect(applyVaultEdit(f.repository, { workspaceId: ws, actorId: actor, itemRef: ref(a), operation: 'restore', expectedVersion: f.items.get(a.id)!.updatedAt, now: new Date('2026-11-06T12:00:00Z') })).rejects.toMatchObject({ status: 409 })
  })
  it('rejects malformed refs, stale writes, failed specifications and missing data without exposing identifiers', async () => {
    const f = fake(); const a = f.add(3, 'threads', false)
    await expect(applyVaultEdit(f.repository, { workspaceId: ws, actorId: actor, itemRef: 'oops', operation: 'hold', expectedVersion: a.updatedAt, now: new Date() })).rejects.toMatchObject({ status: 422 })
    await expect(run(f.repository, a, 'edit', { text: 'x'.repeat(1000) })).resolves.toMatchObject({ status_label: '재승인 필요' })
    await expect(run(f.repository, a, 'reapprove')).rejects.toMatchObject({ status: 422 })
    expect(f.items.get(a.id)?.approvalState).toBe('INVALIDATED')
    expect(isReleaseCandidate({ ...a, approvalState: 'NEEDS_REAPPROVAL' })).toBe(false)
    const prior = f.items.get(a.id)!
    f.repository.changeMany = async () => null
    await expect(run(f.repository, prior, 'hold')).rejects.toMatchObject({ status: 409 })
  })
})

describe('B-2 서비스 계층 역할 이중 검사', () => {
  it.each(['viewer', 'reviewer'] as const)('%s는 승인·수정·삭제 어느 것도 못 하고 아무것도 쓰지 않는다', async role => {
    const f = fake()
    const item = f.add(10, 'instagram')
    for (const operation of ['reapprove', 'edit', 'delete', 'hold'] as const) {
      await expect(applyVaultEdit(f.repository, { workspaceId: ws, actorId: actor, actorRole: role, itemRef: ref(item), operation, expectedVersion: item.updatedAt, now: new Date('2026-10-07T12:00:00Z') })).rejects.toMatchObject({ status: 403, message: '이 작업은 매장 관리자만 할 수 있어요.' })
    }
    expect(f.events).toHaveLength(0)
  })
})

describe('C-1 reapprove snapshot & fingerprint refresh', () => {
  it('reapprove는 현재 페이로드 스냅샷과 지문을 원자적으로 갱신하여 changeMany에 페이로드를 전달한다', async () => {
    const f = fake()
    const a = f.add(20, 'instagram')
    // 기존 페이로드에 오래된 정책 버전 설정
    f.payloads.set(a.id, {
      ...f.payloads.get(a.id)!,
      payload: {
        ...f.payloads.get(a.id)!.payload,
        settings: {
          ...(f.payloads.get(a.id)!.payload.settings as any),
          approved_policy_versions: { 'channel-spec': 'stale-spec-v0', 'vault-save': 'stale-vault-v0' },
        },
      },
    })

    let committedPayload: Record<string, any> | null = null
    const origChangeMany = f.repository.changeMany
    f.repository.changeMany = async (w, mutations) => {
      committedPayload = mutations[0]?.payload
      return origChangeMany(w, mutations)
    }

    await run(f.repository, a, 'reapprove')
    expect(committedPayload).not.toBeNull()
    const resultPayload = committedPayload as unknown as Record<string, any>
    expect((resultPayload.settings as any)?.approved_policy_versions?.['vault-save']).toBe('vault-save-v1')
    expect((resultPayload.settings as any)?.approved_policy_versions?.['channel-spec']).toBeDefined()
    expect((resultPayload.settings as any)?.approved_policy_versions?.['channel-spec']).not.toBe('stale-spec-v0')
    // 페이로드 저장소도 실제로 갱신되었는지 확인
    const refreshed = await f.repository.getPayload(ws, a.id)
    expect((refreshed?.payload.settings as any)?.approved_policy_versions?.['vault-save']).toBe('vault-save-v1')
  })
})

describe('C-3 resume operation restores valid held gate', () => {
  it('resume은 releaseGate를 null로 지우지 않고 유효한 보류 게이트(HELD_USER)로 복원한다', async () => {
    const f = fake()
    const a = f.add(30, 'threads', false)
    await run(f.repository, a, 'hold')
    expect(f.items.get(a.id)?.releaseGate).toBe('HELD_USER')

    await run(f.repository, a, 'resume')
    const resumed = f.items.get(a.id)!
    expect(resumed.releaseGate).not.toBeNull()
    expect(resumed.releaseGate).toBe('HELD_USER')
    expect(resumed.holdReason).toBe('USER_HELD')
    expect(resumed.heldAt).toBeTruthy()
    expect(isReleaseCandidate(resumed)).toBe(true)
  })
})
