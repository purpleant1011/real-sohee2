import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createAdminUrlSourceCollectionGateway } from '@/features/knowledge/url-collection-service'
import { collectKnowledgeSource } from '@/features/knowledge/url-collection-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const dueSchema = z.array(z.object({
  workspace_id: z.string().uuid(),
  source_id: z.string().uuid(),
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

  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const listing = await admin.rpc('list_collectable_url_knowledge_sources', { p_limit: 10 })
  const due = dueSchema.safeParse(listing.data)
  if (listing.error || !due.success) return NextResponse.json({ error: 'listing_failed' }, { status: 503 })

  let complete = 0
  let partial = 0
  let blocked = 0
  let refreshRequired = 0
  const gateway = createAdminUrlSourceCollectionGateway()
  for (const item of due.data) {
    const result = await collectKnowledgeSource(
      { workspaceId: item.workspace_id, sourceId: item.source_id },
      gateway,
      {},
    )
    const state = result.data?.collectionState
    if (state === 'complete') complete += 1
    else if (state === 'partial') partial += 1
    else if (state === 'refresh_required') refreshRequired += 1
    else blocked += 1
  }
  return NextResponse.json({ claimed: due.data.length, complete, partial, blocked, refreshRequired })
}
