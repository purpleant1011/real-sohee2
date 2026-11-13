import { describe, expect, it, vi } from 'vitest'
import { CHECK_TO_REASON_GROUP, REASON_GROUP_IDS, reasonGroupOf } from './reason-groups'
import { currentSessionHealth, resolveSessionHealth, SESSION_HEALTH_LABEL } from './session-health'
import { buildTrend, loadPreflightQueue, recordOperatorAction, type PreflightQueueGateway, type PreflightRunRow } from './service'
import { createPreflightQueueGateway } from './repository'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

const now = new Date('2026-10-07T12:00:00Z')
const ws = '15630000-0000-4000-8000-000000000001'
const fail = (code: string, message = `${code} 실패`) => ({ code, status: 'FAIL', message, action: '조치' })
const run = (n: number, items: unknown[], runAt = '2026-10-07T01:00:00Z', overall = 'FAIL'): PreflightRunRow => ({
  id: `15630000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, workspace_id: ws,
  vault_item_id: `15630000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`, run_at: runAt, overall, items,
})
const gateway = (rows: PreflightRunRow[], overrides: Partial<PreflightQueueGateway> = {}): PreflightQueueGateway & { appended: unknown[] } => {
  const appended: unknown[] = []
  return {
    appended,
    readRuns: async () => rows,
    readLatestRun: async (_w, id) => rows.filter(r => r.vault_item_id === id).sort((a, b) => Date.parse(b.run_at) - Date.parse(a.run_at))[0] ?? null,
    readOperatorEvents: async () => [],
    appendEvent: async e => { appended.push(e) },
    ...overrides,
  }
}

describe('ANI-1563 reason mapping', () => {
  const fixtures: [string, string][] = [
    ['FINGERPRINT', 'FINGERPRINT_MISMATCH'], ['CONTENT_EXPIRY', 'CONTENT_EXPIRED'], ['HOLD_AGE', 'HOLD_OVER_14D'],
    ['IMAGE_RIGHTS', 'RIGHTS_QC_EXPIRED'], ['CONNECTION', 'CONNECTION_LOST'], ['ACCOUNT', 'ACCOUNT_CHANGED'], ['POLICY', 'POLICY_CHANGED'],
  ]
  it.each(fixtures)('%s FAIL goes to %s', async (code, group) => {
    const result = await loadPreflightQueue(gateway([run(1, [fail(code)])]), { now })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') { expect(result.groups.map(g => g.group)).toEqual([group]); expect(result.total).toBe(1) }
  })
  it('maps every preflight code and keeps QC with rights; unknown ids are never dropped', async () => {
    expect(Object.keys(CHECK_TO_REASON_GROUP)).toHaveLength(8)
    expect(reasonGroupOf('IMAGE_QC')).toBe('RIGHTS_QC_EXPIRED')
    expect(new Set(Object.values(CHECK_TO_REASON_GROUP))).toEqual(new Set(REASON_GROUP_IDS))
    const result = await loadPreflightQueue(gateway([run(1, [fail('SOMETHING_NEW')])]), { now })
    expect(result.status === 'ok' && result.groups[0].group).toBe('UNCLASSIFIED')
  })
  it('ignores UNKNOWN/PASS checks and uses only the latest run per item', async () => {
    const rows = [
      run(1, [{ code: 'POLICY', status: 'UNKNOWN', message: 'x', action: null }], undefined, 'UNKNOWN'),
      run(2, [fail('HOLD_AGE')], '2026-10-06T00:00:00Z'),
      { ...run(2, [{ code: 'HOLD_AGE', status: 'PASS', message: 'ok', action: null }], '2026-10-07T02:00:00Z', 'PASS') },
    ]
    const result = await loadPreflightQueue(gateway(rows), { now })
    expect(result.status === 'ok' && result.total).toBe(0)
  })
})

describe('ANI-1563 ERROR is not EMPTY', () => {
  it('returns an error result when the read fails, and an ok empty result otherwise', async () => {
    const failing = await loadPreflightQueue(gateway([], { readRuns: async () => { throw new Error('db down') } }), { now })
    expect(failing.status).toBe('error')
    const empty = await loadPreflightQueue(gateway([]), { now })
    expect(empty).toMatchObject({ status: 'ok', total: 0, groups: [] })
  })
  it('treats a failed event read as an error, not an empty handling state', async () => {
    const result = await loadPreflightQueue(gateway([run(1, [fail('POLICY')])], { readOperatorEvents: async () => { throw new Error('x') } }), { now })
    expect(result.status).toBe('error')
  })
})

describe('ANI-1563 trend', () => {
  it('counts failures per day and group, zero-filled for the window', () => {
    const rows = [run(1, [fail('POLICY'), fail('IMAGE_RIGHTS'), fail('IMAGE_QC')]), run(2, [fail('POLICY')], '2026-10-05T10:00:00Z')]
    const trend = buildTrend(rows, now, 3)
    expect(trend.map(d => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(trend[2].counts).toMatchObject({ POLICY_CHANGED: 1, RIGHTS_QC_EXPIRED: 1, CONNECTION_LOST: 0 })
    expect(trend[0].counts.POLICY_CHANGED).toBe(1)
  })
})

describe('ANI-1563 operator actions are audit-only', () => {
  it('appends exactly one operator event with a memo and never exposes an item mutation path', async () => {
    const g = gateway([run(1, [fail('ACCOUNT')])])
    expect(Object.keys(g).sort()).toEqual(['appendEvent', 'appended', 'readLatestRun', 'readOperatorEvents', 'readRuns'])
    const r = await recordOperatorAction(g, 'actor-1', { kind: 'request_reconfirm', workspaceId: ws, vaultItemId: run(1, []).vault_item_id, note: ' 계정 확인 필요 ' })
    expect(r).toEqual({ ok: true })
    expect(g.appended).toHaveLength(1)
    expect(g.appended[0]).toMatchObject({ eventType: 'operator.reconfirm_requested', actorId: 'actor-1', payload: { note: '계정 확인 필요', reason_groups: ['ACCOUNT_CHANGED'] } })
  })
  it('requires a memo for reconfirm/memo, rejects items outside the queue, and reports write failure', async () => {
    const g = gateway([run(1, [fail('ACCOUNT')])])
    const id = run(1, []).vault_item_id
    expect(await recordOperatorAction(g, 'a', { kind: 'request_reconfirm', workspaceId: ws, vaultItemId: id, note: '  ' })).toMatchObject({ ok: false })
    expect(await recordOperatorAction(g, 'a', { kind: 'keep_hold', workspaceId: ws, vaultItemId: '15630000-0000-4000-8000-0000000009ff', note: '' })).toMatchObject({ ok: false })
    const broken = gateway([run(1, [fail('ACCOUNT')])], { appendEvent: async () => { throw new Error('x') } })
    expect(await recordOperatorAction(broken, 'a', { kind: 'keep_hold', workspaceId: ws, vaultItemId: id, note: '' })).toMatchObject({ ok: false })
    expect(g.appended).toHaveLength(0)
  })
  it('repository only touches preflight_runs/vault_events and inserts only into vault_events', async () => {
    const calls: string[] = []
    const chain = (table: string): any => {
      const c: any = {
        select: () => c, order: () => c, limit: () => c, eq: () => c, in: () => c,
        insert: () => { calls.push(`insert:${table}`); return Promise.resolve({ error: null }) },
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      }
      calls.push(`from:${table}`)
      return c
    }
    const repo = createPreflightQueueGateway({ from: chain })
    await repo.readRuns('2026-10-01T00:00:00Z'); await repo.readLatestRun(ws, 'x'); await repo.readOperatorEvents(['x'])
    await repo.appendEvent({ workspaceId: ws, vaultItemId: 'x', actorId: 'a', eventType: 'operator.hold_kept', payload: {} })
    expect(calls.filter(c => c.startsWith('from:')).every(c => ['from:preflight_runs', 'from:vault_events'].includes(c))).toBe(true)
    expect(calls.filter(c => c.startsWith('insert:'))).toEqual(['insert:vault_events'])
  })
})

describe('ANI-1563 browser session health placeholder', () => {
  it('shows only 연동 전 now, and unknown is never rendered as healthy', () => {
    expect(currentSessionHealth(now).map(s => s.label)).toEqual(['연동 전', '연동 전'])
    expect(resolveSessionHealth({ channel: 'naver_blog', linked: null }, now).state).toBe('UNKNOWN')
    expect(resolveSessionHealth({ channel: 'naver_blog', linked: true }, now).state).toBe('UNKNOWN')
    expect(resolveSessionHealth({ channel: 'daangn_business', linked: true, probe: { result: 'OK', checkedAt: '2026-09-01T00:00:00Z' } }, now).state).toBe('UNKNOWN')
    expect(resolveSessionHealth({ channel: 'daangn_business', linked: true, probe: { result: 'OK', checkedAt: 'garbage' } }, now).state).toBe('UNKNOWN')
    expect(SESSION_HEALTH_LABEL.UNKNOWN).not.toBe(SESSION_HEALTH_LABEL.HEALTHY)
    expect(resolveSessionHealth({ channel: 'naver_blog', linked: true, probe: { result: 'LOGIN_REQUIRED', checkedAt: '2026-10-07T11:00:00Z' } }, now).label).toBe('재로그인 필요')
  })
  it('exposes no cookie, token or session value', () => {
    const json = JSON.stringify(currentSessionHealth(now)).toLowerCase()
    for (const word of ['cookie', 'token', 'session', 'secret', 'password']) expect(json).not.toContain(word)
  })
})
