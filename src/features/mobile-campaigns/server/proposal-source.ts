import type { DatasetMode } from '@/features/mobile-decision/contracts'
import type { InboxClient } from '@/features/mobile-inbox/server/inbox-source'
import { readCustomerSource } from '@/features/mobile-customers/server/customer-source'
import { campaignAudience, type MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import type { CreditLedger } from '@/features/mobile-settings/credit-model'
import type { CampaignCandidate } from '../campaigns-view'
import type { CampaignProposal, ChannelPublishState, EmptySlot } from '../campaign-model'
import type { CampaignSourceResult } from './read-campaigns'
import {
  MOBILE_CAMPAIGN_KIND,
  campaignFingerprint,
  campaignProposalId,
} from './proposal-identity'

/** 한 번에 읽는 빈 슬롯 상한. 넘으면 complete=false 로 내려 '전부 읽었다'고 단정하지 않는다. */
export const CAMPAIGN_SLOT_LIMIT = 50
/** 승인 여부를 확인할 제안 상한. 빈 슬롯 수와 같으므로 슬롯 상한을 넘지 않는다. */
const PROPOSAL_LOOKUP_LIMIT = CAMPAIGN_SLOT_LIMIT

interface SourceQueryResult {
  data: Array<Record<string, unknown>> | null
  error: { message: string } | null
}

/** 사용자 세션(RLS) 클라이언트의 필요한 부분만. 관리자 키 클라이언트를 넘기지 않는다. */
export interface CampaignSourceQuery {
  select(columns: string): CampaignSourceQuery
  eq(column: string, value: string): CampaignSourceQuery
  in(column: string, values: string[]): CampaignSourceQuery
  gt(column: string, value: string): CampaignSourceQuery
  order(column: string, opts: { ascending: boolean }): CampaignSourceQuery
  limit(n: number): PromiseLike<SourceQueryResult>
}

export interface CampaignSourceClient { from(table: string): CampaignSourceQuery }

export interface CampaignProposalReadOptions {
  now: () => string
  /** 운영 DB 의 실제 조회는 ACTUAL. 그 밖의 모드는 통째로 거부한다(fail-closed). */
  datasetMode?: DatasetMode
}

async function readRows(qb: CampaignSourceQuery, max: number): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await qb.limit(max)
  if (error || !data) throw new Error('campaign_source_read_failed')
  return data
}

/**
 * 채널 게시 가능성은 이 모듈이 아직 검증하지 못한다. 근거 없이 열지 않고, 사유만 남긴다.
 * 채널 검증(ANI-1776 계열)이 이 read model 에 연결되면 이 상수를 실제 판정으로 바꾼다.
 */
const CHANNEL_UNVERIFIED: ChannelPublishState = {
  channelLabel: '보낼 채널',
  publishable: false,
  reason: '보낼 채널을 아직 확인하지 못했어요',
  next: '채널 설정 확인',
}

/** 크레딧 잔액 소스도 이 read model 에 연결되지 않았다. 0 이 아니라 '미확인'으로 둔다. */
const LEDGER_UNVERIFIED: CreditLedger = {
  available: null,
  reserved: null,
  consumed: null,
  refunded: null,
  observedAt: null,
}

const SLOT_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 사용자 문구에는 슬롯 id·SHA 같은 내부 값을 넣지 않는다. 시간도 서울 기준으로 고정한다. */
export function slotMessage(startsAt: string): string {
  const parsed = Date.parse(startsAt)
  if (Number.isNaN(parsed)) return '예약이 비었어요. 다시 찾아오실 고객에게 알려드릴까요?'
  try {
    return `${SLOT_TIME_FORMAT.format(new Date(parsed))}에 빈자리가 생겼어요. 다시 찾아오실 고객에게 알려드릴까요?`
  } catch {
    return '예약이 비었어요. 다시 찾아오실 고객에게 알려드릴까요?'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function availabilityOf(status: unknown): EmptySlot['availability'] {
  if (status === 'AVAILABLE') return 'confirmed_open'
  if (status === 'BOOKED') return 'sold_out'
  return 'unknown'
}

/**
 * 빈 슬롯·수신 동의 고객·기존 승인 상태를 실제 테이블에서 읽어 화면 후보로 만든다.
 *
 * - 빈 슬롯은 `status='AVAILABLE'` + `valid_until > now` + `starts_at > now` 만 쓴다.
 * - 동의 고객은 고객 원본(W10)에서 `campaignAudience` 로만 고른다. 동의 철회 고객은 절대 넣지 않는다.
 * - 서비스 이름을 얻지 못한 슬롯은 지어내지 않고 후보에서 뺀다(complete=false).
 * - 하나라도 읽기에 실패하거나 고객 목록이 불완전하면 connected=false 로 닫는다(빈 목록과 구분).
 */
export async function readCampaignProposals(
  client: CampaignSourceClient,
  workspaceId: string,
  opts: CampaignProposalReadOptions,
): Promise<CampaignSourceResult> {
  const now = opts.now()
  const failed = (): CampaignSourceResult => ({
    connected: false,
    candidates: [],
    customers: [],
    complete: false,
    observedAt: now,
  })
  if (opts.datasetMode && opts.datasetMode !== 'ACTUAL') return failed()

  try {
    const slots = await readRows(
      client.from('booking_recovery_slots')
        .select('id, workspace_id, service_id, status, starts_at, ends_at, valid_until, confirmed_at')
        .eq('workspace_id', workspaceId)
        .eq('status', 'AVAILABLE')
        .gt('valid_until', now)
        .gt('starts_at', now)
        .order('starts_at', { ascending: true }),
      CAMPAIGN_SLOT_LIMIT,
    )

    // 고객 원본은 다른 모듈 소유다. 읽기 전용으로만 쓰고, 불완전하면 제안을 만들지 않는다.
    const customerSource = await readCustomerSource(
      client as unknown as InboxClient,
      workspaceId,
      { now: opts.now },
    )
    if (!customerSource.complete) return failed()
    const customers = customerSource.rows as MobileCustomerDto[]
    const audience = campaignAudience(customers, workspaceId)
    const audienceIds = audience.map(customer => customer.id)

    const serviceIds = [...new Set(slots.map(slot => String(slot.service_id ?? '')).filter(Boolean))]
    const services = serviceIds.length
      ? await readRows(
          client.from('workspace_products_services')
            .select('id, name')
            .eq('workspace_id', workspaceId)
            .in('id', serviceIds),
          serviceIds.length,
        )
      : []
    const serviceNameById = new Map(
      services.map(service => [String(service.id), typeof service.name === 'string' ? service.name.trim() : '']),
    )

    const proposalIds = slots.map(slot => campaignProposalId(workspaceId, String(slot.id)))
    const proposalRows = proposalIds.length
      ? await readRows(
          client.from('work_proposals')
            .select('proposal_id, status, proposed_envelope')
            .eq('workspace_id', workspaceId)
            .in('proposal_id', proposalIds),
          PROPOSAL_LOOKUP_LIMIT,
        )
      : []
    const proposalById = new Map(proposalRows.map(row => [String(row.proposal_id), row]))

    const candidates: CampaignCandidate[] = []
    let dropped = 0
    for (const slot of slots) {
      const slotId = String(slot.id)
      const startsAt = String(slot.starts_at ?? '')
      const endsAt = String(slot.ends_at ?? '')
      const serviceLabel = serviceNameById.get(String(slot.service_id ?? '')) ?? ''
      // 서비스 이름·시작 시각을 확인하지 못하면 후보를 만들지 않는다(지어내지 않음).
      if (!serviceLabel || Number.isNaN(Date.parse(startsAt))) { dropped += 1; continue }
      if (Number.isNaN(Date.parse(endsAt))) { dropped += 1; continue }
      if (availabilityOf(slot.status) !== 'confirmed_open') { dropped += 1; continue }

      const proposalId = campaignProposalId(workspaceId, slotId)
      const stored = proposalById.get(proposalId)
      const storedEnvelope = stored?.proposed_envelope
      const envelope = isRecord(storedEnvelope) ? storedEnvelope : null
      const approvedAt = stored?.status === 'APPROVED' && typeof envelope?.decidedAt === 'string'
        ? envelope.decidedAt
        : null
      const fingerprint = campaignFingerprint({
        workspaceId,
        slotId,
        startsAt,
        endsAt,
        kind: MOBILE_CAMPAIGN_KIND,
        consentedCustomerCount: audience.length,
      })

      const slotView: EmptySlot = {
        id: slotId,
        workspaceId,
        serviceLabel,
        startsAt,
        availability: 'confirmed_open',
        // openSlots() 는 관측 시각이 30분을 넘으면 빈자리로 인정하지 않는다.
        // 슬롯의 유효 시한을 관측 시각으로 삼아, 유효한 동안만 후보로 남긴다.
        observedAt: typeof slot.valid_until === 'string' ? slot.valid_until : now,
        sourceLabel: '사장님이 확인한 빈자리',
      }
      const proposal: CampaignProposal = {
        id: proposalId,
        workspaceId,
        kind: MOBILE_CAMPAIGN_KIND,
        slotId,
        message: slotMessage(startsAt),
        audienceIds: [...audienceIds],
        // 예측·실적을 지어내지 않는다.
        estimatedConversions: null,
        sentTo: [],
        approvedAt,
        // 발송 경로가 아직 연결되지 않았다. 승인과 발송은 별개이며 발송 직전에 다시 확인한다.
        dispatchIdempotencyKey: null,
      }
      candidates.push({
        proposal,
        slot: slotView,
        channel: { ...CHANNEL_UNVERIFIED },
        ledger: { ...LEDGER_UNVERIFIED },
        estimate: null,
        actualConversions: null,
        actualSource: null,
        // 화면이 승인 요청에 그대로 실어 보내는 지문. 승인 라우트가 같은 식으로 다시 계산한다.
        fingerprint,
      })
    }

    return {
      connected: true,
      candidates,
      customers,
      // 상한에 닿으면 더 있을 수 있으므로 '전부 읽었다'고 말하지 않는다.
      complete: dropped === 0 && slots.length < CAMPAIGN_SLOT_LIMIT,
      observedAt: now,
    }
  } catch {
    return failed()
  }
}
