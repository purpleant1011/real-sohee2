import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { createProductionReportDecisionRepository } from '@/features/reports/report-decision-repository'
import { getScheduleBoard } from '@/features/schedule/repository'
import { getSocialPostPreviews } from '@/features/social-post-preview/repository'
import { resolveScheduleDate } from '@/features/schedule/schedule-view'
import { AppLink as Link } from '@/components/navigation/app-link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readWorkspaceDataset } from '@/features/reporting/dataset'
import { LEDGER_QUERY_LIMIT, buildLedgerSnapshot, collectSlotIds, type ReservationLedgerRow, type SlotInterval } from './ledger-snapshot'
import { ScheduleEntry } from './schedule-entry'

export default async function SchedulePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ date?: string; experiment?: string }> }> = { searchParams: Promise.resolve({}) }) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  const query = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: workspaceSettings } = await supabase
    .from('workspaces')
    .select('timezone')
    .eq('id', workspace.workspaceId)
    .maybeSingle()
  const timezone = workspaceSettings?.timezone ?? 'Asia/Seoul'
  const experimentId = typeof query.experiment === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(query.experiment)
    ? query.experiment
    : null
  const experimentRepository = experimentId ? await createProductionReportDecisionRepository() : null
  // ANI-1691: R2 장부는 allowlist 매장에서만 읽는다. 플래그 OFF 면 예약 원장 조회 자체를 하지 않는다.
  const r2Enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  const checkedAt = new Date().toISOString()
  const [result, reportExperiment, ledgerResult] = await Promise.all([
    getScheduleBoard(workspace.workspaceId),
    experimentRepository && experimentId
      ? experimentRepository.getReportExperiment(workspace.workspaceId, experimentId)
      : Promise.resolve(null),
    r2Enabled
      ? supabase
        .from('reservations')
        .select('id, workspace_id, customer_name, service_name, status, confirmed_at, metadata, slot_id')
        .eq('workspace_id', workspace.workspaceId)
        .order('updated_at', { ascending: false })
        .limit(LEDGER_QUERY_LIMIT)
      : Promise.resolve(null),
  ])
  if (result.error) {
    return <section><h1>일정을 불러오지 못했어요.</h1><p>{result.error.message}</p><p><Link href="/app/schedule">다시 불러오기</Link> · <Link href="/app">대화로 돌아가기</Link></p></section>
  }
  const previews = await getSocialPostPreviews(workspace.workspaceId, [
    ...result.data.schedules.map((item) => item.version_id),
    ...result.data.plans.map((item) => item.versionId),
  ])
  // ANI-1691: 예약 변경은 slot_id 만 바꾸고 metadata.startsAt/endsAt 는 생성 당시 값으로 남는다.
  // 지금 슬롯 시각을 한 번에 읽어 장부 간격으로 넘긴다. 이 조회가 실패하면 장부는 metadata 로
  // 폴백할 뿐이며, 페이지 전체를 실패시키거나 조회에 성공한 척하지 않는다.
  let slotIntervals: Map<string, SlotInterval> | null = null
  if (r2Enabled && ledgerResult && !ledgerResult.error && ledgerResult.data) {
    const slotIds = collectSlotIds(ledgerResult.data as ReservationLedgerRow[])
    if (slotIds.length > 0) {
      const { data: slots, error: slotsError } = await supabase
        .from('booking_recovery_slots')
        .select('id, starts_at, ends_at')
        .eq('workspace_id', workspace.workspaceId)
        .in('id', slotIds)
      slotIntervals = slotsError || !slots
        ? null
        : new Map(slots.map(slot => [slot.id, { startsAt: slot.starts_at, endsAt: slot.ends_at }]))
    }
  }
  // ANI-1744 G-11: `workspace_registry` 는 service_role 전용 테이블이다
  // (20261008150000_ani_1555: revoke all from public/anon/authenticated + service_role 정책만).
  // 사용자 RLS 클라이언트로 읽으면 항상 permission denied 라 ACTUAL 매장까지 error 로 닫히므로,
  // 분류 읽기만 admin 클라이언트로 수행한다. 예약 행 조회는 아래 기존 RLS 클라이언트를 그대로 쓴다.
  // 조회 실패(throw/error 봉투)를 ACTUAL 로 추정하지 않는다. null 은 빌더가 error 로 닫는다.
  let dataset: Awaited<ReturnType<typeof readWorkspaceDataset>> | null = null
  if (r2Enabled) {
    try {
      const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
      dataset = await readWorkspaceDataset(createAdminSupabaseClient() as any, workspace.workspaceId)
    } catch {
      dataset = null
    }
  }
  const ledger = ledgerResult === null ? null : buildLedgerSnapshot({
    workspaceId: workspace.workspaceId,
    timeZone: timezone,
    rows: ledgerResult.error ? null : (ledgerResult.data as ReservationLedgerRow[] | null),
    error: ledgerResult.error,
    checkedAt,
    slotIntervals,
    datasetMode: dataset?.mode ?? null,
  })

  return <ScheduleEntry
    board={{
      data: result.data,
      previews,
      reportExperiment,
      role: workspace.role,
      selectedDate: resolveScheduleDate(query.date, new Date(), timezone),
      timezone,
      workspaceId: workspace.workspaceId,
    }}
    ledger={ledger}
  />
}
