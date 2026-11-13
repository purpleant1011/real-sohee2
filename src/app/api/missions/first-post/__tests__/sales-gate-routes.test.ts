// 기존 gate/CAS 단위 범위. 소비 RPC는 publish-consumption.test와 실제 PG 동시성 suite에서 별도 검증한다.
vi.mock('@/features/publishing/publish-consumption', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/publishing/publish-consumption')>(),
  consumePublishApproval: async () => null,
}))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/publishing/channel-publish-guard', () => ({ findChannelPublishConflict: async () => null }))
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = '2026-10-21T10:00:00Z'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolve: vi.fn(),
  publish: vi.fn(),
  ready: vi.fn(),
  kill: vi.fn(),
  funnel: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: (table: string) => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { version_no: 1, version: 1, status: 'active', is_active: true }, error: null }),
      then: (r: any) => r({ data: table === 'channel_connections'
        ? [{ channel: 'threads', status: 'verified', account_label: 'test-store', provider: 'threads', external_account_id: 'x' }]
        : [], error: null }) }),
  }),
}))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolve }))
vi.mock('@/features/publishing/fact-snapshot-gate', () => ({
  revalidateApprovedFactSnapshot: vi.fn(async () => ({ ok: true, snapshot: { workspaceId, resolvedAt: NOW, facts: [], hash: 'h' } })),
  getDefaultFactSnapshotResolver: vi.fn(() => ({})),
  createWorkspaceFactReader: vi.fn(() => ({})),
}))
vi.mock('@/features/publishing/dual-provider-publish-service', () => ({ executeDualProviderPublish: mocks.publish, retryFailedChannelPublish: vi.fn() }))
vi.mock('@/features/quick-start/first-post-readiness', () => ({ requireFirstPostReady: mocks.ready }))
vi.mock('@/lib/safety/kill-switch-guard', () => ({ checkKillSwitchPreflight: mocks.kill }))
vi.mock('@/lib/safety/meta-live-allowlist', () => ({ isMetaLiveAllowed: vi.fn().mockReturnValue(true) }))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: mocks.funnel }))

let missions: Record<string, any> = {}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    from: (table: string) => {
      if (table !== 'marketing_missions') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ error: null }) }
      return {
        select: () => ({ eq: () => ({ eq: (_c: string, ws: string) => ({ maybeSingle: async () => {
          const m = missions[missionId]
          return { data: m && m.workspace_id === ws ? structuredClone(m) : null, error: null }
        } }) }) }),
        update: (fields: any) => {
          const filters: Record<string, any> = {}
          const b: any = { eq: (c: string, v: any) => { filters[c] = v; return b }, is: () => b,
            select: async () => { const t = missions[filters.id]; if (!t || (filters.status && t.status !== filters.status)) return { data: [], error: null }; Object.assign(t, fields); return { data: [structuredClone(t)], error: null } } }
          return b
        },
      }
    },
  }),
}))

import { POST as approveRoute } from '../approve/route'
import { POST as publishRoute } from '../publish/route'

const payload = {
  workspaceId, missionId, channels: [{ provider: 'threads', handle: 'test-store' }],
  copies: { instagram: { caption: '확인한 가격 40,000원' }, threads: { content: '확인한 가격 40,000원' } },
  imageIds: [], boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
  rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
}
const policy = { workspaceId, serviceId: 'service-1', version: 'policy-1', minPriceKrw: 40000, maxDiscountBps: 2000, maxDiscountCases: 5, allowedChannels: ['THREADS'], perActionBudgetKrw: 2000, periodBudgetKrw: 10000, validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z', confirmedBy: 'owner', evidenceRef: 'policy-proof' }
const proposal = { workspaceId, serviceId: 'service-1', policyVersion: 'policy-1', catalogVersion: 'catalog-1', channel: 'THREADS', purpose: 'PUBLIC_PROMOTION', servicePriceKrw: 50000, offerPriceKrw: 45000, discountCaseCount: 1, quotedCostKrw: 1000, costQuoteRef: 'q', costQuoteObservedAt: '2026-10-21T09:55:00Z', costQuoteValidUntil: '2026-10-21T23:00:00Z', contentRevision: 'draft-1', content: '확인한 가격 40,000원', recipientRefs: [], mediaRefs: ['img-1'], expiresAt: '2026-10-21T23:59:00Z' }
const facts = { workspaceId, serviceId: 'service-1', version: 'catalog-1', status: 'VERIFIED', priceKrw: 50000, observedAt: '2026-10-21T09:50:00Z', validUntil: '2026-10-22T00:00:00Z', evidenceRef: 'price-proof' }
const usage = { workspaceId, serviceId: 'service-1', policyVersion: 'policy-1', status: 'CURRENT', windowStart: policy.validFrom, windowEnd: policy.validUntil, observedAt: '2026-10-21T09:59:00Z', validUntil: '2026-10-22T00:00:00Z', discountCasesUsed: 0, discountCasesReserved: 0, budgetSpentKrw: 0, budgetReservedKrw: 0, evidenceRef: 'usage-proof' }
const policyInput = (offerPriceKrw: number) => ({ policy, proposal: { ...proposal, offerPriceKrw }, facts, usage, consents: { status: 'OK', events: [] } })
const dest = { kind: 'BOOKING_URL', href: 'https://example.com/shop/a', label: '예약', evidenceSource: 'OWNER_CONFIRMATION', networkVerified: false, revision: 1 }

function request(body: unknown) { return new Request('http://localhost/api/missions/first-post/approve', { method: 'POST', body: JSON.stringify(body) }) }
function mission(over: Record<string, any> = {}) {
  return { id: missionId, workspace_id: workspaceId, status: 'AWAITING_APPROVAL', updated_at: '2026-10-21T00:00:00.000Z',
    metadata: { payload: structuredClone(payload), ...over } }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) })
  missions = {}
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'o@example.com' } } })
  mocks.resolve.mockResolvedValue({ success: true, workspaceId, role: 'owner' })
  mocks.ready.mockResolvedValue({})
  mocks.kill.mockResolvedValue({ blocked: false })
  mocks.funnel.mockResolvedValue({})
  mocks.publish.mockResolvedValue({ success: true })
})
afterEach(() => { vi.useRealTimers() })

describe('ANI-1627/1630 on the real first-post approve/publish path', () => {
  it('approve blocks a 35,000원 offer under the 40,000원 minimum and shows the reason to the owner', async () => {
    missions[missionId] = mission({ salesGate: { policyInput: policyInput(35000) } })
    const res = await approveRoute(request({ missionId, fingerprint: calculateApprovalFingerprint(payload), isExplicitlyApproved: true, explicitPhrase: '이 버전 승인하고 발행' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('SERVICE_POLICY_BLOCKED')
    expect(body.error).toContain('최저 가격')
    expect(missions[missionId].status).toBe('AWAITING_APPROVAL')
  })
  it('approve blocks when the CTA destination is not confirmed, before any state change', async () => {
    missions[missionId] = mission({ salesGate: { cta: { destination: null } } })
    const res = await approveRoute(request({ missionId, fingerprint: calculateApprovalFingerprint(payload), isExplicitlyApproved: true, explicitPhrase: '이 버전 승인하고 발행' }))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('CTA_DESTINATION_BLOCKED')
    expect(missions[missionId].status).toBe('AWAITING_APPROVAL')
  })
  it('approve succeeds within policy and reports the gate result', async () => {
    missions[missionId] = mission({ salesGate: { policyInput: policyInput(45000), cta: { destination: dest } } })
    const res = await approveRoute(request({ missionId, fingerprint: calculateApprovalFingerprint(payload), isExplicitlyApproved: true, explicitPhrase: '이 버전 승인하고 발행' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.salesGate.status).toBe('WARN') // portal never observed -> honest warning, not a pass
    expect(missions[missionId].status).toBe('APPROVED')
  })
  it('publish re-checks the gate and never calls the provider when blocked', async () => {
    const fingerprint = calculateApprovalFingerprint(payload)
    missions[missionId] = { id: missionId, workspace_id: workspaceId, status: 'APPROVED', updated_at: '2026-10-21T00:00:00.000Z',
      metadata: { payload: structuredClone(payload), approvedMission: { missionId, approvedFingerprint: fingerprint }, salesGate: { policyInput: policyInput(35000) } } }
    const res = await publishRoute(request({ missionId }))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('SERVICE_POLICY_BLOCKED')
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(missions[missionId].status).toBe('APPROVED')
  })
  it('publish proceeds when the gate passes', async () => {
    const fingerprint = calculateApprovalFingerprint(payload)
    missions[missionId] = { id: missionId, workspace_id: workspaceId, status: 'APPROVED', updated_at: '2026-10-21T00:00:00.000Z',
      metadata: { payload: structuredClone(payload), approvedMission: { missionId, approvedFingerprint: fingerprint }, salesGate: { policyInput: policyInput(45000) } } }
    const res = await publishRoute(request({ missionId }))
    expect(res.status).not.toBe(422)
    expect(mocks.publish).toHaveBeenCalled()
  })
})
