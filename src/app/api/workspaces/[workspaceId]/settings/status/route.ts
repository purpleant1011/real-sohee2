import { NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readRuntimeControl } from '@/features/marketing-agent/engine/runtime-control-read'
import { getNotificationCenter } from '@/features/notifications/repository'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const failed = { ok: false as const, value: null }

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await requireWorkspaceMembership(workspaceId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers })
  const [control, notifications] = await Promise.allSettled([
    createServerSupabaseClient().then(client => readRuntimeControl(client, workspaceId)),
    getNotificationCenter(workspaceId),
  ])
  const checkedAt = new Date().toISOString()
  const state = control.status === 'fulfilled' ? control.value : null
  const center = notifications.status === 'fulfilled' ? notifications.value.data : null
  return NextResponse.json({
    workspaceId,
    automation: state?.workspaceId === workspaceId
      ? { ok: true, value: { mode: state.actualMode, checkedAt } } : failed,
    notifications: center?.userId === auth.userId
      ? { ok: true, value: { recentCount: center.notifications.length, unreadCount: center.notifications.filter(item => item.readAt === null).length, checkedAt } } : failed,
  }, { headers })
}
