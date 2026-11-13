import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceMembership, type WorkspaceAuthSuccess } from '@/lib/auth/workspace-guard'

export const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function authorizeStudio(workspaceId: string, write = false): Promise<WorkspaceAuthSuccess | NextResponse> {
  const auth = await requireWorkspaceMembership(workspaceId)
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: NO_STORE },
    )
  }
  if (!z.string().uuid().safeParse(auth.workspaceId).success) {
    return studioError('INVALID_WORKSPACE_ID', '유효한 작업공간을 선택해 주세요.', 400)
  }
  if (write && auth.role !== 'owner' && auth.role !== 'manager') {
    return NextResponse.json(
      { success: false, error: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다.' },
      { status: 403, headers: NO_STORE },
    )
  }
  return auth
}

export function studioError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: code, message }, { status, headers: NO_STORE })
}

export function studioFailure(error: unknown, fallbackCode: string, fallbackMessage: string): NextResponse {
  const message = error instanceof Error ? error.message : ''
  const code = message.match(/\b(?:STUDIO_(?:FACT|PROPOSAL|TURN|GOAL|QUESTION)_(?:CONFLICT|NOT_FOUND|STREAMING|FAILED)|CREDIT_INSUFFICIENT|GOAL_VERSION_CONFLICT)\b/)?.[0] ?? ''
  if (code === 'STUDIO_TURN_STREAMING') return studioError(code, '소희가 아직 답변을 준비하고 있어요.', 409)
  if (code === 'STUDIO_TURN_FAILED') return studioError(code, '이 대화 요청은 실패했어요. 새 요청으로 다시 시도할 수 있어요.', 503)
  if (code === 'CREDIT_INSUFFICIENT') return studioError(code, '대화에 사용할 크레딧이 부족해요.', 402)
  if (code === 'STUDIO_FACT_CONFLICT' || code === 'STUDIO_PROPOSAL_CONFLICT' || code === 'STUDIO_TURN_CONFLICT' || code === 'STUDIO_GOAL_CONFLICT' || code === 'GOAL_VERSION_CONFLICT') {
    return studioError(code, '내용이 변경되었어요. 최신 정보를 확인해 주세요.', 409)
  }
  if (code === 'STUDIO_PROPOSAL_NOT_FOUND' || code === 'STUDIO_FACT_NOT_FOUND' || code === 'STUDIO_QUESTION_NOT_FOUND' || code === 'STUDIO_GOAL_NOT_FOUND') {
    return studioError(code, '해당 항목을 찾을 수 없어요.', 404)
  }
  return studioError(fallbackCode, fallbackMessage, 503)
}
