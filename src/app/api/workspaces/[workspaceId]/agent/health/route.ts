export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceDependencyHealth } from '@/features/agent-os/dependency-health-service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const health = await getWorkspaceDependencyHealth(workspaceId)

    return NextResponse.json(health, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error checking dependency health'
    return NextResponse.json(
      { error: message, overallStatus: 'DOWN', dependencies: [] },
      { status: 500 }
    )
  }
}
