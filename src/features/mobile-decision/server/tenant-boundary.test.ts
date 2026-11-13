import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMobileReadDeps } from './production'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'
import { readWorkspaceDataset } from '@/features/reporting/dataset'
import { GET as home } from '@/app/api/workspaces/[workspaceId]/mobile-home/route'
import { GET as approval } from '@/app/api/workspaces/[workspaceId]/mobile-approvals/[itemKey]/route'
import { GET as weekly } from '@/app/api/workspaces/[workspaceId]/reports/weekly/route'

const boundary = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: boundary.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

const WS = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const ID = 'a0000000-0000-4000-8000-000000000002'
const NOW = '2026-10-25T09:00:00.000Z'
type Row = Record<string, unknown>

/** SQL/HTTP 인증의 대체가 아니다. 반환 행 오염과 권한 거부를 주입하는 앱 경계 테스트. */
function database(tables: Record<string, Row[] | Error>, leak = false) {
  const reads: string[] = []
  const client = { from(table: string) {
    reads.push(table)
    const source = tables[table] ?? []
    let rows = source instanceof Error ? [] : [...source]
    let columns = '*'
    let singular = false
    const chain = {
      select(value: string) { columns = value; return chain },
      eq(key: string, value: unknown) { if (!leak) rows = rows.filter(row => row[key] === value); return chain },
      neq(key: string, value: unknown) { rows = rows.filter(row => row[key] !== value); return chain },
      in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return chain },
      gt() { return chain }, gte() { return chain }, lt() { return chain }, order() { return chain },
      limit(limit: number) { rows = rows.slice(0, limit); return chain },
      range(start: number, end: number) { rows = rows.slice(start, end + 1); return chain },
      maybeSingle() { singular = true; return chain },
      then(resolve: (value: unknown) => unknown) {
        const selected = columns === '*' ? rows : rows.map(row => Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])))
        return Promise.resolve(resolve({ data: singular ? selected[0] ?? null : selected, error: source instanceof Error ? { message: source.message } : null }))
      },
    }
    return chain
  } } as unknown as SupabaseClient
  return { client, reads }
}
const registry = (workspaceId = WS, mode = 'ACTUAL') => database({ workspace_registry: [{ workspace_id: workspaceId, dataset_mode: mode }] })
const request = new Request('http://localhost/api/read')
const context = () => ({ params: Promise.resolve({ workspaceId: WS, itemKey: `comment:${ID}` }) })
const comment = (workspaceId = WS) => ({ id: ID, workspace_id: workspaceId, status: 'RECEIVED', comment_text: 'private-source', author_handle: 'private-author', created_at: NOW })
beforeEach(() => boundary.authorize.mockReset())

describe('ANI-1790 읽기 라우트 권한과 클라이언트 분리', () => {
  it.each([home, approval, weekly])('권한 fallback이 요청한 가게와 다르면 데이터를 읽지 않는다', async handler => {
    const db = database({ social_comments: [comment(OTHER)] })
    boundary.authorize.mockResolvedValue({ workspaceId: OTHER, userId: 'actor', supabase: db.client, admin: db.client })
    const response = await handler(request, context())
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(db.reads).toEqual([])
    expect(JSON.stringify(await response.json())).not.toContain('private-source')
  })

  it.each([401, 403])('인증/역할 거부 %s를 no-store로 그대로 전달한다', async status => {
    for (const handler of [home, approval, weekly]) {
      boundary.authorize.mockResolvedValue(new Response('{}', { status }))
      const response = await handler(request, context())
      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('홈·승인 업무 행은 사용자 RLS로, registry만 서버 metadata client로 읽는다', async () => {
    const user = database({ social_comments: [comment()], workspace_registry: new Error('registry is server-only') })
    const metadata = registry()
    boundary.authorize.mockResolvedValue({ workspaceId: WS, userId: 'actor', supabase: user.client, admin: metadata.client })
    const homeResponse = await home(request, context())
    const detailResponse = await approval(request, context())
    const dto = await homeResponse.json()
    expect(dto.decisions.data.items).toMatchObject([{ id: `comment:${ID}` }])
    expect(await detailResponse.json()).toMatchObject({ sourceText: 'private-source', datasetMode: 'ACTUAL', writeState: 'unsupported' })
    expect(user.reads).toContain('social_comments')
    expect(metadata.reads.every(table => table === 'workspace_registry')).toBe(true)
  })

  it.each(['TEST', 'CANARY', 'SHOWCASE_DEMO', 'UNKNOWN'])('홈·승인은 registry=%s이면 업무 행을 읽지 않는다', async mode => {
    const user = database({ social_comments: [comment()] })
    boundary.authorize.mockResolvedValue({ workspaceId: WS, userId: 'actor', supabase: user.client, admin: registry(WS, mode).client })
    for (const handler of [home, approval]) {
      const response = await handler(request, context())
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(JSON.stringify(await response.json())).not.toContain('private-source')
    }
    expect(user.reads).toEqual([])
  })

  it('registry 조회 실패도 빈 업무 목록으로 위장하지 않는다', async () => {
    const user = database({ social_comments: [comment()] })
    const metadata = database({ workspace_registry: new Error('permission denied') })
    boundary.authorize.mockResolvedValue({ workspaceId: WS, userId: 'actor', supabase: user.client, admin: metadata.client })
    for (const handler of [home, approval]) expect((await handler(request, context())).status).toBe(503)
    expect(user.reads).toEqual([])
  })

  it('주간 리포트는 registry 읽기 권한을 업무 테이블 읽기 권한으로 확대하지 않는다', async () => {
    const user = database({ reservations: [{ id: ID, workspace_id: WS, status: 'CONFIRMED' }] })
    const metadata = registry()
    boundary.authorize.mockResolvedValue({ workspaceId: WS, userId: 'actor', supabase: user.client, admin: metadata.client })
    const response = await weekly(request, context())
    expect(await response.json()).toMatchObject({ workspaceId: WS, confirmedBookingsCount: 1 })
    expect(user.reads).toContain('reservations')
    expect(metadata.reads.every(table => table === 'workspace_registry')).toBe(true)
  })
})

describe('ANI-1790 반환 행 오염 2차 방어', () => {
  it.each(['social_comments', 'marketing_missions', 'instagram_dm_threads'])('%s 타 가게 행은 결정 목록에 노출하지 않는다', async table => {
    const row = { ...comment(OTHER), status: table === 'marketing_missions' ? 'AWAITING_APPROVAL' : table === 'instagram_dm_threads' ? 'NEEDS_REPLY' : 'RECEIVED', metadata: { caption: 'private-source' }, customer_handle: 'private-author', expires_at: '2027-01-01T00:00:00Z' }
    const result = await createMobileReadDeps(database({ [table]: [row] }, true).client, () => NOW).readDecisions({ workspaceId: WS, userId: 'actor' })
    expect(result.state).toBe('error')
    expect(JSON.stringify(result)).not.toMatch(/private-source|private-author/)
  })

  it.each(['comment', 'post', 'dm'])('%s 타 가게 승인 원문을 요청한 가게 DTO로 세탁하지 않는다', async kind => {
    const row = { ...comment(OTHER), metadata: { caption: 'private-source' }, last_message_text: 'private-source' }
    const db = database({ social_comments: [row], marketing_missions: [row], instagram_dm_threads: [row] }, true)
    await expect(createMobileReadDeps(db.client).readApproval({ workspaceId: WS, userId: 'actor' }, `${kind}:${ID}`)).rejects.toThrow()
  })

  it('본문뿐 아니라 타 가게 답안 draft가 섞여도 거부한다', async () => {
    const db = database({ social_comments: [comment()], comment_reply_drafts: [{ id: ID, workspace_id: OTHER, comment_id: ID, draft_text: 'private-draft' }] }, true)
    await expect(createMobileReadDeps(db.client).readApproval({ workspaceId: WS, userId: 'actor' }, `comment:${ID}`)).rejects.toThrow()
  })

  it('최근 작업의 다른 가게 행은 부분 정상 목록으로 숨기지 않는다', async () => {
    const result = await createMobileReadDeps(database({ content_items: [{ id: ID, workspace_id: OTHER, title: 'private-source', status: 'review', updated_at: NOW }] }, true).client).readActivity({ workspaceId: WS, userId: 'actor' })
    expect(result).toMatchObject({ state: 'error', data: null })
  })

  it('주간 집계에 타 가게 행이 섞이면 숫자·근거를 만들지 않는다', async () => {
    const db = database({ workspace_registry: [{ workspace_id: WS, dataset_mode: 'ACTUAL' }], reservations: [{ id: ID, workspace_id: OTHER, status: 'CONFIRMED' }] }, true)
    const report = await new WeeklyCeoReportService(db.client).generateReport(WS)
    expect(report.metrics.bookingConfirmed).toMatchObject({ state: 'ERROR', value: null, evidenceIds: [] })
  })

  it.each([OTHER, undefined])('registry 반환 workspace=%s는 ACTUAL로 승격하지 않는다', async workspaceId => {
    const db = database({ workspace_registry: [{ workspace_id: workspaceId, dataset_mode: 'ACTUAL' }] }, true)
    expect(await readWorkspaceDataset(db.client, WS)).toMatchObject({ mode: 'UNKNOWN' })
  })
})
