import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getMetaLiveAllowlistStatus } from '@/lib/safety/meta-live-allowlist'
import { getEngagementAllowlistStatus } from '@/features/engagement/engagement-allowlist'
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification'

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

const REQUIRED_SECRETS = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY',
  'META_OAUTH_STATE_ENCRYPTION_KEY',
  'CRON_SECRET',
] as const

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const meta_app_mode_live = process.env.META_APP_MODE === 'live'
  const meta_app_review_approved = process.env.META_APP_REVIEW_STATUS?.toUpperCase() === 'APPROVED'
  const meta_access_tier_advanced = process.env.META_ACCESS_TIER?.toLowerCase() === 'advanced'
  const vault_publish_enabled = process.env.VAULT_PUBLISH_ENABLED === '1'
  const engagement_cycle_enabled = process.env.ENGAGEMENT_CYCLE_ENABLED === '1'
  const engagement_send_enabled = process.env.ENGAGEMENT_SEND_ENABLED === '1'
  const engagement_dm_ingest_enabled = process.env.ENGAGEMENT_DM_INGEST_ENABLED === '1'
  const { live_allowlist_configured, live_allowlist_all, live_allowlist_count } =
    getMetaLiveAllowlistStatus()
  const {
    configured: engagement_allowlist_configured,
    all: engagement_allowlist_all,
    count: engagement_allowlist_count,
  } = getEngagementAllowlistStatus()

  const missing_secrets = REQUIRED_SECRETS.filter((secretName) => {
    if (secretName === 'META_APP_ID') {
      return !process.env.META_APP_ID && !process.env.INSTAGRAM_APP_ID
    }
    if (secretName === 'META_APP_SECRET') {
      return !process.env.META_APP_SECRET && !process.env.INSTAGRAM_APP_SECRET && !process.env.THREADS_APP_SECRET
    }
    return !process.env[secretName]
  })

  let connected_channels_count = 0
  let engagement_comment_ready_channels_count = 0
  let engagement_dm_ready_channels_count = 0
  try {
    const supabase = createAdminSupabaseClient()
    const { data: credentials } = await (supabase as any)
      .from('meta_channel_credentials')
      .select('provider, status, token_expires_at, granted_scopes')
      .in('provider', ['instagram', 'threads'])
      .in('status', ['active', 'connected'])

    if (Array.isArray(credentials)) {
      const now = Date.now()
      const dayFromNow = now + 24 * 60 * 60 * 1000

      connected_channels_count = credentials.filter((cred: any) => {
        if (!cred.token_expires_at) return false
        const expiresAt = Date.parse(cred.token_expires_at)
        if (!Number.isFinite(expiresAt) || expiresAt <= dayFromNow) return false

        const scopes = cred.granted_scopes ?? []
        if (cred.provider === 'instagram') {
          return (
            scopes.includes('instagram_business_basic') &&
            scopes.includes('instagram_business_content_publish')
          )
        }
        if (cred.provider === 'threads') {
          return (
            scopes.includes('threads_basic') &&
            scopes.includes('threads_content_publish')
          )
        }
        return false
      }).length

      for (const cred of credentials) {
        if (cred.provider !== 'instagram' && cred.provider !== 'threads') continue
        if (!cred.token_expires_at) continue
        const expiresAt = Date.parse(cred.token_expires_at)
        if (!Number.isFinite(expiresAt) || expiresAt <= dayFromNow) continue

        const scopes = normalizeChannelScopes(cred.provider, cred.granted_scopes ?? [])
        if (cred.provider === 'instagram') {
          if (scopes.includes('instagram_manage_comments')) engagement_comment_ready_channels_count += 1
          if (scopes.includes('instagram_manage_messages')) engagement_dm_ready_channels_count += 1
        } else if (scopes.includes('threads_manage_replies')) {
          engagement_comment_ready_channels_count += 1
        }
      }
    }
  } catch (err) {
    console.error('[meta-readiness] channel lookup error:', err)
  }

  return NextResponse.json(
    {
      meta_app_mode_live,
      meta_app_review_approved,
      meta_access_tier_advanced,
      vault_publish_enabled,
      engagement_cycle_enabled,
      engagement_send_enabled,
      engagement_dm_ingest_enabled,
      live_allowlist_configured,
      live_allowlist_all,
      live_allowlist_count,
      engagement_allowlist_configured,
      engagement_allowlist_all,
      engagement_allowlist_count,
      missing_secrets,
      connected_channels_count,
      engagement_comment_ready_channels_count,
      engagement_dm_ready_channels_count,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
