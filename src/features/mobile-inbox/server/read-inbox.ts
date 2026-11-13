import { z } from 'zod'
import type { DatasetMode } from '@/features/mobile-decision/contracts'
import type { InboxThreadDto } from '../inbox-model'
import type { InboxViewSnapshot } from '../inbox-view'

export interface InboxReadContext { workspaceId: string; userId: string }

/** 서버 원본 한 줄. 스키마를 통과한 것만 화면 DTO 로 바뀐다. */
export const inboxRowSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  channel: z.enum(['instagram_dm', 'instagram_comment', 'kakao', 'naver_talktalk', 'instagram', 'threads', 'naver_blog', 'naver_place']),
  customerName: z.string().min(1),
  consent: z.enum(['granted', 'withdrawn', 'unknown']),
  status: z.enum(['needs_reply', 'draft_ready', 'waiting_customer', 'handled', 'unknown']),
  unread: z.boolean(),
  lastMessage: z.object({
    text: z.string(),
    receivedAt: z.string().datetime(),
    fromCustomer: z.boolean(),
  }).strict().nullable(),
  summary: z.string().nullable().optional(),
  lastActivityAt: z.string().datetime().nullable().optional(),
  draft: z.object({ text: z.string().min(1), sources: z.array(z.string()) }).strict().nullable(),
  sendBlockers: z.array(z.enum(['NO_SEND_SCOPE', 'PROVIDER_NOT_READY', 'CONSENT_MISSING', 'WINDOW_EXPIRED', 'KILL_SWITCH'])),
}).strict()

export interface InboxSourceResult {
  rows: unknown[]
  /** 서버가 목록 전체를 읽었는지(페이지 한도·부분 실패가 없었는지). */
  complete: boolean
  /** 원장에서 읽은 시각. */
  observedAt: string
  datasetMode: DatasetMode
}

export interface InboxReadDeps {
  now: () => string
  readThreads: (ctx: InboxReadContext) => Promise<InboxSourceResult>
  /** 이 시간(분)보다 오래된 읽기는 stale. 기본 10분. */
  staleAfterMinutes?: number
}

export type InboxReadResult =
  | { ok: true; snapshot: InboxViewSnapshot; datasetMode: DatasetMode; rejectedRows: number }
  | { ok: false; snapshot: InboxViewSnapshot; datasetMode: null; rejectedRows: 0 }

/**
 * 소통함 읽기 어댑터. 조회 실패는 빈 목록이 아니라 error 로, 읽은 시각이 오래되면 stale 로,
 * 스키마·가게가 맞지 않는 줄은 버리고 complete=false(partial)로 알린다. ACTUAL 이 아닌 데이터는 통째로 거부한다.
 */
export async function readMobileInbox(ctx: InboxReadContext, deps: InboxReadDeps): Promise<InboxReadResult> {
  const base = { workspaceId: ctx.workspaceId, threads: [] as InboxThreadDto[] }
  let source: InboxSourceResult
  try {
    source = await deps.readThreads(ctx)
  } catch {
    return { ok: false, datasetMode: null, rejectedRows: 0, snapshot: { ...base, loadState: 'error', complete: false, checkedAt: null } }
  }
  if (source.datasetMode !== 'ACTUAL') {
    // 실제 가게 화면에 시연·테스트 데이터가 섞이지 않게 fail-closed.
    return { ok: false, datasetMode: null, rejectedRows: 0, snapshot: { ...base, loadState: 'error', complete: false, checkedAt: null } }
  }

  const threads: InboxThreadDto[] = []
  let rejected = 0
  for (const raw of source.rows) {
    const parsed = inboxRowSchema.safeParse(raw)
    if (!parsed.success || parsed.data.workspaceId !== ctx.workspaceId) { rejected += 1; continue }
    threads.push(parsed.data)
  }

  const observed = Date.parse(source.observedAt)
  const current = Date.parse(deps.now())
  // 임계값이 숫자가 아니면 기본 10분으로 되돌린다. NaN 임계값은 모든 비교를 false 로 만들어
  // 오래된 읽기를 '최신'으로 통과시키므로 fail-closed 로 처리한다.
  const minutes = deps.staleAfterMinutes ?? 10
  const limit = (Number.isFinite(minutes) && minutes >= 0 ? minutes : 10) * 60_000
  // 서버 시계가 해석되지 않으면 신선도를 판정할 수 없다. 이때도 stale 로 남긴다(최신으로 단정하지 않는다).
  const stale = Number.isNaN(observed) || Number.isNaN(current) || current - observed > limit
  return {
    ok: true,
    datasetMode: source.datasetMode,
    rejectedRows: rejected,
    snapshot: {
      workspaceId: ctx.workspaceId,
      threads,
      loadState: stale ? 'stale' : 'ready',
      complete: source.complete && rejected === 0,
      checkedAt: Number.isNaN(observed) ? null : source.observedAt,
    },
  }
}
