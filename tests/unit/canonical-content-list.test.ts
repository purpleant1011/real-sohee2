import { beforeEach, expect, it, vi } from 'vitest'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'

const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, errorTable: '', queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }> }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({
  from(table: string) {
    const filters: Array<[string, unknown]> = []
    state.queries.push({ table, filters })
    const read = () => ({ data: state.errorTable === table ? null : (state.rows[table] || []).filter(row =>
      filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)),
    error: state.errorTable === table ? { message: 'database unavailable' } : null })
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      in: (key: string, value: unknown[]) => { filters.push([key, value]); return query },
      order: () => query,
      maybeSingle: async () => { const result = read(); return { ...result, data: result.data?.[0] ?? null } },
      then: (resolve: any) => Promise.resolve(read()).then(resolve),
    }
    return query
  },
}) }))

beforeEach(() => {
  state.errorTable = ''; state.queries = []
  state.rows = { content_items: [], content_versions: [], approvals: [], content_version_media: [], media_assets: [] }
  for (let i = 0; i < 20; i++) {
    state.rows.content_items.push({ id: `c${i}`, workspace_id: 'a', current_version_id: `v${i}`, status: 'draft', channel: 'threads' })
    state.rows.content_versions.push({ id: `v${i}`, workspace_id: 'a', version_number: 2, caption: `caption${i}`, fingerprint: `sha${i}` })
  }
  state.rows.approvals.push({ id: 'approved', workspace_id: 'a', version_id: 'v0', status: 'approved' },
    { id: 'old-version', workspace_id: 'a', version_id: 'old', status: 'approved' },
    { id: 'other-tenant', workspace_id: 'b', version_id: 'v1', status: 'approved' })
  state.rows.content_version_media.push({ workspace_id: 'a', version_id: 'v0', media_asset_id: 'image', position: 0 })
  state.rows.media_assets.push({ id: 'image', workspace_id: 'a', object_path: 'image.png', sha256_digest: 'digest', width: 390, height: 390, mime_type: 'image/png' })
})
it('loads 20 records in five tenant-scoped queries, preserving version, approval and media truth', async () => {
  const items = await CanonicalContentLifecycleService.listWorkspaceContents('a')
  expect(items).toHaveLength(20)
  expect(items[0]).toMatchObject({ currentVersionId: 'v0', fingerprint: 'sha0', isApproved: true, approvalId: 'approved', mediaUrls: ['/api/workspaces/a/media/image'] })
  expect(items[1].isApproved).toBe(false)
  expect(state.queries.length).toBeLessThanOrEqual(5)
  expect(state.queries.every(query => query.filters.some(([key, value]) => key === 'workspace_id' && value === 'a'))).toBe(true)
})
it.each(['content_items', 'content_versions', 'approvals', 'content_version_media', 'media_assets'])('does not disguise %s failure as an empty/successful list', async table => {
  state.errorTable = table
  await expect(CanonicalContentLifecycleService.listWorkspaceContents('a')).rejects.toThrow()
})
it('batches large version lists without reverting to per-item queries', async () => {
  for (let i = 20; i < 120; i++) {
    state.rows.content_items.push({ id: `c${i}`, workspace_id: 'a', current_version_id: `v${i}` })
    state.rows.content_versions.push({ id: `v${i}`, workspace_id: 'a' })
  }
  const items = await CanonicalContentLifecycleService.listWorkspaceContents('a')
  expect(items).toHaveLength(120)
  expect(state.queries).toHaveLength(11)
  expect(state.queries.every(query => query.filters.every(([, value]) => !Array.isArray(value) || value.length <= 50))).toBe(true)
})
it.each(['content_versions', 'media_assets'])('fails closed for missing referenced %s', async table => {
  state.rows[table] = []
  await expect(CanonicalContentLifecycleService.listWorkspaceContents('a')).rejects.toThrow()
})
it('fails closed instead of choosing an arbitrary approval when a version has duplicate approved rows', async () => {
  state.rows.approvals.push({ id: 'duplicate', workspace_id: 'a', version_id: 'v0', status: 'approved' })
  await expect(CanonicalContentLifecycleService.listWorkspaceContents('a')).rejects.toThrow()
})
it('returns an empty list only after a successful empty query', async () => {
  state.rows.content_items = []
  await expect(CanonicalContentLifecycleService.listWorkspaceContents('a')).resolves.toEqual([])
  expect(state.queries).toHaveLength(1)
})
