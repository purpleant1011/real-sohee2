export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { harnessStore } from '@/lib/harness/harness-store'
import { PlatformType } from '@/types/harness'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; harnessId: string }> }
) {
  const { workspaceId, harnessId } = await params

  // Cross-tenant guard: this mutates the process-wide harness assignment map, so a
  // non-member must be refused before the channel binding is written.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json()
    const { channelId, channelName, channelPlatform, enabled = true } = body

    if (!channelId || !channelPlatform) {
      return NextResponse.json(
        { ok: false, error: 'channelId and channelPlatform are required' },
        { status: 400 }
      )
    }

    const assignment = harnessStore.assignChannel(
      workspaceId,
      channelId,
      channelName || channelId,
      channelPlatform as PlatformType,
      harnessId,
      'FOLLOW_ACTIVE',
      'FULL_AUTONOMOUS',
      enabled
    )

    return NextResponse.json({
      ok: true,
      assignment
    })
  } catch (error: any) {
    console.error('[HarnessAssignAPI Error]', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
