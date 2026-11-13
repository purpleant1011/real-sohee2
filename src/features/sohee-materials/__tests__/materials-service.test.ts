import { describe, expect, it } from 'vitest'
import { listWorkspaceMaterials } from '../materials-service'

type Rows = Record<string, unknown>

function fakeClient(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const data = tables[table]
      const failing = data && typeof data === 'object' && '__error' in (data as Rows)
      const result = failing
        ? { data: null, error: { message: String((data as Rows).__error) } }
        : { data: data ?? [], error: null }

      const builder: any = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data: Array.isArray(result.data) ? result.data : result.data ? [result.data] : [],
            error: result.error,
          }),
      }
      return builder
    },
  }
}

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'

describe('listWorkspaceMaterials', () => {
  it('자료 상태 매핑을 올바르게 처리한다 (received, needs_review, learned, attention)', async () => {
    const client = fakeClient({
      knowledge_items: [
        { id: 'item-1', name: '업로드중.pdf', status: 'uploading', created_at: '2026-10-01T10:00:00Z' },
        { id: 'item-2', name: '확인필요.pdf', status: 'review_required', created_at: '2026-10-02T10:00:00Z' },
        { id: 'item-3', name: '학습완료.pdf', status: 'approved', created_at: '2026-10-03T10:00:00Z' },
        { id: 'item-4', name: '실패.pdf', status: 'failed', created_at: '2026-10-04T10:00:00Z' },
      ],
      knowledge_sources: [
        { id: 'src-1', display_name: '점검중URL', source_type: 'url', status: 'checking', created_at: '2026-10-05T10:00:00Z' },
        { id: 'src-2', display_name: '충돌문서', source_type: 'file', status: 'conflict', created_at: '2026-10-06T10:00:00Z' },
        { id: 'src-3', display_name: '반영URL', source_type: 'url', status: 'approved', created_at: '2026-10-07T10:00:00Z' },
        { id: 'src-4', display_name: '보관URL', source_type: 'url', status: 'archived', created_at: '2026-10-08T10:00:00Z' },
      ],
    })

    const result = await listWorkspaceMaterials(WS, client)

    expect(result.learnedCount).toBe(2) // item-3, src-3
    const map = new Map(result.items.map((i) => [i.id, i]))

    expect(map.get('item-1')).toEqual({
      id: 'item-1',
      source: 'item',
      name: '업로드중.pdf',
      kind: 'file',
      status: 'received',
      createdAt: '2026-10-01T10:00:00Z',
    })
    expect(map.get('item-2')?.status).toBe('needs_review')
    expect(map.get('item-3')?.status).toBe('learned')
    expect(map.get('item-4')?.status).toBe('attention')

    expect(map.get('src-1')).toEqual({
      id: 'src-1',
      source: 'source',
      name: '점검중URL',
      kind: 'url',
      status: 'received',
      createdAt: '2026-10-05T10:00:00Z',
    })
    expect(map.get('src-2')).toEqual({
      id: 'src-2',
      source: 'source',
      name: '충돌문서',
      kind: 'file',
      status: 'needs_review',
      createdAt: '2026-10-06T10:00:00Z',
    })
    expect(map.get('src-3')?.status).toBe('learned')
    expect(map.get('src-4')?.status).toBe('attention')
  })

  it('기타 모든 상태를 명세에 맞게 매핑한다 (registered, collection_pending, processing, rejected, paused, refresh_required, disabled)', async () => {
    const client = fakeClient({
      knowledge_items: [
        { id: 'item-reg', name: '등록.txt', status: 'registered', created_at: '2026-10-01T00:00:00Z' },
        { id: 'item-pending', name: '수집대기.txt', status: 'collection_pending', created_at: '2026-10-01T01:00:00Z' },
        { id: 'item-proc', name: '처리중.txt', status: 'processing', created_at: '2026-10-01T02:00:00Z' },
        { id: 'item-rej', name: '거절.txt', status: 'rejected', created_at: '2026-10-01T03:00:00Z' },
      ],
      knowledge_sources: [
        { id: 'src-pause', display_name: '일시정지', source_type: 'url', status: 'paused', created_at: '2026-10-01T04:00:00Z' },
        { id: 'src-ref', display_name: '갱신필요', source_type: 'url', status: 'refresh_required', created_at: '2026-10-01T05:00:00Z' },
        { id: 'src-dis', display_name: '비활성', source_type: 'url', status: 'disabled', created_at: '2026-10-01T06:00:00Z' },
        { id: 'src-unknown', display_name: '미지의상태', source_type: 'file', status: 'something_else', created_at: '2026-10-01T07:00:00Z' },
      ],
    })

    const result = await listWorkspaceMaterials(WS, client)
    const map = new Map(result.items.map((i) => [i.id, i.status]))

    expect(map.get('item-reg')).toBe('received')
    expect(map.get('item-pending')).toBe('received')
    expect(map.get('item-proc')).toBe('received')
    expect(map.get('item-rej')).toBe('attention')

    expect(map.get('src-pause')).toBe('attention')
    expect(map.get('src-ref')).toBe('attention')
    expect(map.get('src-dis')).toBe('attention')
    expect(map.get('src-unknown')).toBe('attention')
  })

  it('display_name이 "소희 인터뷰"인 knowledge_sources는 제외한다', async () => {
    const client = fakeClient({
      knowledge_items: [
        { id: 'item-1', name: '자료.pdf', status: 'approved', created_at: '2026-10-01T10:00:00Z' },
      ],
      knowledge_sources: [
        { id: 'src-interview', display_name: '소희 인터뷰', source_type: 'manual', status: 'approved', created_at: '2026-10-02T10:00:00Z' },
        { id: 'src-normal', display_name: '일반 블로그', source_type: 'url', status: 'approved', created_at: '2026-10-03T10:00:00Z' },
      ],
    })

    const result = await listWorkspaceMaterials(WS, client)

    expect(result.items.find((i) => i.id === 'src-interview')).toBeUndefined()
    expect(result.items.find((i) => i.id === 'src-normal')).toBeDefined()
    expect(result.learnedCount).toBe(2) // item-1, src-normal (src-interview는 제외되므로 count에 미포함)
  })

  it('createdAt 내림차순(최신순)으로 정렬하여 반환한다', async () => {
    const client = fakeClient({
      knowledge_items: [
        { id: 'item-old', name: '오래된자료', status: 'approved', created_at: '2026-09-01T00:00:00Z' },
        { id: 'item-new', name: '새자료', status: 'approved', created_at: '2026-10-05T00:00:00Z' },
      ],
      knowledge_sources: [
        { id: 'src-mid', display_name: '중간자료', source_type: 'url', status: 'approved', created_at: '2026-10-01T00:00:00Z' },
        { id: 'src-latest', display_name: '최신자료', source_type: 'url', status: 'approved', created_at: '2026-10-09T00:00:00Z' },
      ],
    })

    const result = await listWorkspaceMaterials(WS, client)

    expect(result.items.map((i) => i.id)).toEqual(['src-latest', 'item-new', 'src-mid', 'item-old'])
  })

  it('knowledge_items 쿼리 오류 시 throw한다', async () => {
    const client = fakeClient({
      knowledge_items: { __error: 'item query failed' },
      knowledge_sources: [],
    })

    await expect(listWorkspaceMaterials(WS, client)).rejects.toThrow()
  })

  it('knowledge_sources 쿼리 오류 시 throw한다', async () => {
    const client = fakeClient({
      knowledge_items: [],
      knowledge_sources: { __error: 'sources query failed' },
    })

    await expect(listWorkspaceMaterials(WS, client)).rejects.toThrow()
  })
})
