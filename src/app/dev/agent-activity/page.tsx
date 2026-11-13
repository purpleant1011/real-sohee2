import { notFound } from 'next/navigation'
import { AgentActivityDevPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * ANI-1888 Task16 활동 타임라인 및 결과물 계획 카드 프리뷰
 * 개발 환경 전용 — 운영(production)에서는 404 차단.
 *
 * /dev/agent-activity
 */
export default function AgentActivityDevPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <main className="min-h-dvh bg-muted/30 py-8 px-4 sm:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">활동 타임라인 및 초안 카드 개발 프리뷰</h1>
            <span className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
              시안·연습
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Figma D10/M19 (작업 활동), D11/M20 (홍보 초안 및 실행 계획), M21 (실패/불명확 안내) 상태 검증
          </p>
        </header>

        <AgentActivityDevPreview />
      </div>
    </main>
  )
}
