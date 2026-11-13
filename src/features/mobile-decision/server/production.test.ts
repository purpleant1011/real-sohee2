import { describe, expect, it } from 'vitest'
import { createMobileReadDeps } from './production'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'
import { currentReportingEnd } from '@/features/reporting/observation'
import { metricText } from '../selectors'

type Row = Record<string, unknown>
function database(tables: Record<string, Row[]>, broken?: string): SupabaseClient {
  return { from(table: string) {
    const source: Row[] = table === 'agent_energy_ledgers' && !tables[table]
      ? (tables.workspace_runtime_control_states ?? []).map(row => ({ workspace_id: row.workspace_id, remaining_available_energy: 10 }))
      : tables[table] ?? []
    let rows = [...source]
    let singular = false
    const chain = {
      select() { return chain },
      eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return chain },
      neq(key: string, value: unknown) { rows = rows.filter(row => row[key] !== value); return chain },
      in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return chain },
      gt(key: string, value: string) { rows = rows.filter(row => String(row[key]) > value); return chain },
      gte(key: string, value: string) { rows = rows.filter(row => String(row[key]) >= value); return chain },
      lt(key: string, value: string) { rows = rows.filter(row => String(row[key]) < value); return chain },
      range(start: number, end: number) { rows = rows.slice(start, end + 1); return chain },
      order() { return chain }, limit(n: number) { rows = rows.slice(0, n); return chain },
      maybeSingle() { singular = true; return chain },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: singular ? rows[0] ?? null : rows, error: table === broken ? { message: 'private' } : null })) },
    }
    return chain
  } } as unknown as SupabaseClient
}
const ctx = { workspaceId: 'a', userId: 'owner' }
const id = '00000000-0000-4000-8000-000000000001'
describe('mobile read-only production adapter', () => {
  it('filters expired DMs before pagination so old threads cannot hide pending customers', async () => {
    const expired = Array.from({ length: 60 }, (_, index) => ({ id: `old-${index}`, workspace_id: 'a', status: 'NEEDS_REPLY', customer_handle: 'old', created_at: '2026-10-14T00:00:00Z', expires_at: '2026-10-15T00:00:00Z' }))
    const live = { id, workspace_id: 'a', status: 'NEEDS_REPLY', customer_handle: 'pending', created_at: '2026-10-16T00:00:00Z', expires_at: '2026-10-17T00:00:00Z' }
    const deps = createMobileReadDeps(database({ instagram_dm_threads: [...expired, live] }), () => '2026-10-16T01:00:00Z')
    const result = await deps.readDecisions(ctx)
    expect(result.data?.items.map(item => item.id)).toEqual([`dm:${id}`])
    expect(result.data?.total).toBe(1)
  })
  it('uses the workspace timezone instead of leaving every real shop date unknown', async () => {
    const deps = createMobileReadDeps(database({ workspaces: [{ id: 'a', timezone: 'Asia/Seoul' }], business_profiles: [{ workspace_id: 'a', business_name: '매장' }] }))
    expect(await deps.readIdentity(ctx)).toEqual({ businessName: '매장', timeZone: 'Asia/Seoul' })
  })
  it('loads stored source text but never invents a DM draft or booking', async () => {
    const deps = createMobileReadDeps(database({ instagram_dm_threads: [
      { id, workspace_id: 'a', customer_handle: 'fixture', last_message_text: '가격 문의', status: 'NEEDS_REPLY', expires_at: '2026-10-17T01:00:00Z', created_at: '2026-10-16T00:00:00Z' },
    ] }), () => '2026-10-16T01:00:00Z')
    const detail = await deps.readApproval(ctx, `dm:${id}`)
    expect(detail).toMatchObject({ sourceText: '가격 문의', fullContent: null, writeState: 'unsupported' })
    expect(JSON.stringify(detail)).not.toContain('예약금')
    expect(await deps.readApproval({ ...ctx, workspaceId: 'other' }, `dm:${id}`)).toBeNull()
  })
  it('preserves source query failure rather than reporting all-clear', async () => {
    const deps = createMobileReadDeps(database({}, 'social_comments'), () => '2026-10-16T01:00:00Z')
    const result = await deps.readDecisions(ctx)
    expect(result.state).toBe('error')
    expect(result.data?.complete).toBe(false)
    expect(result.data?.total).toBeNull()
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('does not manufacture performance or autonomy', async () => {
    const deps = createMobileReadDeps(database({}), () => '2026-10-16T01:00:00Z')
    expect(await deps.readResults(ctx)).toMatchObject({ state: 'unknown', data: null })
    expect(await deps.readAgent(ctx)).toMatchObject({ state: 'unknown', data: null })
  })
})

describe('mobile recent work activity', () => {
  const now = () => '2026-10-16T01:00:00Z'
  const content = (id: string, status: string, updatedAt: string, overrides: Row = {}) => ({
    id, workspace_id: 'a', title: '가을 홍보 문안', status, channel: 'instagram', updated_at: updatedAt, current_version_id: 'v1', ...overrides,
  })

  it('shows unverified published content as 게시 확인 전 without provider readback', async () => {
    const publishedId = '00000000-0000-4000-8000-000000000099'
    const db = database({
      content_items: [content(publishedId, 'published', '2026-10-16T00:40:00Z')],
    })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.[0]).toMatchObject({
      id: `content:${publishedId}`,
      statusLabel: '게시 확인 전',
    })
  })

  it('shows published content as 게시 완료 only when provider readback receipt is verified', async () => {
    const publishedId = '00000000-0000-4000-8000-000000000098'
    const scheduleId = 'schedule-verified-1'
    const db = database({
      content_items: [content(publishedId, 'published', '2026-10-16T00:40:00Z')],
      schedules: [{ id: scheduleId, workspace_id: 'a', content_id: publishedId, version_id: 'v1', status: 'succeeded', updated_at: '2026-10-16T00:41:00Z' }],
      external_action_receipts: [{
        id: 'receipt-verified-1',
        workspace_id: 'a',
        schedule_id: scheduleId,
        receipt_kind: 'observed_result',
        provider_reference: 'post-98',
        recorded_at: '2026-10-16T00:41:00Z',
        observed_payload: { channel: 'instagram', published_post_id: 'post-98', verified: true, read_after_write: true },
      }],
    })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.[0]).toMatchObject({
      id: `content:${publishedId}`,
      statusLabel: '게시 완료',
    })
  })

  it('shows published content as 게시 완료 when publish_attempts and tracking permalink are verified', async () => {
    const publishedId = '00000000-0000-4000-8000-000000000097'
    const scheduleId = 'schedule-verified-2'
    const attemptId = 'attempt-live-1'
    const db = database({
      content_items: [content(publishedId, 'published', '2026-10-16T00:40:00Z')],
      schedules: [{ id: scheduleId, workspace_id: 'a', content_id: publishedId, version_id: 'v1', status: 'succeeded', updated_at: '2026-10-16T00:41:00Z' }],
      publish_attempts: [{
        id: attemptId,
        workspace_id: 'a',
        schedule_id: scheduleId,
        status: 'succeeded',
        error_code: null,
        provider_request_id: 'req-live-1',
        provider_reference: 'post-live-97',
        finished_at: '2026-10-16T00:42:00Z',
      }],
      social_post_tracking: [{
        id: 'track-live-1',
        workspace_id: 'a',
        publish_attempt_id: attemptId,
        destination_url: 'https://www.instagram.com/p/DfjpR8GkveI/',
      }],
    })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.[0]).toMatchObject({
      id: `content:${publishedId}`,
      statusLabel: '게시 완료',
    })
    expect(JSON.parse(result.data![0].evidenceRef!)).toMatchObject({
      source: 'publish_attempts.permalink_readback',
      contentId: publishedId,
      evidenceId: attemptId,
      publishAttemptId: attemptId,
      providerReference: 'post-live-97',
      permalink: 'https://www.instagram.com/p/DfjpR8GkveI/',
    })
  })

  it('reads the canonical work ledger newest first with desktop status labels and query provenance', async () => {
    const db = database({ content_items: [
      content('00000000-0000-4000-8000-000000000001', 'review', '2026-10-16T00:10:00Z'),
      content('00000000-0000-4000-8000-000000000002', 'published', '2026-10-16T00:40:00Z'),
      content('00000000-0000-4000-8000-000000000003', 'approved', '2026-10-16T00:25:00Z'),
    ] })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.state).toBe('ready')
    expect(result.data?.map(item => item.statusLabel)).toEqual(['게시 확인 전', '승인 완료', '승인 대기'])
    expect(result.data?.[0].id).toBe('content:00000000-0000-4000-8000-000000000002')
    expect(result.data?.[0].observedAt).toBe('2026-10-16T00:40:00Z')
    expect(JSON.parse(result.data![0].evidenceRef!)).toEqual({
      source: 'content_items.status/unverified_publish', contentId: '00000000-0000-4000-8000-000000000002',
      status: 'published', observedAt: '2026-10-16T00:40:00Z',
    })
  })
  it('keeps an empty ledger distinct from a failed query', async () => {
    const empty = await createMobileReadDeps(database({ content_items: [] }), now).readActivity(ctx)
    expect(empty).toMatchObject({ state: 'ready', data: [] })
    const failed = await createMobileReadDeps(database({}, 'content_items'), now).readActivity(ctx)
    expect(failed).toMatchObject({ state: 'error', data: null })
    expect(JSON.stringify(failed)).not.toContain('private')
  })
  it('never presents archived work or another workspace as recent activity', async () => {
    const db = database({ content_items: [
      content('00000000-0000-4000-8000-000000000004', 'archived', '2026-10-16T00:50:00Z'),
      content('00000000-0000-4000-8000-000000000005', 'draft', '2026-10-16T00:45:00Z', { workspace_id: 'b' }),
      content('00000000-0000-4000-8000-000000000006', 'draft', '2026-10-16T00:20:00Z'),
    ] })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.map(item => item.id)).toEqual(['content:00000000-0000-4000-8000-000000000006'])
    expect(result.data?.[0].statusLabel).toBe('초안 준비')
  })
  it('shows a failed publish as recovery needed instead of normal preparation', async () => {
    const scheduledId = '00000000-0000-4000-8000-000000000010'
    const publishedId = '00000000-0000-4000-8000-000000000011'
    const db = database({
      content_items: [
        content(scheduledId, 'scheduled', '2026-10-16T00:10:00Z'),
        content(publishedId, 'published', '2026-10-16T00:05:00Z'),
      ],
      // record_publish_result 는 실패 시 schedules.status 만 'failed' 로 바꾸고 content_items 는 건드리지 않는다.
      schedules: [{ id: 'schedule-1', workspace_id: 'a', content_id: scheduledId, status: 'failed', updated_at: '2026-10-16T00:50:00Z' }],
    })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.[0]).toMatchObject({ id: `content:${scheduledId}`, statusLabel: '게시 복구 필요', observedAt: '2026-10-16T00:50:00Z' })
    expect(JSON.parse(result.data![0].evidenceRef!)).toEqual({
      source: 'schedules.status', contentId: scheduledId, scheduleId: 'schedule-1',
      status: 'failed', observedAt: '2026-10-16T00:50:00Z',
    })
    // 실패와 무관한 작업은 정상 문구를 유지한다(readback 미검증 시 게시 확인 전).
    expect(result.data?.find(item => item.id === `content:${publishedId}`)?.statusLabel).toBe('게시 확인 전')
  })
  it('surfaces a failed publish even when its content falls outside the recent window', async () => {
    const failedId = '00000000-0000-4000-8000-000000000020'
    const recent = Array.from({ length: 7 }, (_, index) => content(
      `00000000-0000-4000-8000-00000000010${index}`, 'draft', `2026-10-16T00:${String(40 - index).padStart(2, '0')}:00Z`))
    const db = database({
      content_items: [...recent, content(failedId, 'scheduled', '2026-10-01T00:00:00Z')],
      schedules: [{ id: 'schedule-2', workspace_id: 'a', content_id: failedId, status: 'failed', updated_at: '2026-10-16T00:55:00Z' }],
    })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.[0]).toMatchObject({ id: `content:${failedId}`, statusLabel: '게시 복구 필요' })
  })
  it('does not present work as normal when the publish schedule query fails', async () => {
    const db = database({ content_items: [content('00000000-0000-4000-8000-000000000030', 'scheduled', '2026-10-16T00:10:00Z')] }, 'schedules')
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result).toMatchObject({ state: 'error', data: null })
  })
  it('does not guess a label for an unrecognized stored status', async () => {
    const db = database({ content_items: [content('00000000-0000-4000-8000-000000000007', 'MYSTERY', '2026-10-16T00:20:00Z')] })
    const result = await createMobileReadDeps(db, now).readActivity(ctx)
    expect(result.data?.[0].statusLabel).toBe('상태 확인 필요')
  })
})


describe('mobile canonical weekly results', () => {
  const now = () => '2026-10-16T01:00:00Z'
  const classification = [{ workspace_id: 'a', dataset_mode: 'ACTUAL' }]
  it('uses the same cancellation, publication, revenue and UTC window as desktop', async () => {
    const db = database({
      workspace_registry: classification,
      reservations: [
        { id: 'confirmed', workspace_id: 'a', status: 'CONFIRMED', created_at: '2026-10-16T00:00:00Z', total_amount_krw: 90000 },
        { id: 'canceled', workspace_id: 'a', status: 'CANCELLED', created_at: '2026-10-16T00:00:00Z' },
      ],
      external_action_receipts: [{ id: 'receipt-1', workspace_id: 'a', recorded_at: '2026-10-16T00:00:00Z',
        receipt_kind: 'observed_result', provider_reference: 'post-1',
        observed_payload: { channel: 'instagram', published_post_id: 'post-1', verified: true, read_after_write: true } }],
    })
    const desktop = await new WeeklyCeoReportService(db).generateReport(ctx.workspaceId, currentReportingEnd(new Date(now())))
    const mobile = await createMobileReadDeps(db, now).readResults(ctx)
    expect(mobile.state).toBe('ready')
    expect(mobile.data?.find(metric => metric.id === 'published')?.value).toBe(desktop.publishedPostsCount)
    expect(mobile.data?.find(metric => metric.id === 'bookings')?.value).toBe(desktop.confirmedBookingsCount)
    expect(mobile.data?.find(metric => metric.id === 'revenue')).toMatchObject({ value: null, state: 'unknown', evidenceRef: null })
    expect(mobile.data?.[0].period).toEqual({ ...desktop.period, timeZone: 'UTC' })
    expect(metricText(mobile.data![0])).toBe('1건')
  })
  it('shows a queried zero without fabricating a provider receipt', async () => {
    const result = await createMobileReadDeps(database({ workspace_registry: classification }), now).readResults(ctx)
    const bookings = result.data?.find(metric => metric.id === 'bookings')
    expect(bookings).toMatchObject({ value: 0, state: 'ready', datasetMode: 'ACTUAL' })
    expect(metricText(bookings!)).toBe('0건')
    expect(bookings?.evidenceRef).toContain('reservations.created_at/current_status')
  })
  it('does not turn an actual reservation query error into zero', async () => {
    const result = await createMobileReadDeps(database({ workspace_registry: classification }, 'reservations'), now).readResults(ctx)
    expect(result.data?.find(metric => metric.id === 'bookings')).toMatchObject({ value: null, state: 'error', evidenceRef: null })
  })
})

describe('mobile agent status from canonical runtime control', () => {
  const now = () => '2026-10-16T01:00:00Z'
  const control = (overrides: Row = {}) => ({
    workspace_id: 'a', desired_mode: 'RUNNING', actual_mode: 'RUNNING',
    active_action_run_count: 0, kill_switch_active: false, version: 3,
    updated_at: '2026-10-16T00:59:00Z', ...overrides,
  })
  const href = '/app/sohee?tab=work&section=autonomy'

  it('shows the stored runtime mode with the same wording as the autonomy control', async () => {
    const result = await createMobileReadDeps(database({ workspace_runtime_control_states: [control({ active_action_run_count: 2 })] }), now).readAgent(ctx)
    expect(result).toEqual({ state: 'ready', data: { label: '2건 진행 중', detailHref: href }, observedAt: '2026-10-16T00:59:00Z', validUntil: null })
  })
  it('keeps a paused agent distinct from an unconfirmed one', async () => {
    const paused = await createMobileReadDeps(database({ workspace_runtime_control_states: [control({ desired_mode: 'PAUSED', actual_mode: 'PAUSED' })] }), now).readAgent(ctx)
    expect(paused.data?.label).toBe('중지됨 · 새 일을 시작하지 않아요')
    expect((await createMobileReadDeps(database({}), now).readAgent(ctx)).state).toBe('unknown')
  })
  it('reports a kill switch or exhausted energy as blocked, like /agent/control', async () => {
    const switched = await createMobileReadDeps(database({
      workspace_runtime_control_states: [control()],
      kill_switches: [{ id: 'sw-1', scope: 'WORKSPACE', target_id: 'a', is_active: true, reason: '점검' }],
    }), now).readAgent(ctx)
    expect(switched.data?.label).toBe('안전을 위해 멈춰 있어요')
    const drained = await createMobileReadDeps(database({
      workspace_runtime_control_states: [control()],
      agent_energy_ledgers: [{ workspace_id: 'a', remaining_available_energy: 0 }],
    }), now).readAgent(ctx)
    expect(drained.data?.label).toBe('안전을 위해 멈춰 있어요')
  })
  it('does not read another workspace runtime state', async () => {
    const result = await createMobileReadDeps(database({ workspace_runtime_control_states: [control({ workspace_id: 'b' })] }), now).readAgent(ctx)
    expect(result).toMatchObject({ state: 'unknown', data: null })
  })
  it('reports a query failure as an error instead of a paused agent', async () => {
    const result = await createMobileReadDeps(database({ workspace_runtime_control_states: [control()] }, 'workspace_runtime_control_states'), now).readAgent(ctx)
    expect(result).toMatchObject({ state: 'error', data: null })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('does not guess a label for an unrecognized stored mode', async () => {
    const result = await createMobileReadDeps(database({ workspace_runtime_control_states: [control({ actual_mode: 'MYSTERY' })] }), now).readAgent(ctx)
    expect(result).toMatchObject({ state: 'unknown', data: null })
  })
})
