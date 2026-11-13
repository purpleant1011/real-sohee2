import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createMobileReadDeps } from '@/features/mobile-decision/server/production'
import { readMobileHome } from '@/features/mobile-decision/server/read-model'
import { readWorkspaceDataset } from '@/features/reporting/dataset'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  // 같은 origin의 Resource Timing에서도 병목을 구분한다. 식별자·SQL·오류 본문은 기록하지 않는다.
  const timings: string[] = []
  // 권한 확인부터 홈 집계까지 클라이언트의 15초보다 짧은 조회 예산을 공유한다.
  const deadline = performance.now() + 12_000
  async function measure<T>(stage: 'auth' | 'dataset' | 'home', read: () => Promise<T>): Promise<T> {
    const started = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const remaining = Math.min(stage === 'home' ? 6_000 : 5_000, deadline - started)
      if (remaining <= 0) throw new Error('조회 시간 초과')
      // 원래 조회의 취소를 보장하지는 않지만, 늦은 결과로 후속 단계를 실행하지 않는다.
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('조회 시간 초과')), remaining)
        }),
      ])
    } finally {
      clearTimeout(timer)
      timings.push(`${stage};dur=${Math.max(0, performance.now() - started).toFixed(1)}`)
    }
  }
  function finish(response: NextResponse) {
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Server-Timing', timings.join(', '))
    return response
  }
  try {
    const { workspaceId } = await params
    const auth = await measure('auth', () => authorizeQuickRequest(workspaceId, { requireRole: 'reviewer' }))
    if (isResponse(auth)) return finish(auth)
    if (auth.workspaceId !== workspaceId) return finish(NextResponse.json({ error: '기록을 찾을 수 없어요.' }, { status: 404 }))
    const dataset = await measure('dataset', () => readWorkspaceDataset(auth.admin, auth.workspaceId))
    if (dataset.mode !== 'ACTUAL') return finish(NextResponse.json({ error: '업무 데이터를 확인하지 못했어요.' }, { status: 503 }))
    const view = await measure('home', () => readMobileHome(auth, createMobileReadDeps(auth.supabase, undefined, auth.admin)))
    return finish(NextResponse.json(view))
  } catch {
    return finish(NextResponse.json({ error: '업무를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.' }, { status: 503 }))
  }
}
