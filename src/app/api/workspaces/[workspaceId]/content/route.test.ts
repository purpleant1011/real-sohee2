import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const { authorize, listContents, createContent, requireSoheeReady } = vi.hoisted(() => ({
  authorize: vi.fn(),
  listContents: vi.fn(),
  createContent: vi.fn(),
  requireSoheeReady: vi.fn(),
}))

class FakeSoheeNotReadyError extends Error {
  code = 'SOHEE_NOT_READY'
  snapshot = { blockers: [{ id: 'channel_missing', label: '채널 미연결' }] }
  membershipTier = 'FREE'
  membershipNotice = null
  notice = null
  constructor() {
    super('소희가 아직 준비되지 않았어요.')
  }
}

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/content/canonical-content-lifecycle', () => ({
  CanonicalContentLifecycleService: { listWorkspaceContents: listContents, createContent },
}))
vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady,
  SoheeNotReadyError: FakeSoheeNotReadyError,
}))

const workspaceId = '00000000-0000-0000-0000-0000000000bb'
const context = { params: Promise.resolve({ workspaceId }) }
const getRequest = () => new NextRequest(`https://example.test/api/workspaces/${workspaceId}/content`)
const postRequest = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/content`, {
    method: 'POST',
    body: JSON.stringify({ channel: 'instagram', caption: '오늘의 신메뉴 안내' }),
  })

const contentsFixture = [{ contentId: 'c-1', channel: 'instagram', title: '신메뉴', caption: '오늘의 신메뉴 안내' }]

beforeEach(() => {
  authorize.mockReset()
  listContents.mockReset()
  createContent.mockReset()
  requireSoheeReady.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  listContents.mockResolvedValue(contentsFixture)
  createContent.mockResolvedValue({ contentId: 'c-2' })
  requireSoheeReady.mockResolvedValue(undefined)
})

describe('mobile content list projection', () => {
  const mobileRequest = () => new NextRequest(`https://example.test/api/workspaces/${workspaceId}/content?view=mobile-list`)
  function database(data: unknown, error: unknown = null) {
    const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), or: vi.fn(() => query), limit: vi.fn(async () => ({ data, error })) }
    const from = vi.fn(() => query)
    authorize.mockResolvedValue({ userId: 'owner', workspaceId, supabase: { from }, admin: {} })
    return { query, from }
  }
  const item = { id: 'draft-without-version', workspace_id: workspaceId, title: '준비 중인 글', channel: 'instagram', status: 'draft', created_at: '2026-10-28T00:00:00Z' }

  it('버전 없는 초안도 목록에 표시하고 본문·승인·이미지는 조회하지 않는다', async () => {
    const db = database([item])
    const response = await GET(mobileRequest(), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, complete: true, hasMore: false, nextCursor: null, contents: [{ contentId: item.id, workspaceId, title: item.title, status: 'draft', publicationVerified: false }] })
    expect(db.from.mock.calls).toEqual([['content_items']])
    expect(db.query.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(db.query.select.mock.calls[0][0]).not.toContain('*')
    expect(db.query.limit).toHaveBeenCalledWith(201)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(listContents).not.toHaveBeenCalled()
  })
  it('끝까지 조회한 실제 빈 목록은 완전한 조회로 반환한다', async () => {
    database([])
    expect(await (await GET(mobileRequest(), context)).json()).toMatchObject({ success: true, contents: [], complete: true, hasMore: false })
  })
  it.each([null, [{ ...item, workspace_id: 'another-workspace' }], [{ ...item, title: null }]])('불명확하거나 타 매장인 행은 빈 성공으로 바꾸지 않는다', async data => {
    database(data)
    expect((await GET(mobileRequest(), context)).status).toBe(500)
  })
  it('201번째 행이 있으면 200건과 다음 커서를 반환하고 같은 시각의 id로 다음 조회를 고정한다', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ ...item, id: `20000000-0000-4000-8000-${String(500 - index).padStart(12, '0')}` }))
    database(rows)
    const first = await (await GET(mobileRequest(), context)).json()
    expect(first.contents).toHaveLength(200)
    expect(first.complete).toBe(false)
    expect(first.hasMore).toBe(true)
    expect(typeof first.nextCursor).toBe('string')
    const secondDb = database([rows[200]])
    const next = new NextRequest(`${mobileRequest().url}&cursor=${encodeURIComponent(first.nextCursor)}`)
    const second = await (await GET(next, context)).json()
    expect(second.complete).toBe(true)
    expect(secondDb.query.or).toHaveBeenCalledWith(`created_at.lt.2026-10-28T00:00:00Z,and(created_at.eq.2026-10-28T00:00:00Z,id.lt.${rows[199].id})`)
  })

  it('DB 오류는 목록 없음이 아닌 실패다', async () => {
    database([], { message: 'unavailable' })
    expect((await GET(mobileRequest(), context)).status).toBe(500)
  })

  it('게시 확인 영수증이 검증된 행은 publicationVerified: true로 반환한다', async () => {
    const publishedItem = {
      id: 'published-content-1',
      workspace_id: workspaceId,
      title: '발행 완료 글',
      channel: 'instagram',
      status: 'published',
      created_at: '2026-10-28T00:00:00Z',
      current_version_id: 'v1',
    }
    const schedule = { id: 'sched-1', workspace_id: workspaceId, content_id: publishedItem.id, version_id: 'v1' }
    const receipt = {
      id: 'receipt-1',
      workspace_id: workspaceId,
      schedule_id: schedule.id,
      receipt_kind: 'observed_result',
      provider_reference: 'p-1',
      recorded_at: '2026-10-28T00:01:00Z',
      observed_payload: {
        channel: 'instagram',
        published_post_id: 'p-1',
        verified: true,
        read_after_write: true,
      },
    }

    const tables: Record<string, any[]> = {
      content_items: [publishedItem],
      schedules: [schedule],
      external_action_receipts: [receipt],
    }

    const queryFor = (table: string) => {
      let rows: any[] = [...(tables[table] ?? [])]
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn((key: string, value: unknown) => {
          rows = rows.filter(r => r[key] === value)
          return chain
        }),
        in: vi.fn((key: string, values: unknown[]) => {
          rows = rows.filter(r => values.includes(r[key]))
          return chain
        }),
        order: vi.fn(() => chain),
        or: vi.fn(() => chain),
        limit: vi.fn(async (n: number) => ({ data: rows.slice(0, n), error: null })),
        then: (resolve: (val: any) => any) => Promise.resolve(resolve({ data: rows, error: null })),
      }
      return chain
    }

    const from = vi.fn((table: string) => queryFor(table))
    authorize.mockResolvedValue({ userId: 'owner', workspaceId, supabase: { from }, admin: {} })

    const response = await GET(mobileRequest(), context)
    const json = await response.json()
    expect(json.contents[0]).toMatchObject({
      contentId: publishedItem.id,
      status: 'published',
      publicationVerified: true,
    })
  })

  it('채널 불일치 영수증은 publicationVerified: false로 거부한다', async () => {
    const publishedItem = {
      id: 'published-content-2',
      workspace_id: workspaceId,
      title: '발행 완료 글',
      channel: 'instagram',
      status: 'published',
      created_at: '2026-10-28T00:00:00Z',
    }
    const schedule = { id: 'sched-2', workspace_id: workspaceId, content_id: publishedItem.id }
    const receipt = {
      id: 'receipt-2',
      workspace_id: workspaceId,
      schedule_id: schedule.id,
      receipt_kind: 'observed_result',
      provider_reference: 'p-2',
      recorded_at: '2026-10-28T00:01:00Z',
      observed_payload: {
        channel: 'threads', // 콘텐츠 채널 instagram과 불일치
        published_post_id: 'p-2',
        verified: true,
        read_after_write: true,
      },
    }

    const tables: Record<string, any[]> = {
      content_items: [publishedItem],
      schedules: [schedule],
      external_action_receipts: [receipt],
    }

    const queryFor = (table: string) => {
      let rows: any[] = [...(tables[table] ?? [])]
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn((k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return chain }),
        in: vi.fn((k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return chain }),
        order: vi.fn(() => chain),
        or: vi.fn(() => chain),
        limit: vi.fn(async (n: number) => ({ data: rows.slice(0, n), error: null })),
        then: (resolve: (val: any) => any) => Promise.resolve(resolve({ data: rows, error: null })),
      }
      return chain
    }

    const from = vi.fn((table: string) => queryFor(table))
    authorize.mockResolvedValue({ userId: 'owner', workspaceId, supabase: { from }, admin: {} })

    const response = await GET(mobileRequest(), context)
    const json = await response.json()
    expect(json.contents[0]).toMatchObject({
      contentId: publishedItem.id,
      status: 'published',
      publicationVerified: false,
    })
  })

  it('영수증 쿼리 실패 시에도 전체 조회가 무너지지 않고 publicationVerified: false로 남는다', async () => {
    const publishedItem = {
      id: 'published-content-3',
      workspace_id: workspaceId,
      title: '발행 완료 글',
      channel: 'instagram',
      status: 'published',
      created_at: '2026-10-28T00:00:00Z',
    }

    const queryFor = (table: string) => {
      if (table === 'external_action_receipts') {
        const errorChain: any = {
          select: vi.fn(() => errorChain),
          eq: vi.fn(() => errorChain),
          in: vi.fn(() => errorChain),
          then: (resolve: (val: any) => any) => Promise.resolve(resolve({ data: null, error: { message: 'FAIL' } })),
        }
        return errorChain
      }
      let rows: any[] = table === 'content_items' ? [publishedItem] : []
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn((k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return chain }),
        in: vi.fn((k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return chain }),
        order: vi.fn(() => chain),
        or: vi.fn(() => chain),
        limit: vi.fn(async (n: number) => ({ data: rows.slice(0, n), error: null })),
        then: (resolve: (val: any) => any) => Promise.resolve(resolve({ data: rows, error: null })),
      }
      return chain
    }

    const from = vi.fn((table: string) => queryFor(table))
    authorize.mockResolvedValue({ userId: 'owner', workspaceId, supabase: { from }, admin: {} })

    const response = await GET(mobileRequest(), context)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.contents[0]).toMatchObject({
      contentId: publishedItem.id,
      publicationVerified: false,
    })
  })

  it('실제 운영 writer 형태인 publish_attempts + social_post_tracking permalink로도 publicationVerified: true로 반환한다', async () => {
    const publishedItem = {
      id: 'published-content-live',
      workspace_id: workspaceId,
      title: '운영 실게시 원고',
      channel: 'instagram',
      status: 'published',
      created_at: '2026-10-28T00:00:00Z',
      current_version_id: 'v1',
    }
    const schedule = { id: 'sched-live', workspace_id: workspaceId, content_id: publishedItem.id, version_id: 'v1' }
    const attempt = {
      id: 'attempt-live',
      workspace_id: workspaceId,
      schedule_id: schedule.id,
      status: 'succeeded',
      error_code: null,
      provider_request_id: 'req-live',
      provider_reference: 'post-live-ig',
      finished_at: '2026-10-28T00:02:00Z',
    }
    const tracking = {
      id: 'track-live',
      workspace_id: workspaceId,
      publish_attempt_id: attempt.id,
      destination_url: 'https://www.instagram.com/p/DfjpR8GkveI/',
    }

    const tables: Record<string, any[]> = {
      content_items: [publishedItem],
      schedules: [schedule],
      external_action_receipts: [], // modern receipt 없음
      publish_attempts: [attempt],
      social_post_tracking: [tracking],
    }

    const queryFor = (table: string) => {
      let rows: any[] = [...(tables[table] ?? [])]
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn((k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return chain }),
        in: vi.fn((k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return chain }),
        order: vi.fn(() => chain),
        or: vi.fn(() => chain),
        limit: vi.fn(async (n: number) => ({ data: rows.slice(0, n), error: null })),
        then: (resolve: (val: any) => any) => Promise.resolve(resolve({ data: rows, error: null })),
      }
      return chain
    }

    const from = vi.fn((table: string) => queryFor(table))
    authorize.mockResolvedValue({ userId: 'owner', workspaceId, supabase: { from }, admin: {} })

    const response = await GET(mobileRequest(), context)
    const json = await response.json()
    expect(json.contents[0]).toMatchObject({
      contentId: publishedItem.id,
      status: 'published',
      publicationVerified: true,
    })
  })
  it('비회원은 요약 조회에도 접근하지 못한다', async () => {
    authorize.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await GET(mobileRequest(), context)).status).toBe(403)
    expect(listContents).not.toHaveBeenCalled()
  })
})

describe('content route', () => {
  it('returns the canonical content list unchanged for an active member', async () => {
    const response = await GET(getRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, contents: contentsFixture })
  })

  it('returns a failed read as 500 rather than a successful empty list', async () => {
    listContents.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await GET(getRequest(), context)
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'FETCH_CONTENT_FAILED' } })
  })

  it('refuses a non-member GET with 403 before listing workspace content (E2E-F F-2)', async () => {
    authorize.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }), {
        status: 403,
      }),
    )

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(403)
    expect(listContents).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('신메뉴')
  })

  it('never returns another workspace readiness state to a non-member POST', async () => {
    authorize.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }), {
        status: 403,
      }),
    )

    const response = await POST(postRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(requireSoheeReady).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('SOHEE_NOT_READY')
    expect(JSON.stringify(body)).not.toContain('채널 미연결')
  })

  it('still reports SOHEE_NOT_READY blockers to an active member', async () => {
    requireSoheeReady.mockRejectedValueOnce(new FakeSoheeNotReadyError())

    const response = await POST(postRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('SOHEE_NOT_READY')
    expect(body.error.blockers).toHaveLength(1)
  })

  it('creates content for an active member', async () => {
    const response = await POST(postRequest(), context)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, content: { contentId: 'c-2' } })
  })
})
