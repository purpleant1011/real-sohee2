import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadChannelCredential } from '@/features/channels/credential-repository'
import { executeSocialPerformanceCollection } from '@/features/reports/actions/collect-social-performance-core'
import { collectMetaPostInsights } from '@/features/reports/meta-insights-provider'
import { loadPublishedMetricContext, saveMetricCollection } from '@/features/reports/social-metric-repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const dueSchema = z.array(z.object({
  workspace_id: z.string().uuid(),
  publish_attempt_id: z.string().uuid(),
  published_at: z.string().datetime({ offset: true }),
}).strict()).max(10)

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const left = Buffer.from(supplied.slice(7))
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const now = new Date()
  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const listing = await admin.rpc('list_due_social_metric_contexts', {
    p_now: now.toISOString(), p_limit: 10,
  })
  const due = dueSchema.safeParse(listing.data)
  if (listing.error || !due.success) return NextResponse.json({ error: 'listing_failed' }, { status: 503 })

  let completed = 0
  let unavailable = 0
  let failed = 0
  for (const item of due.data) {
    const result = await executeSocialPerformanceCollection({
      workspaceId: item.workspace_id,
      publishAttemptId: item.publish_attempt_id,
      requestKey: randomUUID(),
      periodStart: item.published_at,
      periodEnd: now.toISOString(),
    }, {
      authorize: async (workspaceId) => ({ workspaceId, role: 'owner' }),
      loadContext: loadPublishedMetricContext,
      loadCredential: loadChannelCredential,
      collect: collectMetaPostInsights,
      save: saveMetricCollection,
      now: () => now,
    })
    if (result.data?.status === 'succeeded' || result.data?.status === 'no_data') completed += 1
    else if (result.data?.status === 'permission_denied') unavailable += 1
    else failed += 1
  }
  return NextResponse.json({ claimed: due.data.length, completed, unavailable, failed })
}
