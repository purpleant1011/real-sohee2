import { describe, expect, it } from 'vitest'
import { marketingStrategyFixture as brief } from '@/features/content/blog-strategy-brief.fixture'
import { loadConversationMarketingStrategy, approveConversationMarketingStrategy } from './conversation-marketing-strategy'

const scope = { workspaceId: brief.workspaceId, threadId: brief.lineage.conversationId,
  missionId: brief.lineage.missionId, runId: brief.lineage.runId }

// Database boundary double: filters and compare-and-swap are applied, not ignored.
function database() {
  const rows: Record<string, Record<string, unknown>[]> = {
    workspace_registry: [{ workspace_id: scope.workspaceId, dataset_mode: 'ACTUAL' }],
    conversation_threads: [{ id: scope.threadId, workspace_id: scope.workspaceId, status: 'active' }],
    marketing_missions: [{ id: scope.missionId, workspace_id: scope.workspaceId, source_conversation_job_id: scope.runId, status: 'PRODUCING' }],
    conversation_jobs: [{ id: scope.runId, workspace_id: scope.workspaceId, thread_id: scope.threadId, status: 'running',
      plan_data: { unrelated: 'keep', marketing_strategy: { brief, goalVersion: 3, approvedBy: brief.id, approvedAt: '2026-10-28T00:00:00Z' } } }],
    sohee_goals: [{ id: brief.businessGoal.id, workspace_id: scope.workspaceId, status: 'active', version: 3, desired_outcome: brief.businessGoal.description }],
    workspace_members: [{ workspace_id: scope.workspaceId, user_id: brief.id, status: 'active', role: 'owner' }],
  }
  let writes = 0
  let failTable = ''
  let conflict = false
  const client = { from(table: string) {
    const filters: [string, unknown][] = []
    let update: Record<string, unknown> | undefined
    const query = {
      select() { return query },
      eq(key: string, value: unknown) { filters.push([key, value]); return query },
      update(value: Record<string, unknown>) {
        if (conflict && table === 'conversation_jobs') rows.conversation_jobs[0].plan_data = { changedByOtherWorker: true }
        update = value; return query
      },
      async maybeSingle() {
        if (table === failTable) return { data: null, error: { message: 'offline' } }
        const row = rows[table]?.find((item) => filters.every(([key, value]) =>
          key === 'plan_data' ? JSON.stringify(item[key]) === value : item[key] === value))
        if (row && update) { Object.assign(row, update); writes++ }
        return { data: row ?? null, error: null }
      },
    }
    return query
  } }
  return { rows, client: client as never, writes: () => writes, fail(table: string) { failTable = table },
    conflict() { conflict = true } }
}

const reference = { ...scope, briefId: brief.id, revision: 2 }

describe('persisted conversation marketing strategy', () => {
  it('loads approved goal/questions from the scoped canonical run without creating a mission', async () => {
    const db = database()
    const result = await loadConversationMarketingStrategy({ client: db.client, ...reference })
    expect(result.brief).toEqual(brief)
    expect(result.lineage).toEqual(brief.lineage)
    expect(db.writes()).toBe(0)
  })

  it.each([
    ['foreign mission', 'marketing_missions', 'workspace_id', brief.id],
    ['unrelated mission run', 'marketing_missions', 'source_conversation_job_id', brief.id],
    ['foreign thread run', 'conversation_jobs', 'thread_id', brief.id],
    ['cancelled run', 'conversation_jobs', 'status', 'cancelled'],
    ['stopped mission', 'marketing_missions', 'status', 'CANCELLED'],
    ['archived thread', 'conversation_threads', 'status', 'archived'],
    ['stale goal', 'sohee_goals', 'version', 4],
    ['inactive goal', 'sohee_goals', 'status', 'archived'],
    ['wrong dataset', 'workspace_registry', 'dataset_mode', 'TEST'],
  ])('rejects %s', async (_name, table, key, value) => {
    const db = database()
    db.rows[table][0][key] = value
    await expect(loadConversationMarketingStrategy({ client: db.client, ...reference })).rejects.toThrow('MARKETING_STRATEGY')
    expect(db.writes()).toBe(0)
  })

  it('rejects a stale brief revision and missing database evidence', async () => {
    const db = database()
    await expect(loadConversationMarketingStrategy({ client: db.client, ...reference, revision: 1 })).rejects.toThrow('MARKETING_STRATEGY')
    db.fail('conversation_jobs')
    await expect(loadConversationMarketingStrategy({ client: db.client, ...reference })).rejects.toThrow('MARKETING_STRATEGY')
  })

  it('persists an explicit owner approval, preserves the run plan, and reads it back', async () => {
    const db = database()
    const result = await approveConversationMarketingStrategy({ client: db.client, ...scope, userId: brief.id,
      expectedRevision: 2, brief, now: '2026-10-28T01:00:00Z' })
    expect(result.revision).toBe(3)
    expect(db.rows.conversation_jobs[0].plan_data).toMatchObject({ unrelated: 'keep' })
    const loaded = await loadConversationMarketingStrategy({ client: db.client, ...reference, revision: 3 })
    expect(loaded.brief).toEqual(result)
    expect(db.writes()).toBe(1)
  })

  it.each(['member', 'viewer'])('does not let %s attest owner facts', async (role) => {
    const db = database()
    db.rows.workspace_members[0].role = role
    await expect(approveConversationMarketingStrategy({ client: db.client, ...scope, userId: brief.id,
      expectedRevision: 2, brief })).rejects.toThrow('MARKETING_STRATEGY_FORBIDDEN')
    expect(db.writes()).toBe(0)
  })

  it('rejects fabricated external provenance even if the owner submits it', async () => {
    const db = database()
    await expect(approveConversationMarketingStrategy({ client: db.client, ...scope, userId: brief.id,
      expectedRevision: 2, brief: { ...brief, evidence: [{ ...brief.evidence[0], source: 'public_observed' }] } })).rejects.toThrow('MARKETING_STRATEGY_OWNER_EVIDENCE_REQUIRED')
    expect(db.writes()).toBe(0)
  })

  it.each(['planning', 'executing', 'verifying', 'awaiting_approval', 'succeeded'])('accepts the canonical %s run state', async (status) => {
    const db = database()
    db.rows.conversation_jobs[0].status = status
    expect((await loadConversationMarketingStrategy({ client: db.client, ...reference })).brief.id).toBe(brief.id)
  })

  it.each(['PAUSED', 'STOPPED', 'NEEDS_DECISION'])('honors authoritative %s execution control', async (execution_state) => {
    const db = database()
    db.rows.marketing_missions[0].metadata = { execution_state }
    await expect(loadConversationMarketingStrategy({ client: db.client, ...reference })).rejects.toThrow('MARKETING_STRATEGY')
  })

  it('does not overwrite a concurrent run plan change', async () => {
    const db = database()
    db.conflict()
    await expect(approveConversationMarketingStrategy({ client: db.client, ...scope, userId: brief.id,
      expectedRevision: 2, brief })).rejects.toThrow('MARKETING_STRATEGY_CONFLICT')
    expect(db.rows.conversation_jobs[0].plan_data).toEqual({ changedByOtherWorker: true })
    expect(db.writes()).toBe(0)
  })

  it('records owner attestation provenance and server time instead of accepting claimed observation refs', async () => {
    const db = database()
    const result = await approveConversationMarketingStrategy({ client: db.client, ...scope, userId: brief.id,
      expectedRevision: 2, brief, now: '2026-10-28T01:00:00Z' })
    expect(result.evidence[0].sourceRef).toBe(`owner-attestation:${brief.id}:${brief.id}:3:${brief.evidence[0].id}`)
    expect(result.evidence[0].observedAt).toBe('2026-10-28T01:00:00Z')
    expect(result.questions[0].evidenceRef).toBe(`owner-attestation:${brief.id}:${brief.id}:3:${brief.questions[0].id}`)
  })

  it('creates the first approved revision on an existing run, with authoritative goal wording', async () => {
    const db = database()
    db.rows.conversation_jobs[0].plan_data = { unrelated: 'keep' }
    const result = await approveConversationMarketingStrategy({ client: db.client, ...scope, userId: brief.id,
      expectedRevision: 0, brief: { ...brief, businessGoal: { ...brief.businessGoal, description: 'client claim' } } })
    expect(result.revision).toBe(1)
    expect(result.businessGoal.description).toBe('서비스 상담 문의')
    expect(db.rows.marketing_missions).toHaveLength(1)
  })
})
