export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { supabaseHarnessRepository } from '@/features/harness/supabase-harness-repository'
import { harnessStore } from '@/lib/harness/harness-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard: the harness repository uses the service-role client, so RLS cannot
  // stop a foreign workspaceId. Refuse a non-member before any read.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const assets = await supabaseHarnessRepository.getAssets(workspaceId)
    const channelAssignments = harnessStore.getAssignments(workspaceId)

    return NextResponse.json({
      ok: true,
      assets,
      channelAssignments
    })
  } catch (error: any) {
    console.error('[HarnessListAPI Error]', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard: refuse a non-member before compiling or reading any harness asset.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  return NextResponse.json(
    {
      ok: false,
      error: '이 기능은 이미지 스타일 화면의 "링크로 한 번에 만들기"로 옮겨졌어요.',
      replacement: '/app/settings/image-style'
    },
    { status: 410 }
  )
}

