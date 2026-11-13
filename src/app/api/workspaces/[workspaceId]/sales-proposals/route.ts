import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { evaluateSlotOpportunity } from '@/features/opportunity/slot-opportunity'
import { prepareRevisitCandidates } from '@/features/crm/revisit-preparation'
import { buildSalesActionProposals } from '@/features/sales-actions/action-proposals'
import { eligibleRevisitRecipients } from '@/features/sales-actions/revisit-bridge'
import { ctaPreflight } from '@/features/sales-actions/cta-preflight'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
const timestamp = z.string().datetime({ offset: true })
const range = z.object({ startsAt: timestamp, endsAt: timestamp }).strict()
const bodySchema = z.object({
  now: timestamp,
  slotRequest: z.object({ queryRange: range, timezone: z.string().min(1).max(64) }).strict(),
  slotSnapshot: z.unknown(),
  evidence: z.object({
    workPhotos: z.object({ count: z.number().int().min(0), rightsCleared: z.boolean(), evidenceRef: z.string().min(1) }).strict().nullable(),
    serviceFact: z.object({ serviceId: z.string().min(1), catalogVersion: z.string().min(1), name: z.string().min(1), priceKrw: z.number().int().min(0), evidenceRef: z.string().min(1), validUntil: timestamp }).strict().nullable(),
    existingPost: z.object({ postRef: z.string().min(1), evidenceRef: z.string().min(1) }).strict().nullable(),
    recentKinds: z.array(z.enum(['WORK_PHOTO_SHOWCASE', 'SERVICE_INTRO', 'OWNER_REVIEWED_FOLLOWUP', 'BOUNDED_OFFER', 'CTA_OR_POST_IMPROVEMENT'])).max(5),
    discountGateInput: z.unknown().nullable(),
    cta: z.object({ destination: z.unknown().nullable(), presence: z.unknown().nullable() }).strict().nullable(),
    revisit: z.object({
      channel: z.enum(['KAKAO', 'SMS', 'EMAIL']),
      policy: z.object({ version: z.string().min(1), dueAfterDays: z.number().int().min(1).max(3650), confirmedBy: z.string().min(1), evidenceRef: z.string().min(1) }).strict(),
      customers: z.unknown(), visits: z.unknown(), consents: z.unknown(),
    }).strict().nullable(),
  }).strict(),
}).strict()

/** Owner screen data source. Read-only: prepares proposals and an audience, never sends or publishes. */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'reviewer' })
  if (isResponse(auth)) { auth.headers.set('Cache-Control', 'no-store'); return auth }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '제안을 확인할 자료가 부족해요.', code: 'INVALID_INPUT' }, { status: 422, headers })
  const { now, slotRequest, slotSnapshot, evidence } = parsed.data
  const slot = evaluateSlotOpportunity({ request: { workspaceId, ...slotRequest }, snapshot: slotSnapshot as never, now })
  const revisit = evidence.revisit
    ? prepareRevisitCandidates({
        workspaceId, channel: evidence.revisit.channel, now,
        policy: { ...evidence.revisit.policy, workspaceId },
        customers: evidence.revisit.customers, visits: evidence.revisit.visits, consents: evidence.revisit.consents,
      })
    : null
  const cta = evidence.cta ? ctaPreflight({ workspaceId, destination: evidence.cta.destination as never, presence: evidence.cta.presence as never, now }) : null
  const result = await buildSalesActionProposals({
    workspaceId, now, slot,
    evidence: { workPhotos: evidence.workPhotos, serviceFact: evidence.serviceFact, revisit, discountGateInput: evidence.discountGateInput, cta, existingPost: evidence.existingPost, recentKinds: evidence.recentKinds },
  })
  const audience = revisit ? eligibleRevisitRecipients(revisit) : { recipientRefs: [], consentReviewCount: 0 }
  return NextResponse.json({ ...result, revisitAudience: audience, executionAllowed: false }, { headers })
}
