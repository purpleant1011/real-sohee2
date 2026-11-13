// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveFirstValueSourceIds } from './first-value-source'
const valid = { id: '33333333-3333-4333-8333-333333333333', workspace_id: 'w1', provenance_kind: 'USER_UPLOAD', lifecycle_status: 'READY', rights_status: 'confirmed', publish_eligibility: true,
  generation_metadata: { uploadRights: { copyright: 'owned', commercialUse: true, identifiablePeople: 'none', consentReference: null } } }
function admin(rows: any[]) {
  return { from: () => { const query: any = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }), then: (resolve: any) => resolve({ data: rows, error: null }) }; return query } }
}
describe('first value photo selection', () => {
  it('falls back only to a single rights-confirmed original', async () => {
    expect(await resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1' })).toEqual([valid.id])
    expect(await resolveFirstValueSourceIds({ admin: admin([]), workspaceId: 'w1' })).toEqual([])
  })
  it('does not choose the latest among multiple photos', async () => {
    await expect(resolveFirstValueSourceIds({ admin: admin([valid, { ...valid, id: 'other' }]), workspaceId: 'w1' })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_REQUIRED' })
  })
  it('never substitutes a different photo when explicit selection is stale, withdrawn or foreign', async () => {
    for (const row of [null, { ...valid, rights_status: 'rejected' }, { ...valid, workspace_id: 'w2' }]) {
      await expect(resolveFirstValueSourceIds({ admin: admin(row ? [row] : []), workspaceId: 'w1', explicitAssetId: valid.id })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID' })
    }
    expect(await resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1', explicitAssetId: valid.id })).toEqual([valid.id])
  })
  it('accepts an explicit no-original choice but never silently replaces a pending photo', async () => {
    expect(await resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1', explicitAssetId: 'none' })).toEqual([])
    await expect(resolveFirstValueSourceIds({ admin: admin([{ ...valid, lifecycle_status: 'PENDING_VALIDATION' }]), workspaceId: 'w1' })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID' })
  })
  it('rejects empty or invalid explicit ids and mismatched returned id as MEDIA_SELECTION_INVALID without fallback', async () => {
    // empty string and whitespace-only
    await expect(resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1', explicitAssetId: '' })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID', status: 409 })
    await expect(resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1', explicitAssetId: '   ' })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID', status: 409 })
    // non-uuid strings
    await expect(resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1', explicitAssetId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID', status: 409 })
    await expect(resolveFirstValueSourceIds({ admin: admin([valid]), workspaceId: 'w1', explicitAssetId: '12345' })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID', status: 409 })
    // mismatched returned row id
    await expect(resolveFirstValueSourceIds({ admin: admin([{ ...valid, id: 'different-uuid-returned' }]), workspaceId: 'w1', explicitAssetId: valid.id })).rejects.toMatchObject({ code: 'MEDIA_SELECTION_INVALID', status: 409 })
  })

  it('rejects non-array responses (null, undefined, non-array object) as MEDIA_FETCH_FAILED 503 while accepting genuine empty array [] (F1725-01)', async () => {
    function customAdmin(response: { data: any; error: any }) {
      return {
        from: () => {
          const query: any = {
            select: () => query,
            eq: () => query,
            in: () => query,
            order: () => query,
            limit: () => query,
            maybeSingle: async () => response,
            then: (resolve: any) => resolve(response),
          }
          return query
        },
      }
    }

    // null data with null error must not be assumed as genuine empty photos
    await expect(resolveFirstValueSourceIds({ admin: customAdmin({ data: null, error: null }), workspaceId: 'w1' })).rejects.toMatchObject({
      code: 'MEDIA_FETCH_FAILED',
      status: 503,
    })

    // undefined data
    await expect(resolveFirstValueSourceIds({ admin: customAdmin({ data: undefined, error: null }), workspaceId: 'w1' })).rejects.toMatchObject({
      code: 'MEDIA_FETCH_FAILED',
      status: 503,
    })

    // non-array object
    await expect(resolveFirstValueSourceIds({ admin: customAdmin({ data: { message: 'not an array' }, error: null }), workspaceId: 'w1' })).rejects.toMatchObject({
      code: 'MEDIA_FETCH_FAILED',
      status: 503,
    })

    // genuine empty array [] is valid observation of zero photos
    expect(await resolveFirstValueSourceIds({ admin: customAdmin({ data: [], error: null }), workspaceId: 'w1' })).toEqual([])
  })
})
