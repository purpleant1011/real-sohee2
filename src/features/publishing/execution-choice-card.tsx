'use client'

import { CalendarClock, Loader2, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from '@/components/status/status-badge'
import styles from './execution-choice-card.module.css'

type ExecutionChoiceCardProps = Readonly<{
  accountLabel: string
  channel: 'instagram' | 'threads' | 'naver_blog'
  mediaCount: number
  onPublishNow: () => void
  onSchedule: (scheduledLocal: string) => void
  pending: boolean
  versionNumber: number
  ready?: boolean
  canPublish?: boolean
  approved?: boolean
  placeholderBlocked?: boolean
  executionUncertain?: boolean
}>

function channelLabel(channel: ExecutionChoiceCardProps['channel']) {
  if (channel === 'instagram') return 'Instagram'
  if (channel === 'threads') return 'Threads'
  return '네이버 블로그'
}

export function ExecutionChoiceCard({
  accountLabel,
  channel,
  mediaCount,
  onPublishNow,
  onSchedule,
  pending,
  versionNumber,
  ready = true,
  canPublish = true,
  approved = true,
  placeholderBlocked = false,
  executionUncertain = false,
}: ExecutionChoiceCardProps) {
  const [choice, setChoice] = useState<'publish_now' | 'schedule' | null>(null)
  const [publishConfirmed, setPublishConfirmed] = useState(false)
  const [scheduledLocal, setScheduledLocal] = useState('')

  const isNotReady =
    !ready ||
    !canPublish ||
    !approved ||
    placeholderBlocked ||
    executionUncertain

  return (
    <section aria-label="승인 후 실행 선택" className={styles.card}>
      <header className={styles.header}>
        <div>
          <StatusBadge label={`v${versionNumber} 승인됨`} tone="success" />
          <h3>이제 실행 방식을 선택해요</h3>
          <p>승인된 정확한 버전은 바꾸지 않고 선택한 계정으로 전달해요.</p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </header>

      <dl className={styles.facts}>
        <div><dt>채널</dt><dd>{channelLabel(channel)}</dd></div>
        <div><dt>계정</dt><dd>{accountLabel}</dd></div>
        <div><dt>버전</dt><dd>v{versionNumber}</dd></div>
        <div><dt>미디어</dt><dd>이미지 {mediaCount}장</dd></div>
      </dl>

      <div className={styles.choices}>
        <button
          aria-label="지금 게시"
          aria-pressed={choice === 'publish_now'}
          onClick={() => { setChoice('publish_now'); setPublishConfirmed(false) }}
          type="button"
        >
          <Send aria-hidden="true" />
          <span><strong>지금 게시</strong><small>확인 뒤 공식 채널에 바로 요청</small></span>
        </button>
        <button
          aria-label="예약 게시"
          aria-pressed={choice === 'schedule'}
          onClick={() => setChoice('schedule')}
          type="button"
        >
          <CalendarClock aria-hidden="true" />
          <span><strong>예약 게시</strong><small>Asia/Seoul 기준 시각 선택</small></span>
        </button>
      </div>

      {choice === 'publish_now' ? (
        <div className={styles.confirmation}>
          <label>
            <input
              checked={publishConfirmed}
              onChange={(event) => setPublishConfirmed(event.target.checked)}
              type="checkbox"
            />
            승인한 v{versionNumber}을 {accountLabel} 계정에 지금 게시합니다
          </label>
          <p>요청 뒤 결과가 불명확하면 자동 재실행하지 않고 공식 채널 상태를 먼저 확인해요.</p>
          <button
            aria-busy={pending}
            className={styles.primary}
            disabled={!publishConfirmed || pending || isNotReady}
            onClick={onPublishNow}
            type="button"
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                <span>게시하는 중…</span>
              </>
            ) : (
              `승인한 v${versionNumber} 지금 게시`
            )}
          </button>
        </div>
      ) : null}

      {choice === 'schedule' ? (
        <div className={styles.confirmation}>
          <label>
            예약 시각 · Asia/Seoul
            <input
              onChange={(event) => setScheduledLocal(event.target.value)}
              type="datetime-local"
              value={scheduledLocal}
            />
          </label>
          <p>예약 시각과 승인 버전을 함께 고정하고 일정에서 같은 상태를 확인할 수 있어요.</p>
          <button
            aria-busy={pending}
            className={styles.primary}
            disabled={scheduledLocal.length === 0 || pending || isNotReady}
            onClick={() => onSchedule(scheduledLocal)}
            type="button"
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                <span>게시하는 중…</span>
              </>
            ) : (
              `승인한 v${versionNumber} 예약 게시`
            )}
          </button>
        </div>
      ) : null}
    </section>
  )
}
