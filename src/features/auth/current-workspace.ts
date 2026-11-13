import 'server-only'

import { resolveDeterministicWorkspace, type WorkspaceContext } from './workspace-context'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * 현재 가게 확인 결과(ANI-1714). 실패를 하나의 null 로 뭉개면 '로그인이 만료됨(401)'과
 * '권한이 없음(403)'과 '소속 가게가 없음(404)'을 구분할 수 없다.
 */
export type WorkspaceContextResolution =
  | { status: 'ready'; context: WorkspaceContext }
  /** 401 — 세션이 없거나 만료됐다. 다시 로그인하면 풀린다. */
  | { status: 'expired' }
  /** 403 — 세션은 있으나 이 가게를 볼 권한이 없다. 가게 관리자의 조치가 필요하다. */
  | { status: 'forbidden' }
  /** 404 — 활성 소속 가게가 없다. 온보딩으로 보낸다. */
  | { status: 'missing' }
  /** 예상 밖 오류. 인증·권한 판정이 아니므로 fail-closed 로만 다룬다. */
  | { status: 'error' }

export async function resolveCurrentWorkspaceContext(
  preferredWorkspaceId?: string | null,
): Promise<WorkspaceContextResolution> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()

    if (claimsError || typeof claimsData?.claims?.sub !== 'string') return { status: 'expired' }

    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: claimsData.claims.sub,
      userEmail: typeof claimsData.claims.email === 'string' ? claimsData.claims.email : null,
      requestedWorkspaceId: preferredWorkspaceId,
    })

    if (!resolved.success) {
      if (resolved.statusCode === 401) return { status: 'expired' }
      if (resolved.statusCode === 403) return { status: 'forbidden' }
      if (resolved.statusCode === 404) return { status: 'missing' }
      // 500 — 조회 실패다. '소속 가게 없음'으로 단정하지 않는다.
      return { status: 'error' }
    }

    return {
      status: 'ready',
      context: {
        workspaceId: resolved.workspaceId,
        role: resolved.role,
        status: resolved.status,
      },
    }
  } catch (err) {
    console.warn('[resolveCurrentWorkspaceContext] Fallback on unexpected error:', err)
    return { status: 'error' }
  }
}

/** 기존 호출부 계약 유지: 가게를 확정하지 못하면 null. 사유가 필요한 곳은 위 함수를 쓴다. */
export async function getCurrentWorkspaceContext(preferredWorkspaceId?: string | null): Promise<WorkspaceContext | null> {
  const resolved = await resolveCurrentWorkspaceContext(preferredWorkspaceId)
  return resolved.status === 'ready' ? resolved.context : null
}
