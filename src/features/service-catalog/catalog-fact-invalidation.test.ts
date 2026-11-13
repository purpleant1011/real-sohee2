/**
 * ANI-1609 (c) — call-path integration: editing the service catalog must make an already-approved
 * draft ask the owner to look again, using the EXISTING Fact snapshot machinery (no new system).
 *
 * Real code under test: createCatalogActor's fact adapter (createApprovedFactWriter) → catalog-service
 * → resolveApprovedFacts / assessFactSnapshotCurrent (the same functions quick-post uses).
 * Only the persistence layer of facts-service is replaced, and it mirrors the real semantics:
 * create = new active fact, update = supersede the old one and insert a successor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assessFactSnapshotCurrent,
  resolveApprovedFacts,
  type ApprovedFactRow,
} from '@/features/knowledge/approved-fact-resolver'
import { createApprovedFactWriter } from './fact-writer'
import { updateCatalogService, createCatalogService, type CatalogGateway, type CatalogRow } from './catalog-service'

const WS = '11111111-1111-4111-8111-111111111111'
const SVC = '33333333-3333-4333-8333-333333333333'
const USER = 'aaaaaaaa-1111-4111-8111-111111111111'
const T0 = '2026-10-22T09:00:00.000Z'
const T1 = '2026-10-22T10:00:00.000Z'
const T2 = '2026-10-22T11:00:00.000Z'
const T3 = '2026-10-22T12:00:00.000Z'

// --- in-memory knowledge store, shaped like public.knowledge_facts -------------------------------
let facts: ApprovedFactRow[] = []
let nextId = 1
// Lets a test advance the clock so a superseded revision has valid_from < valid_until.
let clock = '2026-10-22T10:00:00.000Z'
function activeFact(content: string, at: string, supersedes: string | null = null): ApprovedFactRow {
  const id = `fact-${String(nextId++).padStart(4, '0')}`
  return {
    id, workspace_id: WS, category: 'MENU', content, status: 'active',
    source_candidate_id: `cand-${id}`, approved_by_user_id: USER, approved_at: at,
    valid_from: at, valid_until: null, supersedes_fact_id: supersedes, created_at: at,
  }
}

vi.mock('@/features/sohee-knowledge/facts-service', () => ({
  async createCustomFact(input: { content: string }) {
    const fact = activeFact(input.content, clock)
    facts.push(fact)
    return { id: fact.id, category: fact.category, content: fact.content, createdAt: fact.created_at, source: 'manual' }
  },
  async updateFactContent(input: { factId: string; content: string }) {
    // Mirrors facts-service.updateFactContent: supersede the old revision, then add the successor.
    const old = facts.find((row) => row.id === input.factId)
    if (!old) throw new Error('Fact not found')
    old.status = 'superseded'
    old.valid_until = clock
    const fact = activeFact(input.content, clock, old.id)
    facts.push(fact)
    return { id: fact.id, category: fact.category, content: fact.content, createdAt: fact.created_at, source: 'manual' }
  },
  // Mirrors facts-service.findFactByContent: newest fact with that exact content, any status.
  async findFactByContent(input: { workspaceId: string; category: string; content: string }) {
    const matches = facts
      .filter((row) => row.workspace_id === input.workspaceId && row.category === input.category && row.content === input.content)
      .sort((a, b) => Date.parse(b.approved_at) - Date.parse(a.approved_at))
    return matches[0] ? { id: matches[0].id } : null
  },
}))

const row = (patch: Partial<CatalogRow> = {}): CatalogRow => ({
  id: SVC, workspace_id: WS, name: '속눈썹 연장', price: 45000, duration_minutes: 90,
  resource_name: '원장', cancellation_policy: null, valid_from: null, valid_until: null,
  active: true, updated_at: '2026-10-20T00:00:00.000Z', knowledge_fact_id: null, ...patch,
})

/**
 * One mutable row behind the gateway, so the service↔fact link is whatever the previous save
 * actually wrote. The earlier version injected `knowledge_fact_id` by hand, which is precisely
 * why the missing link write was never caught.
 */
function gateway(initial: CatalogRow = row()) {
  let current = initial
  let version = 0
  const nextVersion = () => `2026-10-2${++version}T00:00:00.000Z`

  return {
    list: vi.fn().mockImplementation(async () => ({ data: [current], error: null })),
    find: vi.fn().mockImplementation(async () => ({ data: current, error: null })),
    insert: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      current = { ...current, ...payload, updated_at: nextVersion() } as CatalogRow
      return { data: current, error: null }
    }),
    update: vi.fn().mockImplementation(async (_ws: string, _id: string, expected: string, patch: Record<string, unknown>) => {
      if (current.updated_at !== expected) return { data: null, error: { code: 'CATALOG_CONFLICT' } }
      current = { ...current, ...patch, updated_at: nextVersion() } as CatalogRow
      return { data: current, error: null }
    }),
    setFactLink: vi.fn().mockImplementation(async (_ws: string, _id: string, expected: string, factId: string) => {
      if (current.updated_at !== expected) return { data: null, error: { code: 'CATALOG_CONFLICT' } }
      current = { ...current, knowledge_fact_id: factId }
      return { data: current, error: null }
    }),
    countStaleSlots: vi.fn().mockResolvedValue({ count: 0, error: null }),
    read: () => current,
  } as CatalogGateway & { read: () => CatalogRow }
}

const actorFor = (gw: CatalogGateway) => ({
  gateway: gw, facts: createApprovedFactWriter(USER), workspaceId: WS, role: 'owner' as const,
})

const snapshotAt = (at: string) => resolveApprovedFacts({ workspaceId: WS, at, rows: facts })

beforeEach(() => {
  facts = []
  nextId = 1
  clock = T1
})

describe('카탈로그 수정 → 기존 승인 초안 재확인', () => {
  it('가격을 바꾸면 이미 승인된 초안의 사실 스냅샷이 FACTS_CHANGED로 무효화된다', async () => {
    // 1) Owner saves the catalog once: this is the fact an approved draft was built on.
    const gw = gateway()
    const actor = actorFor(gw)
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 })
    expect(facts).toHaveLength(1)

    // 2) The draft's approved snapshot was captured at T0 (the fact exists from T0 in this timeline).
    facts[0].approved_at = T0
    facts[0].valid_from = T0
    const approvedSnapshot = snapshotAt(T0)
    expect(approvedSnapshot.facts.map((fact) => fact.content)).toEqual(['속눈썹 연장 — 45,000원 · 90분'])

    // 3) Owner edits the price later; the catalog service must supersede the old fact, not fork a new claim.
    //    No injected knowledge_fact_id: the create above had to write the link for this to reach `update`.
    const result = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, price: 52000,
    }, T1)
    expect(result.factSync.status).toBe('SYNCED')
    expect(facts[0].status).toBe('superseded')

    // 4) The quick-post path compares the draft's snapshot with the current one → owner must review.
    const assessment = assessFactSnapshotCurrent(approvedSnapshot, snapshotAt(T1))
    expect(assessment).toEqual({ state: 'REVIEW_REQUIRED', requiresOwnerReview: true, reason: 'FACTS_CHANGED' })
  })

  it('가격을 두 번 바꿔도 active 사실은 1건이고 옛 가격이 스냅샷에 남지 않는다', async () => {
    const gw = gateway()
    const actor = actorFor(gw)
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 })
    clock = T2
    await updateCatalogService(actor, SVC, { expectedUpdatedAt: gw.read().updated_at, price: 52000 }, T2)
    clock = T3
    await updateCatalogService(actor, SVC, { expectedUpdatedAt: gw.read().updated_at, price: 61000 }, T3)

    expect(facts.filter((fact) => fact.status === 'active')).toHaveLength(1)
    expect(facts.map((fact) => fact.status)).toEqual(['superseded', 'superseded', 'active'])
    expect(facts[2].supersedes_fact_id).toBe(facts[1].id)
    expect(snapshotAt(T3).facts.map((fact) => fact.content)).toEqual(['속눈썹 연장 — 61,000원 · 90분'])
  })

  it('아무것도 바꾸지 않았으면 초안을 다시 확인시키지 않는다(거짓 무효화 금지)', async () => {
    const gw = gateway()
    const actor = actorFor(gw)
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 })
    facts[0].approved_at = T0
    facts[0].valid_from = T0
    const approvedSnapshot = snapshotAt(T0)

    // Only a non-fact field (cancellation rule) changes, so the mirrored fact content stays identical.
    const result = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, cancellationPolicy: '24시간 전까지 무료',
    }, T1)
    // Nothing fact-bearing changed, so the fact is not rewritten at all.
    expect(result.factSync).toEqual({ status: 'SKIPPED_UNCHANGED' })
    expect(facts).toHaveLength(1)
    expect(assessFactSnapshotCurrent(approvedSnapshot, snapshotAt(T1))).toEqual({
      state: 'CURRENT', requiresOwnerReview: false,
    })
  })

  it('소요시간이 비어 있어 사실을 못 남기면 초안은 그대로 유효하다', async () => {
    const gw = gateway()
    const actor = actorFor(gw)
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 })
    facts[0].approved_at = T0
    facts[0].valid_from = T0
    const approvedSnapshot = snapshotAt(T0)

    const result = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, durationMinutes: null,
    }, T1)
    expect(result.factSync.status).toBe('SKIPPED_INCOMPLETE')
    expect(result.service.readiness.missing).toContain('DURATION')
    expect(assessFactSnapshotCurrent(approvedSnapshot, snapshotAt(T1)).state).toBe('CURRENT')
  })

  it('적용일이 미래면 사실을 지금 덮지 않으므로 초안도 흔들지 않는다(ANI-1601 적용일 흐름)', async () => {
    const gw = gateway()
    const actor = actorFor(gw)
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 })
    facts[0].approved_at = T0
    facts[0].valid_from = T0
    const approvedSnapshot = snapshotAt(T0)

    const result = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, price: 52000, validFrom: '2026-11-01T00:00:00+09:00',
    }, T1)
    expect(result.factSync).toEqual({ status: 'SKIPPED_FUTURE_EFFECTIVE_DATE', effectiveFrom: '2026-11-01T00:00:00+09:00' })
    expect(assessFactSnapshotCurrent(approvedSnapshot, snapshotAt(T1)).state).toBe('CURRENT')

    // The applied-date switch itself (ANI-1601) is out of scope here: at the effective date the owner's
    // approved fact still carries the old price until that flow publishes the new revision.
    expect(snapshotAt('2026-11-02T00:00:00+09:00').facts.map((fact) => fact.content))
      .toEqual(['속눈썹 연장 — 45,000원 · 90분'])
  })

  it('다른 사업장 사실이 섞이면 조용히 걸러내지 않고 스냅샷을 만들지 않는다(fail-closed)', async () => {
    await createCatalogService(actorFor(gateway(row())), { name: '속눈썹 연장', price: 45000, durationMinutes: 90 })
    facts[0].approved_at = T0
    facts[0].valid_from = T0
    const foreign = { ...activeFact('B 사업장 컷 — 40,000원 · 90분', T0), workspace_id: '22222222-2222-4222-8222-222222222222' }
    facts.push(foreign)

    // resolveApprovedFacts refuses a mixed set (FACT_WORKSPACE_MISMATCH) rather than silently dropping rows;
    // in production loadApprovedFactSnapshot filters by workspace_id, so a foreign row cannot arrive.
    expect(() => snapshotAt(T0)).toThrow('FACT_WORKSPACE_MISMATCH')
    expect(facts.filter((fact) => fact.workspace_id === WS)).toHaveLength(1)
  })
})
