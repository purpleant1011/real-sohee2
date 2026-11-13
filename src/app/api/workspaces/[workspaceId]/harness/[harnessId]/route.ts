export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { supabaseHarnessRepository } from '@/features/harness/supabase-harness-repository'
import { harnessStore } from '@/lib/harness/harness-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; harnessId: string }> }
) {
  const { workspaceId, harnessId } = await params

  // Cross-tenant guard: harnessStore is a process-wide in-memory map and the repository uses
  // the service-role client, so neither RLS nor the store isolates workspaces by itself.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const asset = harnessStore.getAssetById(harnessId)

    if (!asset) {
      return NextResponse.json(
        { ok: false, error: 'Harness not found' },
        { status: 404 }
      )
    }

    const version = asset.activeVersionId
      ? await supabaseHarnessRepository.getVersionById(asset.activeVersionId)
      : undefined

    const rules = version
      ? await supabaseHarnessRepository.getRulesByVersionId(version.id)
      : []

    const overrides = harnessStore.getOverrides(harnessId)
    const channelAssignments = harnessStore.getAssignments(workspaceId).filter(
      ca => ca.harnessAssetId === harnessId
    )

    return NextResponse.json({
      ok: true,
      asset,
      version,
      rules,
      overrides,
      channelAssignments
    })
  } catch (error: any) {
    console.error('[HarnessDetailAPI Error]', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
