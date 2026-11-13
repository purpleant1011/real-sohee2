import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { analyzeKnowledgeIntelligence } from '@/features/sohee-knowledge/intelligence-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * 워크스페이스 지식 인텔리전스 분석 조회 (역질문, 시즌 트리거, 상권 인사이트)
 */
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

    const result = await analyzeKnowledgeIntelligence(auth.workspaceId)
    return NextResponse.json(
      { success: true, data: result },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-intelligence:get] failed:',
      error instanceof Error ? error.message : 'unknown',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'INTELLIGENCE_ANALYSIS_FAILED',
        message: '지식 인텔리전스를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
