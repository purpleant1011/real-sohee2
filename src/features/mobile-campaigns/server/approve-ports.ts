import type { InboxClient } from '@/features/mobile-inbox/server/inbox-source'
import { readCustomerSource } from '@/features/mobile-customers/server/customer-source'
import { campaignAudience, type MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import { MOBILE_CAMPAIGN_LANE } from './proposal-identity'
import type { ApproveCampaignPorts, ProposalRecord, SlotRecord } from './approve-campaign'

/**
 * 승인 코어에 실제 Supabase(사용자 세션, RLS) 포트를 꽂는 어댑터.
 * 관리자 키 클라이언트를 쓰지 않는다. provider/발송 모듈은 import 하지 않는다.
 */

interface DbResult {
  data: Array<Record<string, unknown>> | null
  error: { message: string; code?: string } | null
}
interface DbSingleResult {
  data: Record<string, unknown> | null
  error: { message: string; code?: string } | null
}
interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery
  eq(column: string, value: string): DbQuery
  limit(n: number): PromiseLike<DbResult>
  maybeSingle(): PromiseLike<DbSingleResult>
}
interface DbTable {
  select(columns: string): DbQuery
  insert(row: Record<string, unknown>): DbQuery
  update(patch: Record<string, unknown>): DbQuery
}
/** 사용자 세션 Supabase 클라이언트의 필요한 부분만. */
export interface ApproveDbClient { from(table: string): DbTable }

/** 같은 슬롯 승인 검사에서 훑는 최대 행 수. 넘으면 이번 승인은 닫지 않고 503으로 남긴다. */
const APPROVED_LOOKUP_LIMIT = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toProposalRecord(row: Record<string, unknown>): ProposalRecord {
  const envelope = isRecord(row.proposed_envelope) ? row.proposed_envelope : null
  return {
    proposalId: String(row.proposal_id),
    status: String(row.status ?? ''),
    envelope,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  }
}

function toSlotRecord(row: Record<string, unknown>): SlotRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    status: String(row.status ?? ''),
    startsAt: String(row.starts_at ?? ''),
    endsAt: String(row.ends_at ?? ''),
    validUntil: String(row.valid_until ?? ''),
    confirmedAt: typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
  }
}

export function createSupabaseApprovePorts(
  client: ApproveDbClient,
  now: () => string,
): ApproveCampaignPorts {
  return {
    now,

    async getSlot(workspaceId, slotId) {
      const { data, error } = await client.from('booking_recovery_slots')
        .select('id, workspace_id, status, starts_at, ends_at, valid_until, confirmed_at')
        .eq('workspace_id', workspaceId)
        .eq('id', slotId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? toSlotRecord(data) : null
    },

    async hasConfirmedReservation(workspaceId, slotId) {
      const { data, error } = await client.from('reservations')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('slot_id', slotId)
        .eq('status', 'CONFIRMED')
        .limit(1)
      if (error) throw new Error(error.message)
      if (!Array.isArray(data)) throw new Error('reservation_lookup_unobserved')
      return data.length > 0
    },

    async countConsentedCustomers(workspaceId) {
      const source = await readCustomerSource(
        client as unknown as InboxClient,
        workspaceId,
        { now },
      )
      // 일부만 읽은 목록으로 지문을 만들면 승인 판정이 흔들린다. 불완전하면 승인하지 않는다.
      if (!source.complete) throw new Error('customer_source_incomplete')
      return campaignAudience(source.rows as MobileCustomerDto[], workspaceId).length
    },

    async getProposal(workspaceId, proposalId) {
      const { data, error } = await client.from('work_proposals')
        .select('proposal_id, status, proposed_envelope, created_at')
        .eq('workspace_id', workspaceId)
        .eq('proposal_id', proposalId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? toProposalRecord(data) : null
    },

    async findApprovedProposalForSlot(workspaceId, slotId, excludeProposalId) {
      const { data, error } = await client.from('work_proposals')
        .select('proposal_id, status, proposed_envelope, created_at')
        .eq('workspace_id', workspaceId)
        .eq('status', 'APPROVED')
        .limit(APPROVED_LOOKUP_LIMIT)
      if (error) throw new Error(error.message)
      if (!Array.isArray(data)) throw new Error('approved_lookup_unobserved')
      const rows = data.map(toProposalRecord)
      // 상한에 닿았으면 '다른 승인 없음'을 단정할 수 없다. 500 이 아니라 503 으로 닫는다.
      if (rows.length >= APPROVED_LOOKUP_LIMIT) throw new Error('approved_lookup_truncated')
      // 다른 lane(자율 실행 제안)은 같은 슬롯 id 를 쓸 수 있으므로 lane·slotId 를 함께 본다.
      return rows.find(row => row.proposalId !== excludeProposalId
        && row.status === 'APPROVED'
        && row.envelope?.lane === MOBILE_CAMPAIGN_LANE
        && row.envelope?.slotId === slotId) ?? null
    },

    async insertApprovedProposal(row) {
      const { error } = await client.from('work_proposals').insert({
        proposal_id: row.proposalId,
        workspace_id: row.workspaceId,
        goal_id: null,
        title: row.title,
        rationale: row.rationale,
        evidence_context: row.evidenceContext,
        expected_outcome: {},
        execution_plan_summary: [],
        required_capabilities: [],
        estimated_agent_energy: 100,
        proposed_envelope: row.proposedEnvelope,
        status: 'APPROVED',
        expires_at: row.expiresAt,
      })
      if (!error) return 'inserted'
      // PK(proposal_id) 경쟁에서 진 경우. 500 으로 새지 않고 409 로 닫는다.
      if (error.code === '23505') return 'duplicate'
      throw new Error(error.message)
    },

    async transitionToApproved(workspaceId, proposalId, patch) {
      const { data, error } = await client.from('work_proposals')
        .update({
          status: 'APPROVED',
          proposed_envelope: patch.proposedEnvelope,
          evidence_context: patch.evidenceContext,
        })
        .eq('workspace_id', workspaceId)
        .eq('proposal_id', proposalId)
        .eq('status', 'PROPOSED')
        .select('proposal_id')
      if (error) throw new Error(error.message)
      if (!Array.isArray(data)) throw new Error('approval_transition_unobserved')
      return data.length > 0
    },
  }
}
