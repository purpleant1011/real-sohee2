import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { decideKnowledgeProposal } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError, studioFailure } from '../../../route-utils'

export const dynamic = 'force-dynamic'

const decisionRequest = z.object({
  decision: z.enum(['confirm', 'reject']),
  idempotencyKey: z.string().uuid().optional(),
  revisedContent: z.string().trim().min(1).max(12000).optional(),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine(input => {
  if (input.validFrom === undefined && input.validUntil === undefined) return true
  return input.decision === 'confirm' && input.validFrom !== undefined &&
    (input.validUntil == null || Date.parse(input.validUntil) > Date.parse(input.validFrom))
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const { workspaceId, id } = await params
  const auth = await authorizeStudio(workspaceId, true)
  if (auth instanceof NextResponse) return auth
  if (!z.string().uuid().safeParse(id).success) return studioError('INVALID_PROPOSAL_ID', '유효하지 않은 변경안입니다.', 400)
  const input = decisionRequest.safeParse(await req.json().catch(() => null))
  if (!input.success) return studioError('INVALID_DECISION', '결정 내용을 확인해 주세요.', 400)
  try {
    const validity = input.data.validFrom === undefined ? undefined : { validFrom: input.data.validFrom, validUntil: input.data.validUntil }
    const result = await decideKnowledgeProposal(auth.workspaceId, auth.userId, id, input.data.decision, input.data.revisedContent, input.data.idempotencyKey, validity)
    return NextResponse.json({ success: true, data: result }, { headers: NO_STORE })
  } catch (error) {
    return studioFailure(error, 'STUDIO_PROPOSAL_FAILED', '지식 변경을 저장하지 못했어요.')
  }
}
