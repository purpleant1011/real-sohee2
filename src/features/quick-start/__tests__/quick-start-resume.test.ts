import { describe, expect, it } from 'vitest'
import { loadQuickStartProfile, loadQuickStartPreferences } from '../quick-start-service'

function db(rows: Record<string, any>, failure?: string) {
  const filters: Record<string, unknown>[] = []
  return { filters, admin: { from(table: string) {
    const match: Record<string, unknown> = { table }
    filters.push(match)
    const query: any = { select: () => query, limit: () => query, eq: (key: string, value: unknown) => { match[key] = value; return query },
      maybeSingle: async () => ({ data: rows[table] ?? null, error: failure === table ? { message: 'unavailable' } : null }) }
    return query
  } } }
}

describe('quick start server resume (ANI-1592)', () => {
  it('reuses confirmed profile on a fresh client without reading another signup', async () => {
    const { admin, filters } = db({ business_profiles: { business_name: '우리 가게', industry: '카페', summary: '직접 만드는 커피' } })
    expect(await loadQuickStartProfile({ admin, workspaceId: 'w1', userId: 'u1' })).toMatchObject({ business_name: '우리 가게', industry: '카페' })
    expect(filters).toHaveLength(1)
    expect(filters[0]).toMatchObject({ workspace_id: 'w1' })
  })

  it('reads signup carry-forward only for this workspace and actor', async () => {
    const { admin, filters } = db({ signup_applications: { company_name: '가입한 가게' } })
    expect(await loadQuickStartProfile({ admin, workspaceId: 'w2', userId: 'u1' })).toMatchObject({ business_name: '가입한 가게', industry: null })
    expect(filters.find(f => f.table === 'signup_applications')).toMatchObject({ workspace_id: 'w2', user_id: 'u1' })
  })

  it('does not mask a profile query failure as an empty shop', async () => {
    const { admin } = db({}, 'business_profiles')
    await expect(loadQuickStartProfile({ admin, workspaceId: 'w1', userId: 'u1' })).rejects.toThrow('PROFILE_READ')
  })

  it('restores the owner goal and tone without promoting an AI candidate', async () => {
    const f = db({ workspace_knowledge_harnesses: { business_identity: { source: 'quick-start', marketingGoal: '이번 주 신제품 알리기' }, brand_voice: { preset: 'calm' } } })
    expect(await loadQuickStartPreferences({ admin: f.admin, workspaceId: 'w1' })).toEqual({ goal: '이번 주 신제품 알리기', tone: 'calm' })
    const candidate = db({ workspace_knowledge_harnesses: { business_identity: { source: 'AI_CANDIDATE', marketingGoal: '마음대로 할인' } } })
    expect((await loadQuickStartPreferences({ admin: candidate.admin, workspaceId: 'w1' })).goal).toBe('')
  })

  it('does not promote a default workspace label to an owner fact', async () => {
    const { admin } = db({ workspaces: { name: '사장님의 워크스페이스' } })
    expect(await loadQuickStartProfile({ admin, workspaceId: 'w1', userId: 'u1' })).toBeNull()
  })
})
