import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VaultQueryService } from '../../../vault/query'
import type { VaultItem } from '../../../vault/types'
import { buildVaultMonitor } from '../monitor'
import { FakeVaultMonitorRepository } from '../repository'
import { VaultMonitorView } from '../vault-monitor-view'

const WS = 'c1557001-0000-4000-8000-000000000001'
const WS_BAD = 'c1557001-0000-4000-8000-000000000002'
const NOW = new Date('2026-10-07T00:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

let seq = 0
function item(over: Partial<VaultItem> = {}): VaultItem {
  seq++
  const n = String(seq).padStart(12, '0')
  return {
    id: `c1557002-0000-4000-8000-${n}`, workspaceId: WS, contentId: `c1557003-0000-4000-8000-${n}`,
    versionId: `c1557004-0000-4000-8000-${n}`, channel: 'instagram',
    releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: daysAgo(1), heldBy: null, targetDate: null,
    approvedFingerprint: 'a'.repeat(64), fingerprintSchemaVersion: 3, policyVersion: 'p', specVersion: 's',
    approvalState: 'APPROVED', approvedBy: null, bundleId: null, idempotencyKey: `k${n}`, deletedAt: null,
    createdAt: daysAgo(1), updatedAt: daysAgo(1), ...over,
  }
}

let repo: FakeVaultMonitorRepository
beforeEach(() => {
  repo = new FakeVaultMonitorRepository()
  repo.workspaces = [{ workspaceId: WS, datasetMode: 'ACTUAL', actorKind: 'CUSTOMER' }]
})

describe('ANI-1557 vault monitor', () => {
  it('reports a real zero when nothing is wrong and records a plain view', async () => {
    repo.seedVaultItems([item()])
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.cards.violations.value).toBe(0)
    expect(r.cards.violations.status).toBe('FRESH')
    expect(repo.accessLog[0]).toMatchObject({ accessKind: 'MONITOR_VIEW', violationCount: 0 })
  })

  it('같은 버전의 다른 채널 게시 요청은 보관 항목 위반으로 잘못 연결하지 않는다', async () => {
    const held = item({ channel: 'threads' })
    repo.seedVaultItems([held])
    repo.links = [{ id: 'other-channel', workspaceId: WS, contentVersionId: held.versionId, channel: 'instagram', status: 'prepared', approvalFingerprint: null }]
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.cards.violations.value).toBe(0)
  })

  it('raises a high alert with the fingerprint and action id chain when an external action is injected', async () => {
    const bad = item({ channel: 'threads' })
    repo.seedVaultItems([bad, item()])
    repo.links = [{ id: 'ea-1', workspaceId: WS, contentVersionId: bad.versionId, channel: bad.channel, status: 'prepared', approvalFingerprint: 'b'.repeat(64) }]
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.cards.violations.value).toBe(1)
    expect(r.violations[0]).toMatchObject({ itemId: bad.id, releaseGate: 'HELD_USER', approvedFingerprint: 'a'.repeat(64) })
    expect(r.violations[0].externalActions[0].id).toBe('ea-1')
    expect(repo.accessLog[0]).toMatchObject({ accessKind: 'INVARIANT_DETAIL_VIEW', disclosedItemIds: [bad.id] })
    const html = renderToStaticMarkup(<VaultMonitorView result={r} />)
    expect(html).toContain('중요 경고')
    expect(html).toContain('ea-1')
  })

  it('withholds fingerprints and ids when the audit record cannot be written, but keeps the count', async () => {
    const bad = item()
    repo.seedVaultItems([bad])
    repo.links = [{ id: 'ea-2', workspaceId: WS, contentVersionId: bad.versionId, channel: bad.channel, status: 'prepared', approvalFingerprint: null }]
    repo.failAudit = true
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.cards.violations.value).toBe(1)
    expect(r.detailsWithheld).toBe(true)
    expect(JSON.stringify(r.violations)).not.toContain('a'.repeat(64))
    expect(JSON.stringify(r.violations)).not.toContain('ea-2')
    expect(renderToStaticMarkup(<VaultMonitorView result={r} />)).not.toContain('ea-2')
  })

  it('lists held items older than N days and neglected invalidated items', async () => {
    repo.seedVaultItems([
      item({ heldAt: daysAgo(20) }),
      item({ heldAt: daysAgo(3) }),
      item({ approvalState: 'INVALIDATED', releaseGate: null, holdReason: null, heldAt: null, approvedFingerprint: null, fingerprintSchemaVersion: null, updatedAt: daysAgo(30) }),
    ])
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW, staleAfterDays: 14 })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.staleHeld.map((x) => x.ageDays)).toEqual([20])
    expect(r.neglectedInvalidated.map((x) => x.ageDays)).toEqual([30])
  })

  it('ERROR is not EMPTY: an unreadable workspace makes totals and the invariant unknown', async () => {
    repo.workspaces.push({ workspaceId: WS_BAD, datasetMode: 'ACTUAL', actorKind: 'CUSTOMER' })
    repo.seedVaultItems([item()])
    repo.failWorkspaceIds.add(WS_BAD)
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.cards.violations.value).toBeNull()
    expect(r.cards.violations.status).toBe('UNKNOWN')
    expect(r.cards.stored.value).toBeNull()
    expect(r.workspaces.find((w) => w.workspaceId === WS_BAD)?.status).toBe('ERROR')
    expect(renderToStaticMarkup(<VaultMonitorView result={r} />)).toContain('확인 전')
  })

  it('returns an error result (not an empty dashboard) when the workspace list fails', async () => {
    repo.simulateFailure = true
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    expect(r.kind).toBe('error')
    expect(renderToStaticMarkup(<VaultMonitorView result={r} />)).toContain('role="alert"')
  })

  it('matches the numbers the user-facing query service reports (contract)', async () => {
    repo.seedVaultItems([
      item({ channel: 'instagram' }), item({ channel: 'threads' }), item({ channel: 'threads', releaseGate: 'HELD_PROVIDER_PENDING', holdReason: 'META_REVIEW_PENDING' }),
      item({ approvalState: 'NEEDS_REAPPROVAL', releaseGate: null, holdReason: null, heldAt: null }),
      item({ approvalState: 'INVALIDATED', releaseGate: null, holdReason: null, heldAt: null, approvedFingerprint: null, fingerprintSchemaVersion: null }),
    ])
    const user = new VaultQueryService(repo)
    const summary = await user.getSummary(WS)
    const threads = await user.listItems(WS, { channel: 'threads', status: 'held' })
    const r = await buildVaultMonitor({ repository: repo, actorId: 'op', now: NOW })
    if (r.kind !== 'ok') throw new Error('expected ok')
    const row = r.workspaces[0]
    expect(row.storedCount).toBe(summary.stored_count)
    expect(row.needsReapprovalCount).toBe(summary.needs_reapproval_count)
    expect(row.invalidatedCount).toBe(summary.invalidated_count)
    expect(row.channelDistribution.find((c) => c.channelLabel === '스레드')?.count).toBe(threads.totalCount)
    expect(row.gates).toMatchObject({ reviewPending: 1, userHeld: 2 })
  })

  it('SupabaseVaultMonitorRepository는 100개 단위 청크로 외부 액션 링크를 안전하게 조회하고 channel을 보존한다', async () => {
    const { SupabaseVaultMonitorRepository } = await import('../repository')
    const calls: string[][] = []
    const fakeDb = {
      from: (table: string) => {
        expect(table).toBe('external_action_requests')
        const q: any = {
          select: () => q,
          eq: () => q,
          in: (_col: string, arr: string[]) => {
            calls.push(arr)
            return Promise.resolve({
              data: arr.map((id) => ({
                id: `ea-${id}`,
                workspace_id: WS,
                content_version_id: id,
                channel: 'threads',
                status: 'prepared',
                approval_fingerprint: null,
              })),
              error: null,
            })
          },
        }
        return q
      },
    }
    const repo = new SupabaseVaultMonitorRepository(fakeDb as any)
    const versionIds = Array.from({ length: 150 }, (_, i) => `v-${i}`)
    const links = await repo.listExternalActionLinks(WS, versionIds)

    expect(calls.length).toBe(2)
    expect(calls[0].length).toBe(100)
    expect(calls[1].length).toBe(50)
    expect(links.length).toBe(150)
    expect(links[0].channel).toBe('threads')
  })

  it('SupabaseVaultMonitorRepository는 listWorkspaces에서 1000행 초과 시 페이지네이션하고 100개 단위 청크로 레지스트리를 조회한다', async () => {
    const { SupabaseVaultMonitorRepository } = await import('../repository')
    const registryCalls: string[][] = []
    const rangeCalls: Array<{ from: number; to: number }> = []

    const fakeDb = {
      from: (table: string) => {
        if (table === 'vault_items') {
          const q: any = {
            select: () => q,
            is: () => q,
            range: (from: number, to: number) => {
              rangeCalls.push({ from, to })
              if (from === 0) {
                // Page 0: 1000 rows, ws-0 to ws-999
                return Promise.resolve({
                  data: Array.from({ length: 1000 }, (_, i) => ({ workspace_id: `ws-${i}` })),
                  error: null,
                })
              }
              // Page 1: 50 rows, ws-1000 to ws-1049
              return Promise.resolve({
                data: Array.from({ length: 50 }, (_, i) => ({ workspace_id: `ws-${1000 + i}` })),
                error: null,
              })
            },
          }
          return q
        }
        if (table === 'workspace_registry') {
          const q: any = {
            select: () => q,
            in: (_col: string, arr: string[]) => {
              registryCalls.push(arr)
              return Promise.resolve({
                data: arr.map((id) => ({
                  workspace_id: id,
                  dataset_mode: 'ACTUAL',
                  actor_kind: 'CUSTOMER',
                })),
                error: null,
              })
            },
          }
          return q
        }
        throw new Error(`Unexpected table ${table}`)
      },
    }

    const repo = new SupabaseVaultMonitorRepository(fakeDb as any)
    const workspaces = await repo.listWorkspaces()

    // 1000개 이상이어서 range 페이지네이션 2회 실행됨
    expect(rangeCalls.length).toBe(2)
    expect(rangeCalls[0]).toEqual({ from: 0, to: 999 })
    expect(rangeCalls[1]).toEqual({ from: 1000, to: 1999 })
    // 총 1050개 고유 워크스페이스
    expect(workspaces.length).toBe(1050)
    // 1050개가 100개 단위로 청크되어 11회 레지스트리 호출됨
    expect(registryCalls.length).toBe(11)
    expect(registryCalls[0].length).toBe(100)
    expect(registryCalls[10].length).toBe(50)
  })
})
