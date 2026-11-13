import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type NaverRevisionReadiness = 'ready' | 'not_ready' | 'unavailable'
export const NAVER_REVISION_UNAVAILABLE = '네이버 원고 수정 저장 기능의 준비가 확인되지 않았어요. 원고 조회와 복사는 계속 사용할 수 있어요.'

export function naverRevisionUnavailable(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error.code === 'PGRST202' || error.code === '42883')
}

/** Absence/error never grants write capability; the probe itself only reads catalog metadata. */
export async function loadNaverRevisionReadiness(client: SupabaseClient<Database>): Promise<NaverRevisionReadiness> {
  try {
    const result = await client.rpc('naver_revision_readiness')
    if (result.error) return naverRevisionUnavailable(result.error) ? 'not_ready' : 'unavailable'
    const value = result.data
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.contract !== 'naver-revision-v1' || typeof value.ready !== 'boolean') return 'unavailable'
    return value.ready ? 'ready' : 'not_ready'
  } catch { return 'unavailable' }
}
