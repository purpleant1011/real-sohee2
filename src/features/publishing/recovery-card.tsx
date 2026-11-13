'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RecoveryActions, type RecoveryAction } from '@/components/cards/recovery-actions'
import { StatusBadge } from '@/components/status/status-badge'
import { runPublishAction } from './actions/run-publish'
import { retryPublishAction } from './actions/retry-publish'
import { reconcilePublishAction } from './actions/reconcile-publish'
import { classifyPublishFailure } from './failure-classifier'
import styles from './recovery-card.module.css'

type Attempt = Readonly<{
  id: string
  status: string
  errorCode: string | null
  providerReference: string | null
}>

function failureMessage(code: string | null) {
  switch (code) {
    case 'TEMPORARY_NETWORK': return '일시적인 연결 문제로 게시하지 못했어요. 같은 게시물을 중복 생성하지 않고 다시 시도할 수 있습니다.'
    case 'RATE_LIMITED': return '채널 처리량 제한으로 게시하지 못했어요. 잠시 후 다시 시도해 주세요.'
    case 'TOKEN_EXPIRED': return '채널 연결이 만료되어 게시하지 못했어요. 채널을 다시 연결해 주세요.'
    case 'APPROVAL_STALE': return '승인한 버전이 현재 버전과 달라 게시하지 않았어요. 최신 버전을 다시 검토해 주세요.'
    case 'LEASE_EXPIRED': return '외부 결과를 확정할 수 없어 자동 재시도를 멈췄어요. 중복 게시 여부를 확인해 주세요.'
    case 'RESULT_UNKNOWN': return '공식 채널의 최종 응답을 받지 못해 자동 재시도를 멈췄어요. 중복 게시 여부를 확인해 주세요.'
    default: return '공식 채널이 게시를 거절했어요. 최근 기록을 확인해 주세요.'
  }
}

function outcomeMessage(status: 'publishing' | 'published' | 'failed' | 'unknown', errorCode: string | null) {
  if (status === 'published') return '공식 채널 게시를 완료하고 결과를 기록했습니다.'
  if (status === 'publishing') return '공식 채널에서 처리 중입니다. 잠시 후 결과를 확인해 주세요.'
  if (status === 'unknown') return '외부 게시 결과를 확정할 수 없어 자동 재시도를 멈췄어요. 채널에서 중복 게시 여부를 확인해 주세요.'
  return failureMessage(errorCode)
}

const FINAL_INSTAGRAM_ATTEMPT_ID = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'

export function RecoveryCard({ workspaceId, scheduleId, scheduleStatus, attempt, canManage, canRunExactOwnerRecovery = false, channelLabel = '채널', creditSummary, versionNumber }: Readonly<{
  workspaceId: string
  scheduleId: string
  scheduleStatus: string
  attempt: Attempt | null
  canManage: boolean
  canRunExactOwnerRecovery?: boolean
  channelLabel?: string
  creditSummary?: Readonly<{ used: number; returned: number }>
  versionNumber?: number | null
}>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const classification = attempt?.status === 'failed' ? classifyPublishFailure(attempt.errorCode) : null
  const isExactOwnerRecovery = scheduleStatus === 'failed'
    && attempt?.id === FINAL_INSTAGRAM_ATTEMPT_ID
    && attempt.status === 'failed'
    && attempt.errorCode === 'PROVIDER_REJECTED'
    && canRunExactOwnerRecovery

  function run() {
    startTransition(async () => {
      const result = await runPublishAction({ workspaceId, scheduleId })
      setMessage(result.error ? result.error.message : outcomeMessage(result.data.status, result.data.errorCode))
      router.refresh()
    })
  }

  function retry() {
    if (!attempt) return
    startTransition(async () => {
      const result = await retryPublishAction({ workspaceId, failedAttemptId: attempt.id })
      setMessage(result.error ? result.error.message : outcomeMessage(result.data.status, result.data.errorCode))
      router.refresh()
    })
  }

  function reconcile() {
    if (!attempt) return
    startTransition(async () => {
      const result = await reconcilePublishAction({ workspaceId, attemptId: attempt.id })
      setMessage(result.error ? result.error.message : result.data.message)
      router.refresh()
    })
  }

  const preserved = versionNumber ? `${channelLabel}에서 확인한 콘텐츠는 보관됐어요.` : '확인한 콘텐츠와 작업 기록은 보관됐어요.'
  const credit = creditSummary ? `외부 실행 ${creditSummary.used} 사용 · ${creditSummary.returned} 반환` : undefined
  const recoveryActions: RecoveryAction[] = []
  if (attempt && isExactOwnerRecovery) recoveryActions.push({ id: 'exact-retry', label: '인스타그램 다시 게시', onSelect: retry, emphasis: 'primary', disabled: pending })
  else if (attempt && classification?.retryable && canManage) recoveryActions.push({ id: 'retry', label: '다시 시도', onSelect: retry, emphasis: 'primary', disabled: pending })
  else if (attempt && (scheduleStatus === 'unknown' || attempt.status === 'unknown') && canManage) recoveryActions.push({ id: 'reconcile', label: '공식 채널 결과 다시 확인', onSelect: reconcile, emphasis: 'primary', disabled: pending })

  return <section className={styles.editorSection} aria-label="게시 상태와 다음 행동">
    <div className={styles.versionHeading}>
      <h2>게시 상태와 다음 행동</h2>
      <StatusBadge label="공식 채널 전송" tone={scheduleStatus === 'published' ? 'success' : scheduleStatus === 'unknown' ? 'unknown' : scheduleStatus === 'failed' ? 'failure' : 'active'} />
    </div>
    {scheduleStatus === 'scheduled' && canManage
      ? <button className={styles.formButton} type="button" disabled={pending} onClick={run}>지금 게시</button>
      : null}
    {scheduleStatus === 'publishing' || attempt?.status === 'pending'
      ? <p className={styles.formMessage}>공식 채널에서 처리 중입니다. 잠시 후 상태를 다시 확인해 주세요.</p>
      : null}
    {scheduleStatus === 'published' && attempt?.status === 'succeeded'
      ? <p className={styles.formMessage}>공식 채널 게시를 완료하고 결과를 기록했습니다.</p>
      : null}
    {scheduleStatus === 'unknown' || attempt?.status === 'unknown'
      ? <RecoveryActions
        actions={recoveryActions}
        creditSummary={credit}
        description={failureMessage(attempt?.errorCode ?? 'RESULT_UNKNOWN')}
        preserved={preserved}
        state="unknown"
        title="게시 결과를 아직 확인하지 못했어요"
      />
      : null}
    {attempt?.status === 'failed'
      ? <div>
        <RecoveryActions
          actions={recoveryActions}
          creditSummary={credit}
          description={failureMessage(attempt.errorCode)}
          preserved={preserved}
          state="failure"
          title="게시하지 못했어요"
        />
        {classification?.action === '채널 다시 연결'
            ? <Link className={styles.secondaryLink} href="/app/settings/channels">채널 다시 연결</Link>
            : classification?.action === '다시 승인'
              ? <Link className={styles.secondaryLink} href="/app/work">최신 내용 다시 확인</Link>
              : !classification?.retryable && !isExactOwnerRecovery
                ? <span className={styles.muted}>다음 행동: 외부 채널 결과 확인</span>
                : null}
      </div>
      : null}
    {message ? <p role="status" className={styles.formMessage}>{message}</p> : null}
  </section>
}
