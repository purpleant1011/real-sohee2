'use client'

import { useOptionalWorkspaceContext, useWorkspaceContext } from '@/components/workspace/workspace-provider'

export { useWorkspaceContext, useOptionalWorkspaceContext }

/**
 * Hook to retrieve the current active workspace ID.
 * Security notice (ANI-721, ANI-1035):
 * Server-authoritative WorkspaceProvider is the single source of truth.
 * 'ws-default' is strictly forbidden in normal authenticated paths.
 */
export function useWorkspaceId(defaultFallback?: string): string {
  // 1. Try React Context (server-authoritative)
  const context = useOptionalWorkspaceContext()
  if (context?.workspaceId && context.workspaceId !== 'ws-default') {
    return context.workspaceId
  }

  // 2. ANI-1779: 선택한 가게는 서버가 읽는 httpOnly 쿠키로만 유지한다. 예전 sessionStorage
  //    캐시는 서버 진실과 갈라질 수 있어(화면=B, 서버=A) 읽지 않는다.

  // 3. If explicit test fallback provided (must not be 'ws-default')
  if (defaultFallback && defaultFallback !== 'ws-default') {
    return defaultFallback
  }

  throw new Error('WORKSPACE_REQUIRED: No valid workspace context found. ws-default fallback is forbidden.')
}
