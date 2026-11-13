import 'server-only'

import { z } from 'zod'

/**
 * M22(ANI-1709) 가게 기억 승인·거절 쓰기 — 원자적 결정 RPC 배선.
 *
 * `decide_studio_proposal`(20261016090509)은 `for update` 행 잠금 + workspace 스코프로
 * 같은 제안에 대한 동시 결정을 한 트랜잭션 안에서 직렬화한다. 같은 결정 재시도는
 * `idempotent: true`, 반대 결정은 23505 로 돌아오므로 둘 다 "이미 처리됨"으로 구분한다.
 *
 * 존재 여부는 workspace 로만 좁혀 확인하고, 다른 가게의 제안·goal 제안은 모두 `not_found` 로
 * 통일해 존재 여부를 누출하지 않는다. 판정 불가는 통과가 아니라 `unavailable` 이다.
 *
 * 빈 값 가드의 근거(마이그레이션 정본 대조, 2026-10-25):
 *   - `sohee_studio_proposals.content` 는 `not null check (char_length(content) between 1 and 12000)` 이다.
 *     공백만 있는 값('   ')은 char_length 가 1 이상이라 **이 검사를 통과한다**.
 *   - 제안 생성 함수는 `left(v_item->>'content', 12000)` 으로 저장하고 trim·공백 검사를 하지 않는다.
 *   - `decide_studio_proposal` 은 confirm 에서 `v_effective_content := v_proposal.content` 를 그대로
 *     `knowledge_facts` 에 넣는다. `knowledge_facts.content` 도 같은 char_length 검사라 공백은 통과한다.
 *   → 즉 **RPC 는 공백 값 confirm 을 닫지 않는다.** 그래서 이 라우트가 RPC 앞에서 한 번 더 막는다.
 *
 * 출처는 서버가 보장하므로 여기서 정책을 새로 만들지 않는다:
 *   - `source_message_id` 는 `not null` + `messages` FK 이고, RPC 는 `knowledge_sources`('소희 스튜디오')와
 *     `knowledge_candidates(source_location = 'studio:proposal:<id>')` 를 항상 만들어 붙인다.
 *   - 따라서 화면 helper 의 `missing_source` 차단은 서버 원본 제안에는 도달할 수 있는 상태가 아니다.
 *   - `value_conflict`/재확인은 화면에서 사장님이 비교하는 단계이고 호출처 없이는 서버가 보장할 수 없으므로
 *     이 서버 경로로 수입하지 않는다.
 */

const uuid = z.string().uuid()

const proposalRowSchema = z.object({
  id: uuid,
  kind: z.enum(['fact', 'goal']),
  /** 승인 전에 값 자체를 확인하기 위해 함께 읽는다. 없으면 승인하지 않는다(fail-closed). */
  content: z.string().nullish(),
}).passthrough()

const decisionResultSchema = z.object({
  success: z.literal(true),
  id: uuid,
  status: z.enum(['confirmed', 'rejected']),
  confirmed_target_id: uuid.nullable(),
  kind: z.string().min(1),
  idempotent: z.boolean(),
}).passthrough()

export type MemoryDecision = 'confirm' | 'reject'

export type MemoryDecisionResult = Readonly<
  | {
    outcome: 'decided' | 'already_handled'
    proposalId: string
    status: 'confirmed' | 'rejected'
    factId: string | null
  }
  | { outcome: 'not_found'; proposalId: string }
  /** 확인할 내용이 비어 있어 승인을 만들지 않았다. 저장 실패(unavailable)와 구분한다. */
  | { outcome: 'invalid_proposal'; proposalId: string }
  | { outcome: 'unavailable'; proposalId: string }
>

export interface MemoryDecisionInput {
  workspaceId: string
  userId: string
  proposalId: string
  decision: MemoryDecision
  /** proposals 테이블은 service_role 전용이다. */
  admin: any
}

function outcomeFromRpcError(
  error: { message?: string; code?: string } | null,
  proposalId: string,
): MemoryDecisionResult {
  const message = (error?.message ?? '').toLowerCase()
  if (message.includes('proposal_not_found')) return { outcome: 'not_found', proposalId }
  // fact_not_found 도 P0002 이지만 그건 제안이 아니라 대체 대상 사실이 사라진 경우다.
  if (error?.code === 'P0002' && !message.includes('fact_not_found')) {
    return { outcome: 'not_found', proposalId }
  }
  if (message.includes('already confirmed')) {
    return { outcome: 'already_handled', proposalId, status: 'confirmed', factId: null }
  }
  if (message.includes('already rejected')) {
    return { outcome: 'already_handled', proposalId, status: 'rejected', factId: null }
  }
  return { outcome: 'unavailable', proposalId }
}

export async function decideMemoryProposal(input: MemoryDecisionInput): Promise<MemoryDecisionResult> {
  const { workspaceId, userId, proposalId, decision, admin } = input

  try {
    // 인증이 확정한 workspace 로만 좁힌다. 다른 가게의 제안 id 는 여기서 걸러진다.
    const lookup = await admin
      .from('sohee_studio_proposals')
      .select('id, kind, content')
      .eq('workspace_id', workspaceId)
      .eq('id', proposalId)
      .maybeSingle()

    if (lookup?.error) return { outcome: 'unavailable', proposalId }
    if (lookup?.data === null || lookup?.data === undefined) return { outcome: 'not_found', proposalId }

    const proposal = proposalRowSchema.safeParse(lookup.data)
    if (!proposal.success) return { outcome: 'unavailable', proposalId }
    // 목표(goal)는 기억이 아니다. 이 화면의 승인으로 확정하지 않는다.
    if (proposal.data.kind !== 'fact') return { outcome: 'not_found', proposalId }

    // 값이 비었거나 읽지 못한 제안을 승인하면 '확정 기억'이 빈 채로 만들어진다.
    // 화면 잠금에만 기대지 않고 서버에서 한 번 더 막는다. 거절은 값과 무관하므로 그대로 둔다.
    if (decision === 'confirm' && !(proposal.data.content ?? '').trim()) {
      return { outcome: 'invalid_proposal', proposalId }
    }

    const rpc = await admin.rpc('decide_studio_proposal', {
      p_workspace_id: workspaceId,
      p_proposal_id: proposalId,
      p_decision: decision,
      p_user_id: userId,
      p_revised_content: null,
    })
    if (rpc?.error) return outcomeFromRpcError(rpc.error, proposalId)

    const parsed = decisionResultSchema.safeParse(rpc?.data)
    if (!parsed.success) return { outcome: 'unavailable', proposalId }

    return {
      outcome: parsed.data.idempotent ? 'already_handled' : 'decided',
      proposalId,
      status: parsed.data.status,
      factId: parsed.data.confirmed_target_id ?? null,
    }
  } catch {
    return { outcome: 'unavailable', proposalId }
  }
}
