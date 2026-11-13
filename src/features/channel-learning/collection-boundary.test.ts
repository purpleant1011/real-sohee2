import { describe, expect, it } from 'vitest'
import { collectMetaDocuments } from './meta-collector'
import { tenantASource } from './test-fixtures'

describe('provider pagination resource boundary', () => {
  it('bounds pages even when every row is rejected for foreign authorship', async () => {
    let calls = 0
    const source = { ...tenantASource, lease: { ...tenantASource.lease!, expiresAt: new Date(Date.now() + 3600000).toISOString() } }
    const run = async () => {
      const documents = []
      for await (const doc of collectMetaDocuments(source, { async fetchProvider() {
        calls++
        if (calls > 5) throw new Error('UNBOUNDED_PAGINATION')
        return { status: 200, data: { data: [{ id: 'foreign', author_id: 'other-account', timestamp: new Date().toISOString() }],
          paging: { cursors: { after: `cursor-${calls}` } } } }
      } })) documents.push(doc)
      return documents
    }
    await expect(run()).resolves.toEqual([])
    expect(calls).toBeLessThanOrEqual(5)
  })
})
