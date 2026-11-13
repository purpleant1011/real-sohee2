import { z } from 'zod'
import {
  MOBILE_CAMPAIGN_ENVELOPE_VERSION,
  MOBILE_CAMPAIGN_KIND,
  MOBILE_CAMPAIGN_LANE,
  campaignFingerprint,
} from './proposal-identity'

/**
 * M18 제안 승인(ANI-1697) — 포트 주입식 순수 코어.
 *
 * 이 파일은 DB·네트워크·provider 를 직접 부르지 않는다. 라우트가 실제 Supabase 포트를,
 * 단위 테스트가 메모리 포트를 넣는다. 외부 게시(발송)는 이 흐름에 없다.
 */

/** 승인 요청 본문. 모르는 키는 거부한다(스트릭트). */
export const approveRequestSchema = z.object({
  proposalId: z.string().min(1).max(300),
  slotId: z.string().min(1).max(200),
  expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

export type ApproveRequest = z.infer<typeof approveRequestSchema>

export interface SlotRecord {
  id: string
  workspaceId: string
  status: string
  startsAt: string
  endsAt: string
  validUntil: string
  confirmedAt: string | null
}

export interface ProposalRecord {
  proposalId: string
  status: string
  envelope: Record<string, unknown> | null
  createdAt: string | null
}

export interface ApprovedProposalRow {
  proposalId: string
  workspaceId: string
  title: string
  rationale: string
  evidenceContext: Record<string, unknown>
  proposedEnvelope: Record<string, unknown>
  expiresAt: string | null
}

export interface ProposalDecisionPatch {
  proposedEnvelope: Record<string, unknown>
  evidenceContext: Record<string, unknown>
}

export interface ApproveCampaignPorts {
  now: () => string
  /** 슬롯 1건. 조회 실패는 throw 로 알린다(빈 결과와 구분). */
  getSlot(workspaceId: string, slotId: string): Promise<SlotRecord | null>
  hasConfirmedReservation(workspaceId: string, slotId: string): Promise<boolean>
  /** 승인 직전에 동의 고객 수를 다시 센다. 실패는 throw. */
  countConsentedCustomers(workspaceId: string): Promise<number>
  getProposal(workspaceId: string, proposalId: string): Promise<ProposalRecord | null>
  /** 같은 슬롯에 이미 승인된 '다른' 제안. 실패는 throw. */
  findApprovedProposalForSlot(workspaceId: string, slotId: string, excludeProposalId: string): Promise<ProposalRecord | null>
  insertApprovedProposal(row: ApprovedProposalRow): Promise<'inserted' | 'duplicate'>
  /** status='PROPOSED' 조건부 갱신. 0행이면 false(경쟁에서 짐). */
  transitionToApproved(workspaceId: string, proposalId: string, patch: ProposalDecisionPatch): Promise<boolean>
}

export interface ApproveCampaignInput {
  workspaceId: string
  proposalId: string
  slotId: string
  expectedFingerprint: string
  idempotencyKey: string
}

export type ApproveCampaignErrorCode =
  | 'SLOT_ALREADY_RESERVED'
  | 'FINGERPRINT_MISMATCH'
  | 'ALREADY_RESOLVED'
  | 'SLOT_CHECK_UNAVAILABLE'
  | 'FINGERPRINT_CHECK_UNAVAILABLE'
  | 'PROPOSAL_CHECK_UNAVAILABLE'

export type ApproveCampaignOutcome =
  | { status: 200; body: { approved: true; decidedAt: string; externalPublishCount: 0; replayed?: true } }
  | { status: 409; body: { error: ApproveCampaignErrorCode; currentFingerprint?: string } }
  | { status: 503; body: { error: ApproveCampaignErrorCode } }

export const APPROVED_TITLE = '빈자리 구조대 제안'
export const APPROVED_RATIONALE = '빈자리가 생겨 다시 찾아올 고객에게 알려드리는 제안이에요.'
/** 사용자 화면에 그대로 내려가는 채널 상태 문구. 근거가 없으므로 닫아 둔다. */
export const CHANNEL_UNVERIFIED_REASON = '보낼 채널을 아직 확인하지 못했어요'

function envelopeString(envelope: Record<string, unknown> | null, key: string): string | null {
  const value = envelope?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isExpiredOrUnparseable(slot: SlotRecord, nowMs: number): boolean {
  const starts = Date.parse(slot.startsAt)
  const validUntil = Date.parse(slot.validUntil)
  if (Number.isNaN(starts) || Number.isNaN(validUntil) || Number.isNaN(nowMs)) return true
  return validUntil <= nowMs || starts <= nowMs
}

/**
 * 승인 순서: 슬롯 재조회 → 예약 충돌 재조회 → 지문 재계산 → 같은 슬롯 승인 검사
 * → 멱등 재전송 → CAS 저장. 모든 실패는 409(사용자가 풀 수 있음) 아니면 503(지금 확인 불가)로 닫는다.
 */
export async function approveCampaign(
  input: ApproveCampaignInput,
  ports: ApproveCampaignPorts,
): Promise<ApproveCampaignOutcome> {
  const { workspaceId, proposalId, slotId, expectedFingerprint, idempotencyKey } = input
  const decidedAt = ports.now()
  const nowMs = Date.parse(decidedAt)

  // 1. 슬롯을 지금 다시 읽는다. 실패를 '없음'으로 바꾸지 않는다.
  let slot: SlotRecord | null
  try {
    slot = await ports.getSlot(workspaceId, slotId)
  } catch {
    return { status: 503, body: { error: 'SLOT_CHECK_UNAVAILABLE' } }
  }
  if (!slot || slot.workspaceId !== workspaceId || slot.status !== 'AVAILABLE' || isExpiredOrUnparseable(slot, nowMs)) {
    return { status: 409, body: { error: 'SLOT_ALREADY_RESERVED' } }
  }

  // 2. 같은 슬롯에 확정 예약이 이미 있는지 본다(조회 실패는 503).
  let reserved: boolean
  try {
    reserved = await ports.hasConfirmedReservation(workspaceId, slotId)
  } catch {
    return { status: 503, body: { error: 'SLOT_CHECK_UNAVAILABLE' } }
  }
  if (reserved) return { status: 409, body: { error: 'SLOT_ALREADY_RESERVED' } }

  // 3. 지금 값으로 지문을 다시 계산한다. 화면이 본 대상과 달라졌으면 승인하지 않는다.
  let consentedCustomerCount: number
  try {
    consentedCustomerCount = await ports.countConsentedCustomers(workspaceId)
  } catch {
    return { status: 503, body: { error: 'FINGERPRINT_CHECK_UNAVAILABLE' } }
  }
  const fingerprint = campaignFingerprint({
    workspaceId,
    slotId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    kind: MOBILE_CAMPAIGN_KIND,
    consentedCustomerCount,
  })
  if (fingerprint !== expectedFingerprint) {
    return { status: 409, body: { error: 'FINGERPRINT_MISMATCH', currentFingerprint: fingerprint } }
  }

  let existing: ProposalRecord | null
  try {
    existing = await ports.getProposal(workspaceId, proposalId)
  } catch {
    return { status: 503, body: { error: 'PROPOSAL_CHECK_UNAVAILABLE' } }
  }

  // 4. 같은 슬롯에 이미 승인된 다른 제안이 있으면 새 승인을 열지 않는다.
  let otherApproved: ProposalRecord | null
  try {
    otherApproved = await ports.findApprovedProposalForSlot(workspaceId, slotId, proposalId)
  } catch {
    return { status: 503, body: { error: 'PROPOSAL_CHECK_UNAVAILABLE' } }
  }
  if (otherApproved && otherApproved.status === 'APPROVED') {
    return { status: 409, body: { error: 'SLOT_ALREADY_RESERVED' } }
  }

  // 5. 멱등 재전송: 같은 키면 새 쓰기 없이 원래 결과를 돌려준다.
  if (existing && existing.status === 'APPROVED') {
    const storedKey = envelopeString(existing.envelope, 'idempotencyKey')
    if (storedKey === idempotencyKey) {
      return {
        status: 200,
        body: {
          approved: true,
          replayed: true,
          decidedAt: envelopeString(existing.envelope, 'decidedAt') ?? existing.createdAt ?? decidedAt,
          externalPublishCount: 0,
        },
      }
    }
    return { status: 409, body: { error: 'ALREADY_RESOLVED' } }
  }

  const proposedEnvelope: Record<string, unknown> = {
    lane: MOBILE_CAMPAIGN_LANE,
    version: MOBILE_CAMPAIGN_ENVELOPE_VERSION,
    kind: MOBILE_CAMPAIGN_KIND,
    slotId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    fingerprint,
    idempotencyKey,
    decidedAt,
  }
  const evidenceContext: Record<string, unknown> = {
    lane: MOBILE_CAMPAIGN_LANE,
    slot: { slotId, startsAt: slot.startsAt, endsAt: slot.endsAt, validUntil: slot.validUntil },
    consentedCustomerCount,
    channel: { publishable: false, reason: CHANNEL_UNVERIFIED_REASON },
    observedAt: decidedAt,
  }

  // 6. 저장. 행이 없으면 INSERT(PK 중복은 409), 있으면 status='PROPOSED' 조건부 UPDATE.
  if (existing) {
    let won: boolean
    try {
      won = await ports.transitionToApproved(workspaceId, proposalId, { proposedEnvelope, evidenceContext })
    } catch {
      return { status: 503, body: { error: 'PROPOSAL_CHECK_UNAVAILABLE' } }
    }
    if (!won) return { status: 409, body: { error: 'ALREADY_RESOLVED' } }
  } else {
    let inserted: 'inserted' | 'duplicate'
    try {
      inserted = await ports.insertApprovedProposal({
        proposalId,
        workspaceId,
        title: APPROVED_TITLE,
        rationale: APPROVED_RATIONALE,
        evidenceContext,
        proposedEnvelope,
        expiresAt: slot.validUntil,
      })
    } catch {
      return { status: 503, body: { error: 'PROPOSAL_CHECK_UNAVAILABLE' } }
    }
    if (inserted === 'duplicate') return { status: 409, body: { error: 'ALREADY_RESOLVED' } }
  }

  // 7. 이 흐름은 외부 provider 를 부르지 않는다. externalPublishCount 는 실제 집계값(항상 0)이지
  //    하드코딩된 성과 지표가 아니다 — 발송 경로가 연결되면 이 값은 발송 로그에서 센다.
  return {
    status: 200,
    body: { approved: true, decidedAt, externalPublishCount: 0 },
  }
}
