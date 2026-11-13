import { notFound, redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { buildDepositsSnapshot, type ReservationDepositRow } from '@/features/mobile-deposits/server/deposits-snapshot'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readWorkspaceDataset } from '@/features/reporting/dataset'
import { DepositsEntry } from './deposits-entry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M16 예약금·환불 (ANI-1693 partial). 읽기 전용 화면이다.
 *
 * Gate: R2 노출 플래그(`resolveMobileR2Enabled`, 기본 OFF)가 켜진 allowlist 매장에서만 이 경로가
 * 존재한다. 대신 보여줄 기존 예약금 화면이 아직 없으므로 OFF 는 404 다(빈 화면·가짜 완료 금지).
 *
 * 여기서는 결제를 실행하지 않는다. PG 호출·환불 실행은 이 화면 범위 밖이고, 화면은 예약 장부의
 * 예약금 금액과 '결제사 화면에서 진행' 안내까지만 보여준다. 취소된 예약은 환불 원장 확인 경로가
 * 없어 이 화면에서 '결제 예정'으로 그리지 않는다(별도 후속).
 */
export default async function SchedulePaymentsPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  if (!enabled) notFound()

  const supabase = await createServerSupabaseClient()
  // ANI-1744 G-11: `workspace_registry` 는 service_role 전용 테이블이다
  // (20261008150000_ani_1555: revoke all from public/anon/authenticated + service_role 정책만).
  // 사용자 RLS 클라이언트로 읽으면 항상 permission denied 라 ACTUAL 매장까지 error 로 닫히므로,
  // 분류 읽기만 admin 클라이언트로 수행한다. 예약금 행 조회는 아래 기존 RLS 클라이언트를 그대로 쓴다.
  // 조회 실패(throw/error 봉투)를 ACTUAL 로 추정하지 않는다. null 은 빌더가 error 로 닫는다.
  let dataset: Awaited<ReturnType<typeof readWorkspaceDataset>> | null = null
  try {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    dataset = await readWorkspaceDataset(createAdminSupabaseClient() as any, workspace.workspaceId)
  } catch {
    dataset = null
  }
  const { data, error } = await supabase
    .from('reservations')
    .select('id, workspace_id, deposit_krw, status')
    .eq('workspace_id', workspace.workspaceId)
    .gt('deposit_krw', 0)
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: false })
    .limit(50)

  const snapshot = buildDepositsSnapshot({
    workspaceId: workspace.workspaceId,
    rows: error || !Array.isArray(data) ? null : (data as ReservationDepositRow[]),
    error,
    checkedAt: new Date().toISOString(),
    datasetMode: dataset?.mode ?? null,
  })

  return <DepositsEntry snapshot={snapshot} workspaceId={workspace.workspaceId} />
}
