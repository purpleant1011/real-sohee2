import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { loadKnowledgeJournal } from './knowledge-journal.server'
const ws = '20000000-0000-4000-8000-000000000001'
const id = '30000000-0000-4000-8000-000000000001'
const threadId = '40000000-0000-4000-8000-000000000001'
const time = '2026-10-30T00:00:00Z'
const instruction = { id, workspace_id: ws, thread_id: threadId, role: 'user', status: 'completed', content: '매주 월요일 오전에 성과를 보고해줘', created_at: time }
function database(rows: Record<string, unknown> = {}, errors: Record<string, unknown> = {}) {
  const filters: unknown[][] = []
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'order', 'limit', 'in']) chain[method] = () => chain
    chain.eq = (...args: unknown[]) => { filters.push([table, ...args]); return chain }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table in rows ? rows[table] : [], error: errors[table] ?? null }).then(resolve)
    return chain
  })
  return { client: { from } as unknown as ServerSupabaseClient, from, filters }
}
describe('knowledge journal from existing canonical stores', () => {
  it('links stored instructions, execution, routines, schedules, proposals and memories without a second ledger', async () => {
    const db = database({ messages: [instruction],
      conversation_jobs: [{ id, workspace_id: ws, thread_id: threadId, status: 'succeeded', queued_at: time, completed_at: time, attention_resolved_at: null }],
      automation_rules: [{ id, workspace_id: ws, kind: 'weekly_plan_proposal', active: false, next_run_at: null, updated_at: time }],
      schedules: [{ id, workspace_id: ws, status: 'scheduled', publish_at: '2026-11-01T00:00:00Z', timezone: 'Asia/Seoul', updated_at: time }],
      sohee_studio_proposals: [{ id, workspace_id: ws, kind: 'fact', category: '말투', content: '차분하게 안내', status: 'proposed', created_at: time }],
      agent_memories: [{ id, workspace_id: ws, subject: '지난 업무 관찰', fact_content: '확인한 업무 결과', status: 'canonical', created_at: time }],
    })
    const result = await loadKnowledgeJournal({ ...db, workspaceId: ws })
    expect(new Set(result.entries.map(e => e.kind)).size).toBe(6)
    expect(result.entries.find(e => e.kind === 'instruction')).toMatchObject({ sourceId: id, summary: instruction.content, href: `/app/conversations/${threadId}` })
    expect(result.entries.find(e => e.kind === 'automation')?.statusLabel).toBe('비활성 설정')
    expect(result.entries.find(e => e.kind === 'learning')?.statusLabel).toBe('검토 전 후보')
    expect(result.notice).toContain('실행 권한이 아닙니다')
    for (const table of ['messages', 'conversation_jobs', 'automation_rules', 'schedules', 'sohee_studio_proposals', 'agent_memories']) expect(db.filters).toContainEqual([table, 'workspace_id', ws])
  })
  it('keeps imported learning candidates and studio proposals in separate source namespaces', async () => {
    const result = await loadKnowledgeJournal({ ...database({
      knowledge_candidates: [{ id, workspace_id: ws, category: '가격', content: '가져온 검토 후보', status: 'pending', created_at: time }],
      sohee_studio_proposals: [{ id, workspace_id: ws, kind: 'fact', category: '말투', content: '대화 검토 후보', status: 'proposed', created_at: time }],
    }), workspaceId: ws })
    expect(result.entries).toHaveLength(2)
    expect(new Set(result.entries.map(entry => entry.id)).size).toBe(2)
    expect(new Set(result.entries.map(entry => entry.sourceType))).toEqual(new Set(['knowledge_candidate', 'studio_proposal']))
  })
  it('keeps an unavailable source distinct from confirmed empty and retains other records', async () => {
    const db = database({ messages: [instruction], agent_memories: null }, { agent_memories: { message: 'private sql failure' } })
    const result = await loadKnowledgeJournal({ ...db, workspaceId: ws })
    expect(result.entries).toHaveLength(1)
    expect(result.partial).toBe(true)
    expect(result.sources.find(s => s.kind === 'memory')).toMatchObject({ state: 'unavailable', returnedCount: null })
    expect(result.sources.find(s => s.kind === 'schedule')).toMatchObject({ state: 'confirmed_empty', returnedCount: 0 })
    expect(JSON.stringify(result)).not.toContain('private sql failure')
  })
  it('does not expose privileged foreign source rows', async () => {
    const db = database({ messages: [{ ...instruction, workspace_id: '21000000-0000-4000-8000-000000000001', content: 'foreign private text' }] })
    const result = await loadKnowledgeJournal({ ...db, workspaceId: ws })
    expect(result.sources.find(s => s.kind === 'instruction')?.state).toBe('unavailable')
    expect(JSON.stringify(result)).not.toContain('foreign private text')
  })
  it('redacts credentials from request previews rather than copying them into knowledge prompts', async () => {
    const db = database({ messages: [{ ...instruction, content: 'Bearer private-access-token' }] })
    const result = await loadKnowledgeJournal({ ...db, workspaceId: ws })
    expect(JSON.stringify(result)).not.toContain('private-access-token')
    expect(result.entries[0].summary).toContain('민감')
  })
  it('sorts mixed timezone timestamps by their actual instant rather than their text', async () => {
    const result = await loadKnowledgeJournal({ ...database({ messages: [
      { ...instruction, id: '30000000-0000-4000-8000-000000000002', content: 'earlier', created_at: '2026-10-30T09:00:00+09:00' },
      { ...instruction, content: 'later', created_at: '2026-10-30T01:00:00Z' },
    ] }), workspaceId: ws })
    expect(result.entries.map(entry => entry.summary)).toEqual(['later', 'earlier'])
  })
  it('bounds the combined history and marks partial instead of claiming all past work was read', async () => {
    const db = database({ messages: [instruction, { ...instruction, id: '30000000-0000-4000-8000-000000000002', created_at: '2026-10-29T00:00:00Z' }] })
    const result = await loadKnowledgeJournal({ ...db, workspaceId: ws, limit: 1 })
    expect(result.entries).toHaveLength(1)
    expect(result.partial).toBe(true)
  })
})
