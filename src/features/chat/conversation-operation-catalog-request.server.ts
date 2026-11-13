import 'server-only'
import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { getGeminiApiKey, getModelProfile } from '@/lib/ai/model-profiles'
import { loadConversationOperationCatalog } from './conversation-operation-catalog.server'

export async function loadAuthorizedConversationCatalog(workspaceId: string) {
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth
  try {
    const profile = getModelProfile('action')
    const geminiConfigured = Boolean(getGeminiApiKey())
    const openaiConfigured = Boolean(process.env.OPENAI_API_KEY)
    return await loadConversationOperationCatalog({ client: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId,
      modelConfigured: geminiConfigured || openaiConfigured,
      agentModelConfigured: profile.provider === 'gemini' ? geminiConfigured : profile.provider === 'openai' && openaiConfigured })
  } catch (error) {
    const forbidden = error instanceof Error && error.message === 'CONVERSATION_CATALOG_FORBIDDEN'
    return NextResponse.json({ error: forbidden ? '이 가게의 업무를 열 권한이 없어요.' : '업무 준비 상태를 확인하지 못했어요. 잠시 후 다시 조회해 주세요.' },
      { status: forbidden ? 403 : 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
