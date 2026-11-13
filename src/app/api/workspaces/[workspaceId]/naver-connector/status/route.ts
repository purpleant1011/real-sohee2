import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

// 2 minutes heartbeat threshold
const ONLINE_THRESHOLD_MS = 120_000

export async function GET(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) {
      return auth
    }

    const admin = auth.admin

    // 1. Read the saved naver_blog channel connection
    const { data: conn, error: connectionError } = await admin
      .from('browser_channel_connections')
      .select('id, device_id, channel, external_account_label, status, last_seen_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'naver_blog')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (connectionError) throw new Error('connection query failed')

    if (!conn) {
      return NextResponse.json({
        hasConnection: false,
        isOnline: false,
        accountLabel: null,
        lastSeenAt: null,
        canAutoPublish: false,
        readiness: 'unknown',
        connectionStatus: null,
      }, { headers: noStore })
    }

    // 2. Check device liveness from connector_devices
    let lastSeenAt: string | null = conn.last_seen_at ?? null

    let deviceActive = false
    if (conn.device_id) {
      const { data: device, error: deviceError } = await admin
        .from('connector_devices')
        .select('id, last_seen_at, status')
        .eq('id', conn.device_id)
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      if (deviceError) throw new Error('device query failed')
      deviceActive = device?.status === 'active'
      lastSeenAt = device?.last_seen_at ?? null
    }

    const now = Date.now()
    const lastSeenTime = lastSeenAt ? new Date(lastSeenAt).getTime() : 0
    const diffMs = now - lastSeenTime
    const isOnline = deviceActive && lastSeenTime > 0 && diffMs >= 0 && diffMs <= ONLINE_THRESHOLD_MS

    return NextResponse.json({
      hasConnection: true,
      isOnline,
      accountLabel: conn.external_account_label ?? '네이버 블로그',
      lastSeenAt,
      lastSeenAgoSeconds: lastSeenTime > 0 ? Math.floor(diffMs / 1000) : null,
      // Heartbeat does not check this browser, native host, CDP or the Naver account.
      canAutoPublish: false,
      readiness: 'unknown',
      connectionStatus: conn.status,
    }, { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: '커넥터 상태를 조회하지 못했습니다.' },
      { status: 500, headers: noStore },
    )
  }
}
