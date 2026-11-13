'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import { AlertCircle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock3, MessageSquareText, Send, Sparkles } from 'lucide-react'
import { DetailPanel } from '@/components/layout/detail-panel'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { soheeToastQueue } from '@/components/ui/toast-region'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import { useKakaoHistory } from '@/features/kakao/history/use-kakao-history'
import { KakaoStatusBadge } from '@/features/kakao/history/history-badge'
import { getLatestKakaoByReservation } from '@/features/kakao/history/latest-by-reservation'
import { PublishStatusCard } from '@/features/local-publishing/publish-status-card'
import { RecoveryCard } from '@/features/publishing/recovery-card'
import type { ReportExperimentContext } from '@/features/reports/report-decision-repository'
import { SocialPostPreview } from '@/features/social-post-preview/social-post-preview'
import type { SocialPostPreviewMap } from '@/features/social-post-preview/types'
import { formatKoreanDateTime, formatKoreanDay } from '@/lib/format-display-date'
import { cancelScheduleAction, rescheduleContentAction, scheduleContentAction } from './actions/schedule-content'
import { recommendScheduleTimes } from './schedule-recommendations'
import type { ScheduleBoard as BoardData, ScheduleEntry, ScheduleUnavailableSource } from './repository'
import { buildDailyScheduleProjection, countScheduleStatuses, groupSchedulesByDay, resolveScheduleDate, scheduleActivityAt, scheduleStatusFilter } from './schedule-view'
import { useQueryStates } from 'nuqs'
import { scheduleQueryParsers } from './schedule-query-state'
import styles from './schedule-board.module.css'

const channelNames: Readonly<Record<string, string>> = { instagram: '인스타그램', threads: 'Threads', naver: '네이버' }
const scheduleStatus: Readonly<Record<ScheduleEntry['status'], string>> = {
  scheduled: '예약됨', publishing: '게시하고 있어요', published: '완료', failed: '다시 확인 필요', cancelled: '예약 취소됨', unknown: '다시 확인 필요',
}
const planStatus: Readonly<Record<string, string>> = { draft: '소희와 준비 중', review: '내용 확인 필요', approved: '시간 결정 필요' }
const partialSourceLabels: Readonly<Partial<Record<ScheduleUnavailableSource, string>>> = {
  customer_reservations: '고객 예약', internal_tasks: '소희의 준비 작업', publish_tracking: '실제 게시물 연결', local_publishes: '로컬 게시 상태', publish_attempts: '게시 결과',
}

function channelLabel(channel: string) { return channelNames[channel.toLowerCase()] ?? channel }
function civilDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)) }
function addDays(value: string, amount: number) { const date = civilDate(value); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10) }
function weekdayLabel(value: string) { return new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'UTC' }).format(civilDate(value)) }
function dateNumber(value: string) { return String(Number(value.slice(8, 10))) }
function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(new Date(value)).replace('AM', '오전').replace('PM', '오후')
}
function formatDate(value: string, timezone: string) { return { day: formatKoreanDay(value, timezone), time: formatTime(value, timezone), full: formatKoreanDateTime(value, timezone) } }
function formatDetailDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: timezone, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)).replace('AM', '오전').replace('PM', '오후')
}
function conversationHref(input: Readonly<{ intent: 'create_schedule' | 'revise_content' | 'review_context' | 'recover_publish'; returnTo: string; scheduleId?: string; contentId?: string; contentVersionId?: string; conversationThreadId?: string }>) {
  const query = new URLSearchParams({ entryPoint: 'schedule', intent: input.intent, returnTo: input.returnTo })
  if (input.scheduleId) query.set('scheduleId', input.scheduleId)
  if (input.contentId) query.set('contentId', input.contentId)
  if (input.contentVersionId) query.set('contentVersionId', input.contentVersionId)
  if (input.conversationThreadId) query.set('conversationThreadId', input.conversationThreadId)
  return `/app?${query.toString()}`
}
function partialMessage(sources: readonly ScheduleUnavailableSource[]) {
  const labels = [...new Set(sources.flatMap((source) => partialSourceLabels[source] ? [partialSourceLabels[source]!] : []))]
  if (labels.length === 0) return '일정 일부를 확인하지 못했어요. 표시된 일정은 계속 이용할 수 있어요.'
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')}과 ${labels.at(-1)}`
  return `${joined} 일부를 확인하지 못했어요. 표시된 일정은 계속 이용할 수 있어요.`
}

export function ScheduleBoard({ data, workspaceId, role, previews = {}, selectedDate, timezone = 'Asia/Seoul', reportExperiment = null, now = new Date() }: Readonly<{
  data: BoardData; workspaceId: string; role: WorkspaceRole; previews?: SocialPostPreviewMap; selectedDate?: string; timezone?: string; reportExperiment?: ReportExperimentContext | null; now?: Date
}>) {
  const isPreview = !workspaceId || workspaceId.startsWith('preview-') || workspaceId === 'ws-default'
  const { items: kakaoHistoryItems, load: kakaoLoad } = useKakaoHistory({
    workspaceId: isPreview ? '' : workspaceId,
    limit: 100,
  })
  const kakaoByReservation = useMemo(() => {
    return getLatestKakaoByReservation(kakaoHistoryItems)
  }, [kakaoHistoryItems])

  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [{ kind: filter, selected: selectedScheduleId, status: statusFilter }, setScheduleQuery] = useQueryStates(
    scheduleQueryParsers,
    { history: 'replace', shallow: true },
  )
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [desktopDetailMode, setDesktopDetailMode] = useState(false)
  const [referenceNow] = useState(() => now)
  const canManage = role === 'owner' || role === 'manager'
  const selectedDay = selectedDate ?? resolveScheduleDate(undefined, referenceNow, timezone)
  const today = resolveScheduleDate(undefined, referenceNow, timezone)
  const returnTo = `/app/schedule?date=${selectedDay}`
  const projection = buildDailyScheduleProjection({ selectedDate: selectedDay, timezone, schedules: data.schedules, attempts: data.attempts, internalTasks: data.internalTasks })
  const daySchedules = [...projection.activeSchedules, ...projection.completedSchedules]
  const statusCounts = countScheduleStatuses(daySchedules)
  const visibleSchedules = daySchedules.filter((item) => statusFilter === 'all' || scheduleStatusFilter(item.status) === statusFilter)
  const activeGroups = groupSchedulesByDay(visibleSchedules.filter((item) => scheduleStatusFilter(item.status) !== 'completed'))
  const completedGroups = groupSchedulesByDay(visibleSchedules.filter((item) => scheduleStatusFilter(item.status) === 'completed'))
  const groupedVisibleSchedules = [...activeGroups, ...completedGroups].flatMap((group) => group.items.map((item, index) => ({ item, dayLabel: index === 0 ? group.label : null })))
  const selectedSchedule = data.schedules.find((item) => item.id === selectedScheduleId) ?? null
  const selectedAttempt = selectedSchedule ? data.attempts[selectedSchedule.id] : undefined
  const selectedPreview = selectedSchedule ? previews[selectedSchedule.version_id] : undefined
  const selectedRecommendations = useMemo(() => selectedSchedule ? recommendScheduleTimes({
    now: new Date(Math.max(referenceNow.getTime(), new Date(selectedSchedule.publish_at).getTime() - 2 * 60 * 60 * 1000)),
    timezone, channelConnectionId: selectedSchedule.channel_connection_id,
    existingSchedules: data.schedules.filter((item) => item.id !== selectedSchedule.id && (item.status === 'scheduled' || item.status === 'publishing')).map((item) => ({ channelConnectionId: item.channel_connection_id, scheduledAtUtc: item.publish_at })),
    customerReservations: data.customerReservations.map((item) => ({ startsAt: item.startsAt })),
  }) : [], [data.customerReservations, data.schedules, referenceNow, selectedSchedule, timezone])
  const datedReservations = data.customerReservations.filter((item) => item.startsAt && resolveScheduleDate(undefined, new Date(item.startsAt), item.timezone ?? timezone) === selectedDay)
  const undatedReservations = data.customerReservations.filter((item) => !item.startsAt)
  const dailySummary = projection.summary
  const completedSummary = dailySummary.completedChannels.length === 0 ? dailySummary.completedCount > 0 ? '소희가 준비 작업을 마쳤어요.' : '아직 완료한 내역은 없어요.' : `${dailySummary.completedChannels.map(({ channel, count }) => `${channelLabel(channel)} ${count}건`).join(' · ')} 게시했어요.`
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(selectedDay, index))
  const firstCompletedId = groupedVisibleSchedules.find(({ item }) => scheduleStatusFilter(item.status) === 'completed')?.item.id ?? null
  const decisionCount = data.plans.length + data.ready.length + data.localPublishes.length + undatedReservations.length
  const scheduleTriggers = groupedVisibleSchedules.map(({ item }) => item.id)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 1200px)')
    const update = () => setDesktopDetailMode(query.matches)
    const frame = requestAnimationFrame(update)
    query.addEventListener('change', update)
    return () => { cancelAnimationFrame(frame); query.removeEventListener('change', update) }
  }, [])

  function schedule(form: FormData, approvalId: string, versionId: string) {
    startTransition(async () => {
      const result = await scheduleContentAction({ workspaceId, approvalId, versionId, channelConnectionId: form.get('channelConnectionId'), scheduledLocal: form.get('scheduledLocal'), timezone })
      if (result.error) { setMessage(result.error.message); return }
      setMessage('확인한 콘텐츠의 일정을 저장했어요.'); soheeToastQueue.add({ title: '일정을 저장했어요.', description: '확인한 콘텐츠는 그대로 유지돼요.' }); router.refresh()
    })
  }
  function reschedule(form: FormData, item: ScheduleEntry) {
    startTransition(async () => {
      const result = await rescheduleContentAction({ workspaceId, scheduleId: item.id, expectedUpdatedAt: item.updated_at, scheduledLocal: form.get('scheduledLocal'), timezone })
      if (result.error) { setMessage(result.error.message); return }
      setMessage('새 시간으로 변경했어요. 확인한 콘텐츠는 그대로 유지돼요.'); soheeToastQueue.add({ title: '새 시간으로 변경했어요.', description: '확인한 콘텐츠는 그대로 유지돼요.' }); void setScheduleQuery({ selected: null }); router.refresh()
    })
  }
  function cancel(item: ScheduleEntry) {
    startTransition(async () => {
      const result = await cancelScheduleAction({ workspaceId, scheduleId: item.id, expectedUpdatedAt: item.updated_at })
      if (result.error) { setMessage(result.error.message); return }
      setMessage('예약을 취소했어요. 확인한 콘텐츠는 시간 미정 상태로 보관돼요.'); soheeToastQueue.add({ title: '예약을 취소했어요.', description: '확인한 콘텐츠는 시간 미정으로 보관돼요.' }); setConfirmCancelId(null); void setScheduleQuery({ selected: null }); router.refresh()
    })
  }
  function focusNeighbor(scheduleId: string, direction: -1 | 1) {
    const target = scheduleTriggers[scheduleTriggers.indexOf(scheduleId) + direction]
    if (target) document.querySelector<HTMLElement>(`[data-schedule-detail-trigger="${target}"]`)?.focus()
  }

  const detailContent = selectedSchedule ? <div className={styles.detailContent}>
    <div className={styles.detailLead}><span className={`${styles.detailStatus} ${styles[selectedSchedule.status] ?? ''}`}>{scheduleStatus[selectedSchedule.status]}</span><strong>{channelLabel(selectedSchedule.channel)}{selectedPreview?.accountLabel ? ` · ${selectedPreview.accountLabel}` : ''}</strong><p>확인한 콘텐츠와 실제 실행 결과를 한곳에서 확인해요.</p></div>
    {selectedPreview ? <SocialPostPreview preview={selectedPreview} /> : <p className={styles.previewUnavailable}>게시 미리보기를 준비하고 있어요.</p>}
    <dl className={styles.detailFacts}><div><dt>예약 시각</dt><dd>{formatDetailDate(selectedSchedule.publish_at, selectedSchedule.timezone)}</dd></div><div><dt>실제 완료 시각</dt><dd>{selectedAttempt?.status === 'succeeded' && selectedAttempt.finished_at ? formatDetailDate(selectedAttempt.finished_at, selectedSchedule.timezone) : '아직 완료 전'}</dd></div></dl>
    {(selectedSchedule.status === 'failed' || selectedSchedule.status === 'unknown' || selectedAttempt?.status === 'failed' || selectedAttempt?.status === 'unknown') ? <div className={styles.detailAlert}><AlertCircle aria-hidden="true" /><div><strong>게시하지 못했어요.</strong><p>채널 연결과 게시 상태를 다시 확인해 주세요.</p><p>확인한 콘텐츠는 그대로 보관되어 있어요.</p></div></div> : null}
    {selectedSchedule.status === 'scheduled' && canManage ? <section className={styles.reschedulePanel} aria-labelledby="reschedule-heading"><div><h3 id="reschedule-heading">일정 바꾸기</h3><p>시간만 바꾸면 확인한 콘텐츠는 그대로 유지돼요.</p></div><div className={styles.recommendationList}>{selectedRecommendations.map((recommendation) => <form action={(form) => reschedule(form, selectedSchedule)} key={recommendation.scheduledAtUtc}><input type="hidden" name="scheduledLocal" value={recommendation.scheduledLocal} /><button disabled={pending} type="submit"><strong>{formatDetailDate(recommendation.scheduledAtUtc, timezone)}</strong><span>{recommendation.reason}</span></button></form>)}</div><details className={styles.directTime}><summary>직접 날짜와 시간 선택</summary><form action={(form) => reschedule(form, selectedSchedule)}><label>변경할 날짜와 시간<input type="datetime-local" name="scheduledLocal" required /></label><button disabled={pending}>이 시간으로 변경</button></form></details>{confirmCancelId === selectedSchedule.id ? <div className={styles.cancelConfirm} role="alert"><p>예약만 취소하고 확인한 콘텐츠는 시간 미정으로 보관할까요?</p><button disabled={pending} onClick={() => cancel(selectedSchedule)} type="button">예약 취소 확인</button><button disabled={pending} onClick={() => setConfirmCancelId(null)} type="button">계속 유지</button></div> : <button className={styles.cancelButton} disabled={pending} onClick={() => setConfirmCancelId(selectedSchedule.id)} type="button">예약 취소</button>}</section> : null}
    <div className={styles.detailLinks}><Link href={conversationHref({ intent: selectedSchedule.status === 'failed' || selectedSchedule.status === 'unknown' ? 'recover_publish' : 'review_context', scheduleId: selectedSchedule.id, contentId: selectedSchedule.content_id, contentVersionId: selectedSchedule.version_id, returnTo })}>관련 대화 보기</Link>{selectedAttempt?.status === 'succeeded' ? <Link href={`/app/reports?view=reactions&work=${selectedSchedule.content_id}`}>성과와 고객 반응 보기</Link> : null}{selectedAttempt?.status === 'succeeded' && selectedAttempt.destination_url ? <a href={selectedAttempt.destination_url} target="_blank" rel="noreferrer">실제 게시물 보기</a> : null}</div>
    {selectedAttempt?.error_code ? <details className={styles.diagnostics}><summary>고객 지원용 자세한 정보</summary><code>{selectedAttempt.error_code}</code></details> : null}
  </div> : <div className={styles.detailPlaceholder}><CalendarClock aria-hidden="true" /><strong>일정을 선택해 주세요.</strong><p>시간, 게시 결과, 연결된 대화를 여기에서 확인할 수 있어요.</p></div>

  return <div className={styles.page}>
    <header className={styles.pageHeader}><div><h1>일정</h1><p>소희가 한 일과 앞으로 할 일을 하루의 흐름으로 확인해요.</p></div><Link className={styles.primaryAction} href={conversationHref({ intent: 'create_schedule', returnTo })}>소희와 일정 잡기</Link></header>
    {data.partialData ? <p className={styles.partialWarning} role="status">{partialMessage(data.unavailableSources)}</p> : null}
    {reportExperiment ? <section aria-labelledby="report-experiment-heading" className={styles.reportExperiment}><div><p>리포트에서 가져온 비교 계획</p><h2 id="report-experiment-heading">리포트 실험 계획</h2><strong>{reportExperiment.hypothesis}</strong></div><dl><div><dt>가 후보</dt><dd>{formatDetailDate(reportExperiment.variantAScheduledAt, timezone)}</dd></div><div><dt>나 후보</dt><dd>{formatDetailDate(reportExperiment.variantBScheduledAt, timezone)}</dd></div><div><dt>먼저 볼 지표</dt><dd>{reportExperiment.primaryMetric}</dd></div><div><dt>결과 검토</dt><dd>{formatDetailDate(reportExperiment.reviewAt, timezone)}</dd></div></dl><p>{reportExperiment.approvalState === 'not_requested' ? '아직 승인이나 일정 예약을 요청하지 않았어요.' : '확인한 콘텐츠의 승인 상태를 살펴보고 있어요.'}</p><small>표시된 시각은 비교 후보예요. 확인과 예약을 마쳐야 실제 일정이 생겨요.</small></section> : null}
    <section aria-label="오늘의 운영 브리핑" className={styles.dailyBriefing}><div><Sparkles aria-hidden="true" /><span><strong>오늘 소희가 할 일 {dailySummary.plannedCount}개</strong><small>선택한 날짜에 준비하거나 실행할 일만 보여드려요.</small></span></div><div className={styles.completedBrief}><CheckCircle2 aria-hidden="true" /><span><strong>오늘 소희가 한 일 {dailySummary.completedCount}건</strong><small>{completedSummary}</small></span></div><div className={dailySummary.needsAttentionCount > 0 ? styles.attentionBrief : styles.calmBrief}><AlertCircle aria-hidden="true" /><span><strong>확인이 필요한 일 {dailySummary.needsAttentionCount}개</strong><small>{dailySummary.needsAttentionCount > 0 ? '먼저 확인할 일을 살펴보세요.' : '지금 확인이 필요한 일은 없어요.'}</small></span></div></section>
    <nav aria-label="날짜 선택" className={styles.dateStrip}><Link aria-label="이전 주" href={`/app/schedule?date=${addDays(selectedDay, -7)}`}><ChevronLeft aria-hidden="true" /></Link>{weekDates.map((date) => <Link aria-current={date === selectedDay ? 'date' : undefined} href={`/app/schedule?date=${date}`} key={date}><span>{weekdayLabel(date)}</span><strong>{dateNumber(date)}</strong></Link>)}<Link aria-label="다음 주" href={`/app/schedule?date=${addDays(selectedDay, 7)}`}><ChevronRight aria-hidden="true" /></Link></nav>
    {selectedDay !== today ? <Link className={styles.todayLink} href={`/app/schedule?date=${today}`}>오늘로 돌아가기</Link> : null}
    <div className={styles.filterBar}><SegmentedControl ariaLabel="일정 활동 필터" items={[{ id: 'all', label: '전체' }, { id: 'content', label: '콘텐츠' }, { id: 'customer', label: '고객 예약' }]} onChange={(kind) => { void setScheduleQuery({ kind, selected: null }) }} value={filter} /></div>
    {filter !== 'customer' ? <div className={styles.statusFilterBar}><SegmentedControl ariaLabel="게시 상태 필터" items={[{ id: 'all', label: '전체', count: statusCounts.all }, { id: 'upcoming', label: '예정', count: statusCounts.upcoming }, { id: 'publishing', label: '진행 중', count: statusCounts.publishing }, { id: 'completed', label: '완료', count: statusCounts.completed }, { id: 'recovery', label: '다시 확인', count: statusCounts.recovery }]} onChange={(status) => { void setScheduleQuery({ status, selected: null }) }} value={statusFilter} /></div> : null}
    {message ? <p role="status" className={styles.statusMessage}>{message}</p> : null}

    <div className={styles.boardLayout}><section aria-label="소희의 실행 타임라인" className={styles.timeline}><div className={styles.sectionHeading}><div><Sparkles aria-hidden="true" /><h2>오늘의 흐름</h2></div><p>{selectedDay.replaceAll('-', '.')}</p></div>
      {filter !== 'customer' ? projection.activeInternalTasks.map((task) => <article className={styles.activityRow} key={task.id}><div className={styles.activityTime}><strong>{formatTime(task.occurredAt, timezone)}</strong><span>준비</span></div><div className={`${styles.timelineMarker} ${styles.plan}`} aria-hidden="true"><Sparkles /></div><div className={styles.activityBody}><div className={styles.activityTopline}><span className={styles.activityState}>{task.state === 'needs_attention' ? '확인 필요' : '준비 중'}</span><span>소희 작업</span></div><h3>{task.title}</h3><Link className={styles.inlineLink} href={`/app/conversations/${task.conversationThreadId}`}>준비 중인 대화 보기</Link></div></article>) : null}
      {filter !== 'customer' ? groupedVisibleSchedules.map(({ item, dayLabel }) => {
        const attempt = data.attempts[item.id]; const when = formatDate(scheduleActivityAt(item, attempt), item.timezone); const completed = scheduleStatusFilter(item.status) === 'completed'
        const content = <Fragment>{dayLabel ? <div className={styles.dateHeading}><CalendarClock aria-hidden="true" /><h3>{dayLabel}</h3></div> : null}<article className={`${styles.activityRow} ${selectedScheduleId === item.id ? styles.selectedRow : ''}`}><div className={styles.activityTime} title={when.full}><strong>{when.time}</strong><span>{completed ? '완료' : '예정'}</span></div><div className={`${styles.timelineMarker} ${styles[item.status] ?? ''}`} aria-hidden="true"><Send /></div><div className={styles.activityBody}><div className={styles.activityTopline}><span className={styles.activityState}>{scheduleStatus[item.status]}</span><span>{channelLabel(item.channel)}</span></div><h3>{item.title}</h3><p>{item.status === 'published' ? '채널 게시를 완료했어요.' : item.status === 'scheduled' ? '확인한 내용으로 게시할 예정이에요.' : item.status === 'publishing' ? '실제 게시 결과를 기다리고 있어요.' : '안전하게 다시 확인할 차례예요.'}</p><button aria-label={`${item.title} 상세 보기`} aria-pressed={selectedScheduleId === item.id} className={styles.detailButton} data-schedule-detail-trigger={item.id} onClick={() => { void setScheduleQuery({ selected: item.id }) }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); focusNeighbor(item.id, 1) } if (event.key === 'ArrowUp') { event.preventDefault(); focusNeighbor(item.id, -1) } }} type="button">상세 보기</button>{attempt?.status === 'succeeded' ? <div className={styles.executionResult} aria-label="채널 게시 결과"><CheckCircle2 aria-hidden="true" /><div><strong>게시를 완료했어요.</strong><span>{attempt.finished_at ? `${formatDate(attempt.finished_at, item.timezone).full} 완료` : '완료 시각을 확인하고 있어요.'}</span>{attempt.destination_url ? <a href={attempt.destination_url} target="_blank" rel="noreferrer">실제 게시물 보기</a> : null}<Link href={`/app/reports?view=reactions&work=${item.content_id}`}>성과와 고객 반응 보기</Link></div></div> : null}{attempt?.status === 'failed' || attempt?.status === 'unknown' || item.status === 'failed' || item.status === 'unknown' ? <div className={`${styles.executionResult} ${styles.executionFailure}`}><AlertCircle aria-hidden="true" /><div><strong>게시하지 못했어요.</strong><span>확인한 콘텐츠는 그대로 보관되어 있어요.</span></div></div> : null}{(item.status === 'failed' || attempt?.status === 'failed' || attempt?.status === 'unknown') ? <RecoveryCard workspaceId={workspaceId} scheduleId={item.id} scheduleStatus={item.status} canManage={canManage} canRunExactOwnerRecovery={role === 'owner'} channelLabel={channelLabel(item.channel)} versionNumber={item.versionNumber} attempt={attempt ? { id: attempt.id, status: attempt.status, errorCode: attempt.error_code, providerReference: attempt.provider_reference } : null} /> : null}</div></article></Fragment>
        return completed && statusFilter === 'all' ? <Fragment key={item.id}>{item.id === firstCompletedId ? <div className={styles.completedSectionLabel}><CheckCircle2 aria-hidden="true" /><div><h2>소희가 한 일 {dailySummary.completedCount}</h2><p>실제로 마친 시간을 기준으로 기록했어요.</p></div></div> : null}<details className={styles.completedExecution}><summary><span>완료</span><strong>{item.title}</strong><small>{when.time}</small></summary>{content}</details></Fragment> : <Fragment key={item.id}>{content}</Fragment>
      }) : null}
      {filter !== 'customer' ? projection.completedInternalTasks.map((task) => <details className={styles.completedExecution} key={task.id}><summary><span>완료</span><strong>{task.title}</strong><small>{formatTime(task.completedAt ?? task.occurredAt, timezone)}</small></summary><div className={styles.completedTask}><p>소희가 준비 작업을 마쳤어요.</p><Link href={`/app/conversations/${task.conversationThreadId}`}>관련 대화 보기</Link></div></details>) : null}
      {filter !== 'content' ? datedReservations.map((item) => {
        const kakaoItem = kakaoByReservation.get(item.bookingId) ?? (item.conversationId ? kakaoByReservation.get(item.conversationId) : undefined)
        return (
          <article className={styles.activityRow} key={item.conversationId}>
            <div className={styles.activityTime}><strong>{formatTime(item.startsAt!, item.timezone ?? timezone)}</strong><span>고객</span></div>
            <div className={`${styles.timelineMarker} ${styles.customer}`} aria-hidden="true"><MessageSquareText /></div>
            <div className={styles.activityBody}>
              <div className={styles.activityTopline}>
                <div className={styles.activityStateGroup}>
                  <span className={styles.activityState}>고객 예약</span>
                  {kakaoItem ? <KakaoStatusBadge item={kakaoItem} /> : null}
                </div>
                <span>{channelLabel(item.channel)}</span>
              </div>
              <h3>{item.displayLabel}</h3>
              <p>{item.intent ?? '고객 상담 예약'}</p>
              {kakaoLoad === 'error' ? <p className={styles.kakaoErrorNote}>발송 상태를 불러오지 못했어요</p> : null}
              <Link className={styles.inlineLink} href="/app/inbox">예약 대화 확인하기</Link>
            </div>
          </article>
        )
      }) : null}
      {projection.activeInternalTasks.length + projection.completedInternalTasks.length + groupedVisibleSchedules.length + datedReservations.length === 0 ? <div className={styles.emptyState}><strong>이 날짜에는 예정된 일이 없어요.</strong><p>소희와 계획을 세우거나 다른 날짜를 확인해 보세요.</p><Link href={conversationHref({ intent: 'create_schedule', returnTo })}>소희와 일정 잡기</Link></div> : null}
      {decisionCount > 0 ? <details className={styles.decisionQueue}><summary><Clock3 aria-hidden="true" /><span>{data.plans.length > 0 ? `시간을 정할 콘텐츠 ${data.plans.length}개` : `확인이 필요한 결정 ${decisionCount}개`}</span><small>오늘 일정과 분리해 두었어요.</small></summary><div className={styles.decisionQueueBody}>{data.localPublishes.map((entry) => <PublishStatusCard canManage={canManage} entry={entry} key={entry.id} workspaceId={workspaceId} />)}{data.ready.map((item) => <section className={styles.readyCard} key={item.approvalId}><span>내용 확인 완료</span><h3>{item.title}</h3><p>{channelLabel(item.channel)} 콘텐츠의 게시 시간을 정해 주세요.</p>{canManage ? <form action={(form) => schedule(form, item.approvalId, item.versionId)}><label>게시 채널<select name="channelConnectionId" required defaultValue=""><option value="" disabled>채널을 선택하세요</option>{item.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}</select></label><label>게시할 날짜와 시간<input type="datetime-local" name="scheduledLocal" required /></label><button disabled={pending || item.connections.length === 0}>일정 예약</button></form> : <p className={styles.permissionNote}>일정 변경은 소유자와 관리자만 할 수 있어요.</p>}</section>)}{data.plans.slice(0, 3).map((item) => <article className={styles.decisionItem} key={item.contentId}><div><span>{planStatus[item.status] ?? '시간 결정 필요'}</span><h3>{item.title}</h3><p>{channelLabel(item.channel)} 콘텐츠를 대화에서 확인해 주세요.</p></div><Link href={conversationHref({ intent: 'revise_content', contentId: item.contentId, contentVersionId: item.versionId, returnTo })}>대화에서 확인</Link></article>)}{data.plans.length > 3 ? <p className={styles.decisionRemainder}>나머지 {data.plans.length - 3}개는 대화에서 이어서 확인할 수 있어요.</p> : null}{undatedReservations.length > 0 ? <div className={styles.undatedReservations}><strong>시간 연결이 필요한 고객 예약 {undatedReservations.length}건</strong><p>방문 시간이 확인되면 날짜별 일정에 표시할게요.</p><Link href="/app/inbox">예약 대화 확인하기</Link></div> : null}</div></details> : null}
    </section><aside aria-label="선택 일정 상세" className={styles.desktopDetail}>{detailContent}</aside></div>
    <DetailPanel description={selectedSchedule ? `${channelLabel(selectedSchedule.channel)} 일정과 다음 행동을 확인해요.` : undefined} onOpenChange={(open) => { if (!open) void setScheduleQuery({ selected: null }) }} open={selectedSchedule !== null && !desktopDetailMode} restoreFocusFallbackSelector="[data-schedule-detail-trigger]" title={selectedSchedule?.title ?? '일정 상세'}>{selectedSchedule ? detailContent : null}</DetailPanel>
  </div>
}
