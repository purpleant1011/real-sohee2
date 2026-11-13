import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { loadWorkspaceBusinessContext } from './workspace-business-context.server'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const business = { workspace_id: workspaceId, business_name: '테스트 가게', industry: '뷰티', location: '청라', summary: '맞춤 상담', registration_number: 'not-for-model' }
const brand = { workspace_id: workspaceId, voice: '차분한 존댓말', keywords: ['맞춤 상담'], prohibited_terms: ['무조건 효과'] }
function database(businessRow: unknown = business, brandRow: unknown = brand, error: unknown = null, services: unknown[] = []) {
  const filters: unknown[][] = []
  const from = vi.fn((table: string) => { let unknownColumn = false; const query = { select: vi.fn((columns: string) => {
    unknownColumn = table === 'business_profiles' && columns.split(',').includes('operating_hours')
    return query
  }), eq: (...args: unknown[]) => { filters.push([table, ...args]); return query },
    order: () => query, limit: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: services, error }).then(resolve),
    maybeSingle: async () => unknownColumn ? { data: null, error: { code: '42703' } }
      : { data: table === 'business_profiles' ? businessRow : brandRow, error } }; return query })
  return { client: { from } as unknown as ServerSupabaseClient, from, filters }
}
describe('shared workspace business context', () => {
  it('reads actual business and brand records with tenant scope and excludes administrative identifiers', async () => {
    const db = database()
    const result = await loadWorkspaceBusinessContext({ client: db.client, workspaceId })
    expect(result).toMatchObject({ workspaceId, business: { name: '테스트 가게', summary: '맞춤 상담' },
      brand: { voice: '차분한 존댓말', prohibitedTerms: ['무조건 효과'] } })
    expect(db.filters).toContainEqual(['business_profiles', 'workspace_id', workspaceId])
    expect(db.filters).toContainEqual(['brand_profiles', 'workspace_id', workspaceId])
    expect(JSON.stringify(result)).not.toContain('not-for-model')
    expect(result.business?.operatingHours).toBeNull()
  })
  it('keeps genuinely missing profiles distinct from a failed lookup', async () => {
    expect(await loadWorkspaceBusinessContext({ ...database(null, null), workspaceId })).toMatchObject({ business: null, brand: null })
    await expect(loadWorkspaceBusinessContext({ ...database(null, null, { message: 'private failure' }), workspaceId })).rejects.toThrow('WORKSPACE_BUSINESS_CONTEXT_UNAVAILABLE')
  })
  it('rejects privileged foreign rows before projecting profile data', async () => {
    await expect(loadWorkspaceBusinessContext({ ...database({ ...business, workspace_id: '21000000-0000-4000-8000-000000000001' }), workspaceId })).rejects.toThrow('WORKSPACE_BUSINESS_CONTEXT_SCOPE_MISMATCH')
  })
  it('uses current canonical services and preserves an unknown price instead of zero', async () => {
    const service = { id: '50000000-0000-4000-8000-000000000001', workspace_id: workspaceId, name: '상담', price: null,
      duration_minutes: 30, cancellation_policy: null, valid_from: null, valid_until: null, active: true, updated_at: '2026-10-30T00:00:00Z' }
    const result = await loadWorkspaceBusinessContext({ ...database(business, brand, null, [service, { ...service, name: '지난 서비스', valid_until: '2000-01-01T00:00:00Z' }]), workspaceId })
    expect(result.services).toEqual([expect.objectContaining({ name: '상담', price: null, durationMinutes: 30 })])
  })
  it('bounds large profile text without fabricating absent values', async () => {
    const result = await loadWorkspaceBusinessContext({ ...database({ ...business, summary: '가'.repeat(9000), location: null }), workspaceId })
    expect(result.business?.summary?.length).toBeLessThanOrEqual(4000)
    expect(result.business?.location).toBeNull()
    expect(result.truncated).toBe(true)
  })
})
