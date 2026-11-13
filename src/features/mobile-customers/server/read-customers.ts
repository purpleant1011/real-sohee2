import { z } from 'zod'
import type { DatasetMode } from '@/features/mobile-decision/contracts'
import type { MobileCustomerDto } from '../customer-model'
import type { CustomersViewSnapshot } from '../customers-view'
import type { CustomerSourceResult } from './customer-source'

export interface CustomerReadContext { workspaceId: string; userId: string }

/** 서버 원본 한 줄. 스키마를 통과하고 같은 가게인 것만 화면 DTO 가 된다. 연락처 값 필드는 존재하지 않는다. */
export const customerRowSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  displayName: z.string().min(1),
  segment: z.enum(['inquiring', 'upcoming', 'visited', 'revisit']),
  consent: z.object({
    status: z.enum(['granted', 'withdrawn', 'unknown']),
    checkedAt: z.string().datetime().nullable(),
    source: z.string().nullable(),
  }).strict(),
  verifiedContacts: z.array(z.enum(['phone', 'message'])),
  lastAction: z.object({ label: z.string(), at: z.string().datetime() }).strict().nullable(),
  sourceLabel: z.string().nullable(),
  customerUuid: z.string().nullable().optional(),
}).strict()

export interface CustomerReadDeps {
  now: () => string
  readCustomers: (ctx: CustomerReadContext) => Promise<CustomerSourceResult>
  /** 시연·테스트 구분 값. ACTUAL 이 아니면 통째로 거부한다. */
  datasetMode: DatasetMode
  staleAfterMinutes?: number
}

export type CustomerReadResult = { ok: boolean; snapshot: CustomersViewSnapshot; rejectedRows: number }

/** 조회 실패는 빈 목록이 아니라 error, 계약 위반·다른 가게 줄은 버리고 complete=false 로 알린다. */
export async function readMobileCustomers(ctx: CustomerReadContext, deps: CustomerReadDeps): Promise<CustomerReadResult> {
  const failed = (): CustomerReadResult => ({
    ok: false, rejectedRows: 0,
    snapshot: { loadState: 'error', customers: [], workspaceId: ctx.workspaceId, complete: false, checkedAt: null },
  })
  if (deps.datasetMode !== 'ACTUAL') return failed()
  let source: CustomerSourceResult
  try { source = await deps.readCustomers(ctx) } catch { return failed() }

  // 1) 계약 검증을 먼저 한다. 중복 제거를 먼저 하면 계약을 못 지킨 행이 '중복'으로 사라져
  //    rejectedRows 가 0 이 되고 complete=true 가 되는 과대 표시가 생긴다.
  const valid: Array<{ dto: MobileCustomerDto; customerKey: string | null; observedAtMs: number }> = []
  let rejected = 0
  for (const [index, raw] of source.rows.entries()) {
    const parsed = customerRowSchema.safeParse(raw)
    if (!parsed.success || parsed.data.workspaceId !== ctx.workspaceId) { rejected += 1; continue }
    const key = source.keys?.[index]
    valid.push({
      dto: parsed.data,
      customerKey: key?.customerKey ?? null,
      observedAtMs: key?.observedAtMs ?? 0,
    })
  }

  // 2) 검증을 통과한 행만 같은 사람끼리 합친다. customerKey 가 없는 행은 같은 사람인지
  //    알 수 없으므로 합치지 않는다. 자리는 처음 만난 순서를 지키고, 값은 최신 상담을 쓴다.
  const keptIndex = new Map<string, number>()
  const merged: typeof valid = []
  for (const entry of valid) {
    if (!entry.customerKey) { merged.push(entry); continue }
    const at = keptIndex.get(entry.customerKey)
    if (at === undefined) { keptIndex.set(entry.customerKey, merged.length); merged.push(entry); continue }
    if (entry.observedAtMs > merged[at]!.observedAtMs) merged[at] = entry
  }
  const customers = merged.map(entry => entry.dto)
  const observed = Date.parse(source.observedAt)
  const stale = Number.isNaN(observed) || Date.parse(deps.now()) - observed > (deps.staleAfterMinutes ?? 10) * 60_000
  return {
    ok: true, rejectedRows: rejected,
    snapshot: {
      loadState: stale ? 'stale' : 'ready',
      customers,
      workspaceId: ctx.workspaceId,
      complete: source.complete && rejected === 0,
      checkedAt: Number.isNaN(observed) ? null : source.observedAt,
    },
  }
}
