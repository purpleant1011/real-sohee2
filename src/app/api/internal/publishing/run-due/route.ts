import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { executeLivePublishSchedule } from '@/features/publishing/actions/live-publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const dueSchema = z.array(z.object({
  workspace_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
}).strict()).max(10)

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const candidate = supplied.slice(7)
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const client = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const now = new Date().toISOString()
  const recovery = await client.rpc('recover_expired_publish_leases', { p_now: now })
  if (recovery.error) return NextResponse.json({ error: 'recovery_failed' }, { status: 503 })
  const recovered = z.number().int().nonnegative().safeParse(recovery.data)
  if (!recovered.success) return NextResponse.json({ error: 'recovery_invalid' }, { status: 503 })

  const listing = await client.rpc('list_due_publish_schedules', { p_now: now, p_limit: 5 })
  const due = dueSchema.safeParse(listing.data)
  if (listing.error || !due.success) return NextResponse.json({ error: 'listing_failed' }, { status: 503 })

  let completed = 0
  let needsReview = 0
  for (const item of due.data) {
    const result = await executeLivePublishSchedule({
      workspaceId: item.workspace_id,
      scheduleId: item.schedule_id,
      actorUserId: item.actor_user_id,
    })
    if (result.data?.status === 'published') completed += 1
    else if (result.data?.status === 'unknown') needsReview += 1
  }
  return NextResponse.json({ recovered: recovered.data, claimed: due.data.length, completed, needsReview })
}
