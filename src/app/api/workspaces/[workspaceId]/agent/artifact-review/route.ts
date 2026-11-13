import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { MissionPublishReviewError, MissionPublishReviewService } from '@/features/agent-activity/mission-publish-review'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const scopeShape = { missionId: z.string().uuid(), runId: z.string().uuid(), contentId: z.string().uuid(), versionId: z.string().uuid() }
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ISSUE_QUOTE'), ...scopeShape }).strict(),
  z.object({ action: z.literal('APPROVE_REVIEW'), ...scopeShape,
    quoteId: z.string().min(1).max(200), reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    rightsConfirmed: z.literal(true), disclosureConfirmed: z.literal(true),
  }).strict(),
])

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'reviewer' })
    if (isResponse(auth)) { auth.headers.set('Cache-Control', 'private, no-store'); return auth }
    const parsed = inputSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'INVALID_REVIEW_PARAMETERS' } }, { status: 400, headers })
    const input = parsed.data
    const scope = { workspaceId: auth.workspaceId, missionId: input.missionId, runId: input.runId, contentId: input.contentId, versionId: input.versionId }
    // Only this authenticated server command writes the mission metadata; no provider/dispatch is imported.
    const service = new MissionPublishReviewService(auth.admin, getApprovalPreview)
    if (input.action === 'ISSUE_QUOTE') {
      const quote = await service.issue(scope)
      const snapshot = await service.snapshot(scope, quote.quoteId)
      return NextResponse.json({ success: true, ...snapshot }, { headers })
    }
    const reviewApproval = await service.approve(scope, {
      quoteId: input.quoteId, reviewFingerprint: input.reviewFingerprint,
      rightsConfirmed: input.rightsConfirmed, disclosureConfirmed: input.disclosureConfirmed,
    }, auth.userId)
    return NextResponse.json({ success: true, reviewApproval }, { headers })
  } catch (error) {
    if (error instanceof MissionPublishReviewError) {
      return NextResponse.json({ success: false, error: { code: error.code } }, { status: 409, headers })
    }
    return NextResponse.json({ success: false, error: { code: 'MISSION_REVIEW_UNAVAILABLE' } }, { status: 503, headers })
  }
}
