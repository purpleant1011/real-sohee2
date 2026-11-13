import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AutonomousPlannerService } from '@/features/autonomous-planner/planner-service'
import { loadGroundedBusinessContext } from '@/features/channel-studio/knowledge-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const left = Buffer.from(supplied.slice(7))
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    const admin = createAdminSupabaseClient() as any
    const service = new AutonomousPlannerService(admin)

    // Find workspaces with L3 autonomy or auto post enabled
    const { data: policies, error: polErr } = await admin
      .from('engagement_policies')
      .select('workspace_id, autonomy_level, auto_post_enabled, default_tone')
      .or('autonomy_level.eq.L3_FULL,auto_post_enabled.eq.true')

    if (polErr || !Array.isArray(policies) || policies.length === 0) {
      return NextResponse.json({
        workspacesProcessed: 0,
        planned: 0,
        skipped: true,
      })
    }

    const uniqueWorkspaces = Array.from(new Set(policies.map((p: any) => p.workspace_id)))
    let totalPlanned = 0

    for (const wsId of uniqueWorkspaces) {
      try {
        const policy = policies.find((p: any) => p.workspace_id === wsId)
        const context = await loadGroundedBusinessContext(wsId, admin)
        const items = await service.planUpcomingPosts({
          workspaceId: wsId,
          context,
          count: 1, // Plan next upcoming slot
          tone: policy?.default_tone || 'friendly',
        })

        // Find active workspace owner or operator actor for system provenance
        const { data: member } = await admin
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', wsId)
          .eq('status', 'active')
          .in('role', ['owner', 'manager'])
          .limit(1)
          .maybeSingle()

        const actorUserId = member?.user_id

        for (const item of items) {
          const res = await service.persistPlannedItem({
            workspaceId: wsId,
            item,
            actorUserId,
            approved: false, // Unapproved autonomous plan is saved safely as draft
          })
          if (res.success && !res.isDuplicate) {
            totalPlanned++
          }
        }
      } catch (wsErr) {
        console.warn(`[autonomous-planner] Error planning for workspace ${wsId}:`, wsErr)
      }
    }

    return NextResponse.json({
      success: true,
      workspacesProcessed: uniqueWorkspaces.length,
      totalPlanned,
    })
  } catch (err: any) {
    console.error('[autonomous-planner] Run error:', err)
    return NextResponse.json({ error: err.message || 'internal error' }, { status: 500 })
  }
}
