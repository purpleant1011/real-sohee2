'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { Button } from '@/components/ui/button'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { MobileDepositsView, type DepositsViewSnapshot } from '@/features/mobile-deposits/deposits-view'

/** 넓은 화면(PC·노트북)에는 아직 예약금 화면이 없다. 좁은 화면에서만 R2 화면을 그린다. */
export const DEPOSITS_WIDE_NOTICE = '예약금 상세는 휴대폰 화면에서 확인할 수 있어요.'

/**
 * PG 결제 실행은 이 화면 범위 밖이다. 연결 전에는 chargeGuard 가 버튼을 막으므로 호출되지 않지만,
 * 호출되더라도 외부 요청을 만들지 않도록 아무 것도 하지 않는다.
 */
const notWired = () => undefined

/** M16 예약금 — 플래그 ON + 좁은 화면에서만 R2 화면(ANI-1693 partial). */
export function DepositsEntry({ snapshot, workspaceId }: { snapshot: DepositsViewSnapshot; workspaceId?: string }) {
  const active = useMobileR2Active()

  if (!active) {
    return (
      <V088AppShell workspaceId={workspaceId}>
        <main className="mx-auto flex min-h-[50vh] w-full max-w-2xl flex-col items-center justify-center p-4 md:p-6">
          <div className="w-full space-y-4 rounded-2xl border border-border bg-card p-6 sm:p-8 text-center shadow-xs">
            <h1 className="text-xl font-bold text-foreground">예약금</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{DEPOSITS_WIDE_NOTICE}</p>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/app/schedule">
                일정으로 돌아가기
              </Link>
            </Button>
          </div>
        </main>
      </V088AppShell>
    )
  }

  return <MobileDepositsView snapshot={snapshot} onCharge={notWired} />
}
