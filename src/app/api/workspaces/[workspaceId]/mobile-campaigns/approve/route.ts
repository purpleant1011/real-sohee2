export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { approveCampaign, approveRequestSchema } from '@/features/mobile-campaigns/server/approve-campaign'
import { createSupabaseApprovePorts, type ApproveDbClient } from '@/features/mobile-campaigns/server/approve-ports'
import { campaignProposalId } from '@/features/mobile-campaigns/server/proposal-identity'

const NO_STORE = { 'Cache-Control': 'no-store' }
const IDEMPOTENCY_KEY_MAX = 200

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * M18 제안 승인(ANI-1697). 승인은 '발송'이 아니다 — 외부 provider 를 부르지 않고, 제안 상태만 닫는다.
 * workspaceId 는 경로가 아니라 인증이 확정한 값을 쓴다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  // 재전송 잠금 키. 없으면 승인하지 않는다.
  const idempotencyKey = request.headers.get('Idempotency-Key')
  if (idempotencyKey === null || idempotencyKey.trim().length === 0 || idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
    return reply({ error: 'MISSING_IDEMPOTENCY_KEY' }, 422)
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = approveRequestSchema.safeParse(body)
  if (!parsed.success) return reply({ error: 'INVALID_REQUEST' }, 422)

  // 제안 id 는 인증된 매장과 본문 슬롯으로 결정된다. 다른 매장 id 를 섞어 보내면 PK 를 오염시킬 수 있어 거부한다.
  // (proposalId 를 파싱해 슬롯을 신뢰하지 않는다 — 슬롯은 승인 코어가 DB 에서 다시 조회한다.)
  if (parsed.data.proposalId !== campaignProposalId(auth.workspaceId, parsed.data.slotId)) {
    return reply({ error: 'INVALID_REQUEST' }, 422)
  }

  const outcome = await approveCampaign(
    {
      workspaceId: auth.workspaceId,
      proposalId: parsed.data.proposalId,
      slotId: parsed.data.slotId,
      expectedFingerprint: parsed.data.expectedFingerprint,
      idempotencyKey,
    },
    createSupabaseApprovePorts(
      auth.supabase as unknown as ApproveDbClient,
      () => new Date().toISOString(),
    ),
  )

  return reply(outcome.body, outcome.status)
}
