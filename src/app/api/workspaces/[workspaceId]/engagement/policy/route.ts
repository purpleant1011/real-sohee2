export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { SupabaseEngagementRepository } from '@/features/engagement/repository'

const NO_STORE = { 'Cache-Control': 'no-store' }

const updatePolicySchema = z.object({
  channel: z.enum(['instagram', 'threads', 'all']),
  auto_reply_enabled: z.boolean().optional(),
  is_paused: z.boolean().optional(),
  allowed_classes: z
    .array(z.enum(['THANKS', 'GREETING', 'QUESTION', 'COMPLAINT', 'SENSITIVE', 'SPAM', 'NEEDS_HUMAN']))
    .optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  daily_cap: z.number().int().min(1).max(100).optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/).nullable().optional(),
  max_comment_age_days: z.number().int().min(1).max(30).optional(),
  autonomy_level: z.enum(['L1_MANUAL', 'L2_ASSISTED', 'L3_AUTONOMOUS']).optional(),
  default_tone: z.enum(['witty', 'polite', 'friendly']).optional(),
  auto_post_enabled: z.boolean().optional(),
  auto_post_frequency_per_week: z.number().int().min(1).max(7).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const url = new URL(request.url)
    const channel = url.searchParams.get('channel') as 'instagram' | 'threads' | null

    const repo = new SupabaseEngagementRepository(auth.admin)
    if (channel) {
      const policy = await repo.findPolicy(auth.workspaceId, channel)
      return NextResponse.json({ policy }, { status: 200, headers: NO_STORE })
    }

    const [instagramPolicy, threadsPolicy] = await Promise.all([
      repo.findPolicy(auth.workspaceId, 'instagram'),
      repo.findPolicy(auth.workspaceId, 'threads'),
    ])

    return NextResponse.json(
      { policies: { instagram: instagramPolicy, threads: threadsPolicy } },
      { status: 200, headers: NO_STORE }
    )
  } catch {
    return NextResponse.json(
      { error: '자동 답글 정책을 불러오지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const body = await request.json().catch(() => null)
    const parsed = updatePolicySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '올바른 정책 설정을 입력해 주세요.' },
        { status: 422, headers: NO_STORE }
      )
    }

    const repo = new SupabaseEngagementRepository(auth.admin)

    if (parsed.data.channel === 'all') {
      const [igPolicy, thPolicy] = await Promise.all([
        repo.upsertPolicy(auth.workspaceId, { ...parsed.data, channel: 'instagram' }),
        repo.upsertPolicy(auth.workspaceId, { ...parsed.data, channel: 'threads' }),
      ])

      await repo.recordAudit({
        workspace_id: auth.workspaceId,
        comment_id: null,
        channel: 'instagram',
        actor: auth.role === 'owner' ? 'owner' : 'manager',
        actor_user_id: auth.userId,
        action: 'policy_update',
        policy_snapshot: { instagram: igPolicy, threads: thPolicy },
        provider_reply_id: null,
        readback_verified: false,
        details: { changes: parsed.data },
      })

      return NextResponse.json({ ok: true, policy: igPolicy, policies: { instagram: igPolicy, threads: thPolicy } }, { status: 200, headers: NO_STORE })
    }

    const updated = await repo.upsertPolicy(auth.workspaceId, parsed.data as any)

    await repo.recordAudit({
      workspace_id: auth.workspaceId,
      comment_id: null,
      channel: parsed.data.channel,
      actor: auth.role === 'owner' ? 'owner' : 'manager',
      actor_user_id: auth.userId,
      action: 'policy_update',
      policy_snapshot: { ...updated },
      provider_reply_id: null,
      readback_verified: false,
      details: { changes: parsed.data },
    })

    return NextResponse.json({ ok: true, policy: updated }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '정책을 저장하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
