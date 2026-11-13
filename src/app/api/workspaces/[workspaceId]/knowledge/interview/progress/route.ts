import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { getInterviewProgress } from '@/features/sohee-interview/progress-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await props.params

    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error, message: auth.message },
        { status: auth.status, headers: NO_STORE },
      )
    }

    const result = await getInterviewProgress(auth.workspaceId)

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-interview-progress] failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'INTERVIEW_PROGRESS_FAILED',
        message: '인터뷰 진행 상태를 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
