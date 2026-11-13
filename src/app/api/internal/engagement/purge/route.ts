import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

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

    let dmData: any = null
    let dmFailed = false
    try {
      const { data, error } = await admin.rpc('purge_expired_instagram_dm_data', {
        p_retention_days: 30,
      })
      if (error) {
        console.error('[engagement-purge] DM RPC returned error code:', error.code || 'UNKNOWN')
        dmFailed = true
      } else {
        dmData = data
      }
    } catch (err: any) {
      console.error('[engagement-purge] DM RPC invocation failed:', err?.name || 'Error')
      dmFailed = true
    }

    let commentsData: any = null
    let commentsFailed = false
    try {
      const { data, error } = await admin.rpc('purge_expired_social_comment_data', {
        p_retention_days: 30,
      })
      if (error) {
        console.error('[engagement-purge] Comments RPC returned error code:', error.code || 'UNKNOWN')
        commentsFailed = true
      } else {
        commentsData = data
      }
    } catch (err: any) {
      console.error('[engagement-purge] Comments RPC invocation failed:', err?.name || 'Error')
      commentsFailed = true
    }

    if (dmFailed || commentsFailed) {
      return NextResponse.json({ error: 'purge_unavailable' }, { status: 503 })
    }

    const dmResult = (typeof dmData === 'object' && dmData !== null ? dmData : {}) as {
      threads?: unknown
      messages?: unknown
      drafts?: unknown
      hasMore?: unknown
    }

    const commentsResult = (typeof commentsData === 'object' && commentsData !== null ? commentsData : {}) as {
      comments?: unknown
      drafts?: unknown
      hasMore?: unknown
    }

    return NextResponse.json({
      ok: true,
      threads: typeof dmResult.threads === 'number' ? dmResult.threads : 0,
      messages: typeof dmResult.messages === 'number' ? dmResult.messages : 0,
      drafts: typeof dmResult.drafts === 'number' ? dmResult.drafts : 0,
      hasMore: Boolean(dmResult.hasMore),
      comments: typeof commentsResult.comments === 'number' ? commentsResult.comments : 0,
      commentDrafts: typeof commentsResult.drafts === 'number' ? commentsResult.drafts : 0,
      commentsHasMore: Boolean(commentsResult.hasMore),
    })
  } catch (err: any) {
    console.error('[engagement-purge] Unhandled exception:', err?.name || 'Error')
    return NextResponse.json({ error: 'purge_unavailable' }, { status: 503 })
  }
}
