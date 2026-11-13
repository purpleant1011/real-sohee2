import { describe, expect, it } from 'vitest'
import { marketingStrategyFixture as brief } from '@/features/content/blog-strategy-brief.fixture'
import { openBlogStrategyProposal, readBlogStrategyProposal, updateBlogStrategyProposal, respondToBlogStrategyProposal, approveBlogStrategyProposal } from './blog-strategy-proposal'

const scope = { workspaceId: brief.workspaceId, threadId: brief.lineage.conversationId, userId: brief.id }
const now = '2026-10-28T01:00:00Z'
function database() {
  const rows: Record<string, Record<string, unknown>[]> = {
    workspace_registry: [{ workspace_id: scope.workspaceId, dataset_mode: 'ACTUAL' }],
    conversation_threads: [{ id: scope.threadId, workspace_id: scope.workspaceId, status: 'active' }],
    workspace_members: [{ workspace_id: scope.workspaceId, user_id: scope.userId, status: 'active', role: 'owner' }],
    conversation_jobs: [{ id: brief.lineage.runId, workspace_id: scope.workspaceId, thread_id: scope.threadId, status: 'succeeded', sequence_number: 1,
      plan_data: { missionId: brief.lineage.missionId, unrelated: 'keep' } }],
    marketing_missions: [{ id: brief.lineage.missionId, workspace_id: scope.workspaceId, status: 'PLANNING', source_conversation_job_id: brief.lineage.runId }],
    sohee_goals: [{ id: brief.businessGoal.id, workspace_id: scope.workspaceId, status: 'active', version: 3, desired_outcome: '서비스 상담 문의', title: '상담 문의' }],
    knowledge_facts: [{ id: brief.evidence[0].id, workspace_id: scope.workspaceId, category: 'operation_policy', content: '방문 전 상담으로 서비스를 안내합니다.',
      status: 'active', source_candidate_id: brief.id, approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null }],
  }
  let writes = 0
  let failTable = ''
  let conflict = false
  const client = { from(table: string) {
    const filters: [string, unknown][] = []
    let values: Record<string, unknown> | undefined
    let limit = Infinity
    let orderBy: { key: string; ascending: boolean } | undefined
    const execute = () => {
      if (table === failTable) return { data: null, error: { message: 'offline' } }
      // conversation_jobs has queued_at/sequence_number, not created_at.
      if (table === 'conversation_jobs' && orderBy?.key === 'created_at') {
        return { data: null, error: { code: '42703', message: 'column conversation_jobs.created_at does not exist' } }
      }
      const matches = (rows[table] ?? []).filter(row => filters.every(([key, value]) => key === 'plan_data' ? JSON.stringify(row[key]) === value : row[key] === value))
      if (orderBy) {
        const { key, ascending } = orderBy
        matches.sort((a, b) => {
          const left = a[key] as string | number
          const right = b[key] as string | number
          return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1)
        })
      }
      const found = matches.slice(0, limit)
      if (values && !conflict) { found.forEach(row => Object.assign(row, values)); writes += found.length }
      return { data: values && conflict ? [] : found, error: null }
    }
    const query = {
      select() { return query }, eq(key: string, value: unknown) { filters.push([key, value]); return query },
      order(key: string, options: { ascending: boolean }) { orderBy = { key, ascending: options.ascending }; return query }, limit(value: number) { limit = value; return query },
      update(value: Record<string, unknown>) { values = value; return query },
      async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve) },
    }
    return query
  } }
  return { rows, client: client as never, writes: () => writes, fail(table: string) { failTable = table }, conflict() { conflict = true } }
}
const input = (db: ReturnType<typeof database>) => ({ client: db.client, ...scope, now })

describe('persisted blog topic decision', () => {
  it('reads without creating a proposal and restores a persisted selection', async () => {
    const db = database()
    expect(await readBlogStrategyProposal(input(db))).toBeNull()
    expect(db.writes()).toBe(0)
    const opened = await openBlogStrategyProposal(input(db))
    expect(await readBlogStrategyProposal(input(db))).toEqual(opened)
    expect(db.writes()).toBe(1)
  })
  it.each(['no run', 'no mission', 'no goal'])('reads an unused conversation without requiring setup: %s', async state => {
    const db = database()
    if (state === 'no run') db.rows.conversation_jobs = []
    if (state === 'no mission') db.rows.conversation_jobs[0].plan_data = {}
    if (state === 'no goal') db.rows.sohee_goals = []
    expect(await readBlogStrategyProposal(input(db))).toBeNull()
    expect(db.writes()).toBe(0)
  })
  it('reads the latest thread job by sequence even when jobs share the same queue time', async () => {
    const db = database()
    await openBlogStrategyProposal(input(db))
    db.rows.conversation_jobs[0].queued_at = now
    db.rows.conversation_jobs.push({
      id: '99999999-9999-4999-8999-999999999999', workspace_id: scope.workspaceId,
      thread_id: scope.threadId, sequence_number: 2, queued_at: now, plan_data: {},
    })
    const writes = db.writes()
    expect(await readBlogStrategyProposal(input(db))).toBeNull()
    expect(db.writes()).toBe(writes)
  })
  it('distinguishes a failed run lookup from an unused conversation', async () => {
    const db = database()
    db.fail('conversation_jobs')
    await expect(readBlogStrategyProposal(input(db))).rejects.toThrow('MARKETING_STRATEGY_UNAVAILABLE')
    expect(db.writes()).toBe(0)
  })
  it('creates three grounded choices on the existing run, with inferred questions and no provider observations', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    expect(proposal.topics).toHaveLength(3)
    expect(proposal.topics[0].evidence).toEqual(['방문 전 상담으로 서비스를 안내합니다.'])
    expect(proposal.topics.every(topic => topic.questionSource === 'inferred')).toBe(true)
    expect(proposal.unknowns).toContain('검색 수요·AI 가시성·문의 성과는 아직 측정하지 않았어요.')
    expect(proposal.status).toBe('proposed')
    expect(db.rows.conversation_jobs).toHaveLength(1)
    expect(db.rows.marketing_missions).toHaveLength(1)
    expect(db.rows.conversation_jobs[0].plan_data).toMatchObject({ unrelated: 'keep' })
  })

  it('restores the same proposal and persists selection/conditions without approving it', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: proposal.revision,
      selectedIndex: 1, audience: '처음 방문을 검토하는 분', constraints: '할인 내용 제외' })
    expect(selected.revision).toBe(2)
    expect(selected.selectedIndex).toBe(1)
    expect(selected.status).toBe('proposed')
    expect(await openBlogStrategyProposal(input(db))).toEqual(selected)
    expect(db.rows.conversation_jobs[0].plan_data).not.toHaveProperty('marketing_strategy')
    await expect(updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, selectedIndex: 2 })).rejects.toThrow('STALE')
  })

  it('handles a numbered conversational choice as a saved proposal, never as approval', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal(input(db))
    const selected = await respondToBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, text: '2번, 할인 내용 제외' })
    expect(selected.selectedIndex).toBe(1)
    expect(selected.constraints).toBe('할인 내용 제외')
    expect(selected.status).toBe('proposed')
    expect(db.rows.conversation_jobs[0].plan_data).not.toHaveProperty('marketing_strategy')
    await expect(respondToBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 2, text: '그냥 승인해줘' })).rejects.toThrow('SELECTION_REQUIRED')
  })

  it.each(['2번으로 써', '2번으로 써, 할인 내용 제외'])('saves %s only as a proposed selection', async text => {
    const db = database()
    const proposal = await openBlogStrategyProposal(input(db))
    const selected = await respondToBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, text })
    expect(selected.selectedIndex).toBe(1)
    expect(selected.constraints).toBe(text.includes(',') ? '할인 내용 제외' : '')
    expect(selected.status).toBe('proposed')
    expect(selected.reference).toBeUndefined()
    expect(db.rows.conversation_jobs[0].plan_data).not.toHaveProperty('marketing_strategy')
  })

  it.each(['2번 말고 3번', '2번으로 써서 게시해', '2번 승인해', '4번으로 써'])('rejects ambiguous or execution-bearing choice: %s', async text => {
    const db = database()
    const proposal = await openBlogStrategyProposal(input(db))
    await expect(respondToBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, text })).rejects.toThrow('SELECTION_REQUIRED')
    expect(await openBlogStrategyProposal(input(db))).toEqual(proposal)
  })

  it('requires explicit confirmation and selection before approval', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    await expect(approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1,
      confirmed: true, outcome: 'valid_inquiry' })).rejects.toThrow('SELECTION_REQUIRED')
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, selectedIndex: 1 })
    await expect(approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: selected.revision,
      confirmed: false, outcome: 'valid_inquiry' })).rejects.toThrow('CONFIRMATION_REQUIRED')
  })

  it('approves the selected server topic on the same lineage and does not claim inferred questions were observed', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1,
      selectedIndex: 1, constraints: '할인 내용 제외' })
    const approved = await approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: selected.revision,
      confirmed: true, outcome: 'valid_inquiry' })
    expect(approved.status).toBe('approved')
    expect(approved.reference).toMatchObject({ missionId: brief.lineage.missionId, runId: brief.lineage.runId, revision: 1 })
    const plan = db.rows.conversation_jobs[0].plan_data as { marketing_strategy: { brief: typeof brief } }
    expect(plan.marketing_strategy.brief.questions).toEqual([])
    expect(plan.marketing_strategy.brief.opportunity.description).toContain(selected.topics[1].title)
    expect(plan.marketing_strategy.brief.nextAction.instruction).toContain('할인 내용 제외')
    expect(plan.marketing_strategy.brief).toHaveProperty('excludedClaims', ['할인'])
    expect(await openBlogStrategyProposal(input(db))).toEqual(approved)
  })

  it('승인한 브리프에 선택한 주제의 핵심 키워드와 내부 점수만 담고, 다른 주제 키워드는 섞지 않는다', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal(input(db))
    const index = 2
    const topic = proposal.topics[index]
    expect(topic.primaryKeyword).toBeTruthy()
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, selectedIndex: index })
    await approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: selected.revision, confirmed: true, outcome: 'valid_inquiry' })
    const plan = db.rows.conversation_jobs[0].plan_data as { marketing_strategy: { brief: { focusKeyword?: Record<string, unknown> } } }
    expect(plan.marketing_strategy.brief.focusKeyword).toEqual({
      keyword: topic.primaryKeyword, searchStatus: topic.keywordStatus ?? 'NOT_OBSERVED',
      ...(topic.keywordScore ? { internalScore: topic.keywordScore.score } : {}),
    })
    expect(plan.marketing_strategy.brief.focusKeyword?.keyword).not.toBe(proposal.topics[0].primaryKeyword)
  })

  it('검색 지표를 관측하지 않은 키워드를 관측된 것처럼 승인 브리프에 올리지 않는다', async () => {
    const db = database()
    const proposal = await openBlogStrategyProposal(input(db))
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, selectedIndex: 0 })
    await approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: selected.revision, confirmed: true, outcome: 'valid_inquiry' })
    const plan = db.rows.conversation_jobs[0].plan_data as { marketing_strategy: { brief: { focusKeyword: { searchStatus: string } } } }
    expect(plan.marketing_strategy.brief.focusKeyword.searchStatus).toBe('NOT_OBSERVED')
  })

  it.each(['member', 'viewer'])('does not let %s approve facts', async role => {
    const db = database()
    const proposal = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, selectedIndex: 0 })
    db.rows.workspace_members[0].role = role
    await expect(approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: selected.revision,
      confirmed: true, outcome: 'valid_inquiry' })).rejects.toThrow('FORBIDDEN')
  })

  it.each([
    ['foreign mission', 'marketing_missions', 'workspace_id', brief.id],
    ['unrelated run', 'marketing_missions', 'source_conversation_job_id', brief.id],
    ['cancelled run', 'conversation_jobs', 'status', 'cancelled'],
    ['paused mission', 'marketing_missions', 'metadata', { execution_state: 'PAUSED' }],
  ])('fails closed on %s without creating substitute IDs', async (_name, table, key, value) => {
    const db = database(); db.rows[table][0][key] = value
    await expect(openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })).rejects.toThrow('MARKETING_STRATEGY')
    expect(db.writes()).toBe(0)
  })

  it.each(['fact', 'goal', 'expiry', 'dataset'])('requires a new decision after %s changes', async change => {
    const db = database()
    const proposal = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: 1, selectedIndex: 0 })
    if (change === 'fact') db.rows.knowledge_facts[0].content = '변경된 사실'
    if (change === 'goal') db.rows.sohee_goals[0].version = 4
    if (change === 'expiry') db.rows.knowledge_facts[0].valid_until = '2026-10-28T00:00:00Z'
    if (change === 'dataset') db.rows.workspace_registry[0].dataset_mode = 'TEST'
    await expect(approveBlogStrategyProposal({ ...input(db), proposalId: proposal.id, expectedRevision: selected.revision,
      confirmed: true, outcome: 'valid_inquiry' })).rejects.toThrow('STALE')
  })

  it('distinguishes missing approved facts, query error, and concurrent edits', async () => {
    const empty = database(); empty.rows.knowledge_facts = []
    await expect(openBlogStrategyProposal({ ...input(empty), prompt: '블로그 글 작성해줘' })).rejects.toThrow('FACTS_REQUIRED')
    const error = database(); error.fail('knowledge_facts')
    await expect(openBlogStrategyProposal({ ...input(error), prompt: '블로그 글 작성해줘' })).rejects.toThrow('approved_knowledge_facts_unavailable')
    const conflict = database(); conflict.conflict()
    await expect(openBlogStrategyProposal({ ...input(conflict), prompt: '블로그 글 작성해줘' })).rejects.toThrow('CONFLICT')
  })

  it('lets the owner re-propose after facts change while invalidating the previous approval', async () => {
    const db = database()
    const first = await openBlogStrategyProposal(input(db))
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: 1, selectedIndex: 0 })
    await approveBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: selected.revision, confirmed: true, outcome: 'valid_inquiry' })
    db.rows.knowledge_facts[0].content = '새롭게 승인된 안내입니다.'
    const refreshed = await openBlogStrategyProposal({ ...input(db), refresh: true })
    expect(refreshed.status).toBe('proposed')
    expect(refreshed.id).toBe(first.id)
    expect(refreshed.revision).toBe(4)
    expect(refreshed.topics[0].evidence).toEqual(['새롭게 승인된 안내입니다.'])
    expect(refreshed.reference).toBeUndefined()
  })

  it('allows conditions to be cleared, and exposes the real active goal for confirmation', async () => {
    const db = database()
    const first = await openBlogStrategyProposal(input(db))
    expect(first.goal.description).toBe('서비스 상담 문의')
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: 1, selectedIndex: 0, constraints: '할인 제외' })
    const cleared = await updateBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: selected.revision, selectedIndex: 0, constraints: '' })
    expect(cleared.constraints).toBe('')
  })

  it('does not replace an existing approved strategy when topics change; rejects the old generation reference', async () => {
    const db = database()
    const first = await openBlogStrategyProposal({ ...input(db), prompt: '블로그 글 작성해줘' })
    const selected = await updateBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: 1, selectedIndex: 0 })
    const approved = await approveBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: selected.revision,
      confirmed: true, outcome: 'valid_inquiry' })
    await updateBlogStrategyProposal({ ...input(db), proposalId: first.id, expectedRevision: approved.revision, selectedIndex: 1 })
    const { loadConversationMarketingStrategy } = await import('./conversation-marketing-strategy')
    await expect(loadConversationMarketingStrategy({ client: db.client, workspaceId: scope.workspaceId, threadId: scope.threadId,
      ...approved.reference! })).rejects.toThrow('STALE')
  })
})

describe('topic recommendation from approved facts', () => {
  it('제안 주제는 서로 다른 제목이며 검색 신호는 관측 전이라 NOT_OBSERVED로 표시한다', async () => {
    const proposal = await openBlogStrategyProposal({ ...input(database()), prompt: '블로그 글 작성해줘' })
    expect(new Set(proposal.topics.map(t => t.title)).size).toBe(3)
    expect(proposal.topics.every(t => t.keywordStatus === 'NOT_OBSERVED')).toBe(true)
  })

  it('ANI-1914: 각 주제에 소희 내부 점수와 미측정 항목을 붙이고 외부 수요 수치는 만들지 않는다', async () => {
    const proposal = await openBlogStrategyProposal({ ...input(database()), prompt: '블로그 글 작성해줘' })
    for (const topic of proposal.topics) {
      expect(topic.keywordScore).toMatchObject({ policyVersion: 'keyword-score-v1' })
      expect(topic.keywordScore!.unmeasured).toContain('demand')
      expect(JSON.stringify(topic)).not.toMatch(/monthlySearches|competition|searchVolume/)
    }
  })
})
