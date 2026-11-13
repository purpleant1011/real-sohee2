// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { loadReferenceImages } from './reference-images'

const ws = '20000000-0000-4000-8000-000000000001'
const a = '30000000-0000-4000-8000-000000000001'
const b = '30000000-0000-4000-8000-000000000002'

function admin(rows: unknown[], files: Record<string, Uint8Array | null>) {
  const filters: string[] = []
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = (c: string, v: string) => { filters.push(`${c}=${v}`); return q }
  q.in = (c: string, v: string[]) => { filters.push(`${c} in ${v.join(',')}`); return Promise.resolve({ data: rows, error: null }) }
  return {
    filters,
    client: {
      from: () => q,
      storage: { from: () => ({ download: async (path: string) => files[path] ? { data: new Blob([files[path] as BlobPart]), error: null } : { data: null, error: { message: 'x' } } }) },
    },
  }
}

describe('loadReferenceImages', () => {
  it('loads only this workspace\'s image assets, keeps order and skips failures', async () => {
    const { client, filters } = admin(
      [
        { id: b, bucket_id: 'content-media', object_path: 'p/b.png', mime_type: 'image/png', size_bytes: 3 },
        { id: a, bucket_id: 'content-media', object_path: 'p/a.jpg', mime_type: 'image/jpeg', size_bytes: 2 },
      ],
      { 'p/a.jpg': new Uint8Array([1, 2]), 'p/b.png': null },
    )
    const result = await loadReferenceImages(client, ws, [a, b])
    expect(result).toEqual([{ bytes: new Uint8Array([1, 2]), mimeType: 'image/jpeg' }])
    expect(filters).toContain(`workspace_id=${ws}`)
    expect(filters).toContain('rights_status=confirmed')
  })

  it('enforces workspace isolation and confirmed rights status strictly', async () => {
    const foreignWs = '20000000-0000-4000-8000-000000000099'
    const { client } = admin(
      [
        { id: a, workspace_id: foreignWs, rights_status: 'confirmed', bucket_id: 'content-media', object_path: 'p/a.png', mime_type: 'image/png', size_bytes: 2 },
        { id: b, workspace_id: ws, rights_status: 'pending', bucket_id: 'content-media', object_path: 'p/b.png', mime_type: 'image/png', size_bytes: 2 },
      ],
      { 'p/a.png': new Uint8Array([1, 2]), 'p/b.png': new Uint8Array([3, 4]) },
    )
    const result = await loadReferenceImages(client, ws, [a, b])
    expect(result).toEqual([])
  })

  it('returns [] for no ids, ignores oversize assets and never throws', async () => {
    expect(await loadReferenceImages({} as never, ws, [])).toEqual([])
    const { client } = admin([{ id: a, bucket_id: 'content-media', object_path: 'p/a.png', mime_type: 'image/png', size_bytes: 9 * 1024 * 1024 }], { 'p/a.png': new Uint8Array([1]) })
    expect(await loadReferenceImages(client, ws, [a])).toEqual([])
    expect(await loadReferenceImages({ from: () => { throw new Error('boom') } } as never, ws, [a])).toEqual([])
  })
})
