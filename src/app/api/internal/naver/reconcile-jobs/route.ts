import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { reconcileNaverPostJobs } from '@/features/channel-studio/naver/reconcile-naver-post-jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const candidate = supplied.slice(7)
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminSupabaseClient()
    const summary = await reconcileNaverPostJobs({ admin })
    return NextResponse.json(summary)
  } catch (error) {
    console.error('[internal-naver-reconcile-jobs] execution error:', error)
    return NextResponse.json({ error: 'reconciliation_failed' }, { status: 500 })
  }
}
