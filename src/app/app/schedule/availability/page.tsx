import { redirect } from 'next/navigation'
import { AppLink as Link } from '@/components/navigation/app-link'
import { Button } from '@/components/ui/button'
import { StateView } from '@/components/mobile-ui/state-view'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { isRecoveryEnabled } from '@/features/booking-recovery/production'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { AvailabilityPanel } from './availability-panel'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * ANI-1610 — 예약 장부 최신성과 사장님 수동 확인(수동 대안)을 한 화면에서 일관되게 보여준다.
 *
 * Gate: the booking-recovery rollout gate (`isRecoveryEnabled`, fail-closed in production)
 * decides whether this route is active for a workspace. If OFF, shows a friendly StateView
 * with a back CTA instead of a cold 404.
 */
export default async function ScheduleAvailabilityPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  if (!isRecoveryEnabled(workspace.workspaceId)) {
    return (
      <V088AppShell workspaceId={workspace.workspaceId}>
        <main className="mx-auto flex min-h-[50vh] w-full max-w-2xl flex-col items-center justify-center p-4 md:p-6">
          <StateView
            kind="confirmed_empty"
            title="아직 준비 중이에요"
            description="예약 가능 시간 확인 기능을 준비하고 있어요."
            action={
              <Button asChild variant="outline" className="min-h-11">
                <Link href="/app/schedule">일정으로 돌아가기</Link>
              </Button>
            }
          />
        </main>
      </V088AppShell>
    )
  }

  const supabase = await createServerSupabaseClient()
  const { data: workspaceSettings } = await supabase
    .from('workspaces')
    .select('timezone')
    .eq('id', workspace.workspaceId)
    .maybeSingle()
  const timezone = (workspaceSettings as { timezone?: string } | null)?.timezone ?? 'Asia/Seoul'

  return (
    <V088AppShell workspaceId={workspace.workspaceId}>
      <main className="mx-auto w-full max-w-2xl space-y-5 p-4 md:p-6">
        <nav className="text-xs text-muted-foreground" aria-label="위치">
          <Link href="/app/schedule">일정</Link>
          <span aria-hidden="true"> · </span>
          <span>예약 가능 시간 확인</span>
        </nav>

        <header className="space-y-2">
          <h1 className="text-xl font-bold text-foreground">예약 가능 시간 확인</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            외부 예약 장부와 내부 기록이 같은 최신 상태인지 먼저 보여드려요. 장부를 방금 확인하지
            않았다면 고객에게 시간을 확정해 안내하지 않고, 사장님이 직접 확인한 시간만 제안합니다.
          </p>
        </header>

        <AvailabilityPanel workspaceId={workspace.workspaceId} timezone={timezone} />
      </main>
    </V088AppShell>
  )
}
