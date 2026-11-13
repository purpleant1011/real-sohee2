import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readInboxSource, type InboxClient, type QueryBuilder } from '../../src/features/mobile-inbox/server/inbox-source'
import { readMobileInbox } from '../../src/features/mobile-inbox/server/read-inbox'
import { buildDepositsSnapshot } from '../../src/features/mobile-deposits/server/deposits-snapshot'
import { toResultsSnapshot } from '../../src/features/mobile-results/server/results-snapshot'
import type { WeeklyCeoReportData } from '../../src/features/reporting/weekly-ceo-report-service'

// ANI-1744 gate: 모바일 R2 read-model 은 다른 가게(workspace) 행을 화면에 내보내지 않는다(RLS 가 뚫려도 2차 방어).
//
// 이 동적 격리 테스트는 원래 존재하지 않던 `conversation-source` 모듈을 import 해 typecheck 를 깨뜨렸다.
// 삭제 대신 실제 구현(`inbox-source.ts` → `read-inbox.ts`) 기준으로 다시 작성했다.
const NOW = () => '2026-10-23T09:00:00.000Z'
const row = (id: string, ws: string) => ({
  id, workspace_id: ws, customer_handle: `customer-${id}`, customer_name: `고객-${id}`,
  status: 'NEEDS_REPLY', last_message_text: 's', last_message_at: '2026-10-23T08:50:00.000Z', expires_at: null,
})
/** 실제 수집 테이블 이름별 응답을 돌려주는 사용자 RLS 클라이언트 스텁(관리자 키 없음). */
function fakeClient(
  tables: Record<string, unknown[]>,
  opts: { fail?: boolean; eqSeen?: string[][] } = {},
): InboxClient {
  const seen = opts.eqSeen ?? []
  const builder = (table: string): QueryBuilder => {
    const qb: QueryBuilder = {
      select: () => qb,
      eq: (column, value) => { seen.push([`${table}.${column}`, value]); return qb },
      in: () => qb,
      order: () => qb,
      limit: async () => (opts.fail
        ? { data: null, error: { message: 'x' } }
        : { data: (tables[table] ?? []) as Record<string, unknown>[], error: null }),
    }
    return qb
  }
  return { from: builder }
}

describe('mobile inbox read-model tenant isolation', () => {
  it('RLS 누수 가정: 타 가게 행이 섞여 와도 스냅샷에 노출되지 않고 partial(complete=false)로 표시', async () => {
    const ctx = { workspaceId: 'ws-A', userId: 'u' }
    const result = await readMobileInbox(ctx, {
      now: NOW,
      readThreads: c => readInboxSource(fakeClient({ instagram_dm_threads: [row('a1', 'ws-A'), row('b1', 'ws-B')] }), c, { now: NOW, datasetMode: 'ACTUAL' }),
    })
    expect(result.ok).toBe(true)
    expect(result.snapshot.threads.map(t => t.id)).toEqual(['dm:a1'])
    expect(result.snapshot.threads.every(t => t.workspaceId === 'ws-A')).toBe(true)
    expect(result.snapshot.complete).toBe(false)
    expect(result.rejectedRows).toBe(1)
  })

  it('ACTUAL 이 아닌 데이터셋은 통째로 거부(타 가게/시연 혼입 fail-closed)', async () => {
    for (const mode of ['DEMO', 'TEST'] as const) {
      const r = await readMobileInbox({ workspaceId: 'ws-A', userId: 'u' }, {
        now: NOW,
        readThreads: c => readInboxSource(fakeClient({ instagram_dm_threads: [row('a1', 'ws-A')] }), c, { now: NOW, datasetMode: mode }),
      })
      expect(r.ok).toBe(false)
      expect(r.snapshot.threads).toEqual([])
    }
  })

  it('조회는 요청 가게 id 로만 걸고, 오류는 빈 목록이 아니라 error', async () => {
    const seen: string[][] = []
    const client = fakeClient({}, { fail: true, eqSeen: seen })
    const r = await readMobileInbox({ workspaceId: 'ws-A', userId: 'u' }, {
      now: NOW, readThreads: c => readInboxSource(client, c, { now: NOW, datasetMode: 'ACTUAL' }),
    })
    // 어떤 테이블을 읽든 요청 가게 id 로만 건다.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(([column, value]) => column.endsWith('.workspace_id') && value === 'ws-A')).toBe(true)
    expect(r.snapshot.loadState).toBe('error')
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

const PERIOD = { start: '2026-10-23T00:00:00.000Z', end: '2026-10-24T00:00:00.000Z' }

/** 다른 가게(ws-B) 리포트. 값은 정상 모양이지만 이 가게로는 그릴 수 없다. */
const foreignReport = {
  workspaceId: 'ws-B',
  datasetMode: 'ACTUAL',
  generatedAt: NOW(),
  period: PERIOD,
  metrics: {
    verifiedPublishedPosts: { value: 5, state: 'OBSERVED', source: 'meta_graph', period: PERIOD, observedAt: NOW(), evidenceIds: ['receipt-b1'] },
    revenue: { value: 120000, state: 'OBSERVED', source: 'payment_ledger', period: PERIOD, observedAt: NOW(), evidenceIds: ['pay-b1'] },
  },
} as unknown as WeeklyCeoReportData

describe('mobile results/deposits read-model tenant isolation', () => {
  it('성과: 다른 가게 리포트는 값·근거·출처를 하나도 내보내지 않고 error 로 닫는다', () => {
    const snapshot = toResultsSnapshot(foreignReport, 'ws-A')
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.kpis).toEqual([])
    expect(snapshot.confirmedPaidKrw).toBeNull()
    expect(snapshot.datasetMode).toBe('UNKNOWN')
  })

  it('예약금: 다른 가게 행이 섞이면 부분 목록이 아니라 error 로 닫는다', () => {
    const snapshot = buildDepositsSnapshot({
      workspaceId: 'ws-A',
      rows: [
        { id: 'res-a1', workspace_id: 'ws-A', deposit_krw: 30000, status: 'CONFIRMED' },
        { id: 'res-b1', workspace_id: 'ws-B', deposit_krw: 50000, status: 'CONFIRMED' },
      ],
      error: null,
      checkedAt: NOW(),
    })
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.deposits).toEqual([])
    expect(snapshot.checkedAt).toBeNull()
  })
})

describe('mobile read-model 정적 게이트', () => {
  it('mobile-inbox 서버 코드와 route 는 service-role(admin) 클라이언트를 쓰지 않는다(사용자 RLS 세션만)', () => {
    const files = [
      ...walk('src/features/mobile-inbox/server'),
      'src/app/api/workspaces/[workspaceId]/mobile-inbox/route.ts',
    ]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/createAdminSupabaseClient|supabase\/admin|SERVICE_ROLE/)
    }
  })

  it('mobile-results / mobile-deposits 서버 read-model 은 service-role(admin) 클라이언트를 쓰지 않는다', () => {
    const files = [...walk('src/features/mobile-results/server'), ...walk('src/features/mobile-deposits/server')]
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/createAdminSupabaseClient|supabase\/admin|SERVICE_ROLE/)
    }
  })

  it('mobile-inbox route 는 인증(manager) 후에만 조회하고 no-store 로 응답한다', () => {
    const src = readFileSync('src/app/api/workspaces/[workspaceId]/mobile-inbox/route.ts', 'utf8')
    expect(src).toMatch(/authorizeQuickRequest\(workspaceId, \{ requireRole: 'manager' \}\)/)
    expect(src).toContain('no-store')
  })
})

describe('first-post draft read/write 정적 게이트', () => {
  it('quick-post-service 의 모든 marketing_missions 접근은 workspace_id 로 범위가 한정된다', () => {
    const lines = readFileSync('src/features/quick-start/quick-post-service.ts', 'utf8').split('\n')
    const unscoped = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes("from('marketing_missions')"))
      .filter(({ i }) => !/workspace_id|workspaceId/.test(lines.slice(i, i + 40).join('\n')))
    expect(unscoped.map(u => u.i + 1)).toEqual([])
  })
})
