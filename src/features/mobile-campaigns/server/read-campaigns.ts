import type { LoadState } from '@/features/mobile-decision/contracts'
import type { MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import type { CampaignCandidate, CampaignsViewSnapshot } from '../campaigns-view'

export interface CampaignReadContext { workspaceId: string; userId: string }

/** 서버가 읽은 제안 원본. 아직 저장소가 없으면 connected=false 로 알린다(빈 목록과 다르다). */
export interface CampaignSourceResult {
  connected: boolean
  candidates: readonly CampaignCandidate[]
  /** 대상 고객 판정 재료. 고객 화면(W10) 계약의 DTO 를 그대로 받는다. */
  customers: readonly MobileCustomerDto[]
  /** 서버가 목록 전체를 읽었는지. */
  complete: boolean
  observedAt: string
}

export interface CampaignReadDeps {
  now: () => string
  readSource: (ctx: CampaignReadContext) => Promise<CampaignSourceResult>
}

/** 화면 스냅샷 + 가게 식별. 클라이언트는 workspaceId 가 다르면 그리지 않는다. */
export interface MobileCampaignsPayload extends CampaignsViewSnapshot {
  workspaceId: string
  /** 제안 원본이 연결돼 있는지. false 면 '제안 없음'이 아니라 '확인 불가'다. */
  sourceConnected: boolean
}

export type CampaignReadResult = { ok: boolean; payload: MobileCampaignsPayload }

function empty(workspaceId: string, loadState: LoadState, sourceConnected: boolean, now: string | null): MobileCampaignsPayload {
  return { workspaceId, loadState, candidates: [], customers: [], now, checkedAt: null, sourceConnected }
}

/**
 * 캠페인 제안 읽기 어댑터(읽기 전용, 발송 없음). 조회 실패·미연결은 '제안 없음'으로 단정하지 않고,
 * 다른 가게 제안·고객은 버리며 그 사실을 complete 대신 stale 로 남긴다.
 */
export async function readMobileCampaigns(ctx: CampaignReadContext, deps: CampaignReadDeps): Promise<CampaignReadResult> {
  const now = deps.now()
  let source: CampaignSourceResult
  try {
    source = await deps.readSource(ctx)
  } catch {
    return { ok: false, payload: empty(ctx.workspaceId, 'error', false, now) }
  }
  if (!source.connected) return { ok: false, payload: empty(ctx.workspaceId, 'unknown', false, now) }

  const candidates = source.candidates.filter(c =>
    c.proposal.workspaceId === ctx.workspaceId
    && (c.slot === null || c.slot.workspaceId === ctx.workspaceId))
  const customers = source.customers.filter(c => c.workspaceId === ctx.workspaceId)
  const dropped = candidates.length !== source.candidates.length || customers.length !== source.customers.length
  const observed = Date.parse(source.observedAt)
  return {
    ok: true,
    payload: {
      workspaceId: ctx.workspaceId,
      loadState: dropped || !source.complete ? 'stale' : 'ready',
      candidates,
      customers,
      now,
      checkedAt: Number.isNaN(observed) ? null : source.observedAt,
      sourceConnected: true,
    },
  }
}
