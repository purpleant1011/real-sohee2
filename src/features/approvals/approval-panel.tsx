'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { NAVER_VISIBILITY_LABELS } from '@/features/naver-publish/types'
import styles from '@/features/content/content.module.css'
import { ChannelPreviewCard } from './channel-preview-card'
import { approveAndDispatchAction } from './actions/approve-and-dispatch'

export function ApprovalPanel({ role, preview }: Readonly<{
  role: WorkspaceRole
  preview: ApprovalPreviewSnapshot
}>) {
  const router = useRouter()
  const canPublish = role === 'owner' || role === 'manager'
  const [scheduledLocal, setScheduledLocal] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [mediaReady, setMediaReady] = useState(preview.media.length === 0)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const serverReady = preview.issues.length === 0 && preview.account.status === 'connected'
  const alreadyApproved = preview.approval.status === 'approved'
  const ready = serverReady && mediaReady && !pending
  const scheduleReady = ready && scheduledLocal.length > 0

  const visibilityLabel = preview.visibility === 'public' ? '공개'
    : preview.visibility ? NAVER_VISIBILITY_LABELS[preview.visibility] : '비공개'
  const primaryLabel = !canPublish
    ? '승인'
    : alreadyApproved
      ? `${preview.channel === 'naver_blog' ? `${visibilityLabel} ` : ''}바로 게시`
      : `${preview.channel === 'naver_blog' ? `${visibilityLabel} ` : ''}승인하고 바로 게시`

  const channelLabel = preview.channel === 'instagram'
    ? 'Instagram'
    : preview.channel === 'threads' ? 'Threads' : '네이버 블로그'

  function resultMessage(next: 'approved' | 'scheduled' | 'published' | 'failed' | 'unknown') {
    if (next === 'approved') return '승인이 기록됐어요. 소유자 또는 관리자가 게시할 수 있어요.'
    if (next === 'scheduled') return '예약이 기록됐어요.'
    if (next === 'published') return '게시가 완료됐어요.'
    if (next === 'failed') return '게시하지 못했어요. 안전하게 다시 게시할 수 있는 상태를 확인해 주세요.'
    return '게시 요청 결과를 확인하고 있어요. 중복 게시를 막기 위해 다시 누르지 마세요.'
  }

  function submit(actionMode: 'approve_only' | 'publish_now' | 'schedule') {
    if (!ready || (actionMode === 'schedule' && scheduledLocal.length === 0)) return
    startTransition(async () => {
      setMessage('')
      const result = await approveAndDispatchAction({
        workspaceId: preview.workspaceId,
        contentId: preview.contentId,
        versionId: preview.versionId,
        fingerprint: preview.fingerprint,
        mode: actionMode,
        channelConnectionId: canPublish ? preview.account.connectionId : null,
        scheduledLocal: actionMode === 'schedule' ? scheduledLocal : null,
        timezone: actionMode === 'schedule' ? 'Asia/Seoul' : null,
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMessage(resultMessage(result.data.next))
      router.refresh()
    })
  }

  return <section className={styles.editorSection} aria-labelledby="approval-title">
    <div className={styles.versionHeading}>
      <div>
        <p className={styles.eyebrow}>{preview.channel === 'naver_blog' ? 'NAVER BLOG' : preview.channel.toUpperCase()} · EXACT VERSION</p>
        <h2 id="approval-title">게시 전 최종 확인</h2>
      </div>
      <span className={styles.versionBadge}>v{preview.versionNumber}</span>
    </div>
    <p className={styles.pageIntro}>
      {channelLabel}에 전송될 v{preview.versionNumber} 문구와 미디어{preview.channel === 'naver_blog' ? `, ${visibilityLabel} 범위` : ''}를 보고 있어요.
    </p>

    <ChannelPreviewCard preview={preview} onMediaReadinessChange={setMediaReady} />

    {preview.issues.length > 0 ? <div className={styles.emptyState} aria-label="게시 준비 문제">
      {preview.issues.map((issue) => <p key={issue.code} className={styles.formMessage}>{issue.message}</p>)}
      {preview.issues.some((issue) => issue.recoveryHref === '/app/settings/channels')
        ? <Link className={styles.secondaryLink} href="/app/settings/channels">채널 다시 연결</Link>
        : null}
    </div> : null}

    {!mediaReady && preview.media.length > 0 ? <p className={styles.formMessage} role="status">
      모든 이미지를 넘겨 실제 순서와 표시를 확인하면 승인할 수 있어요.
    </p> : null}
    {message ? <p className={styles.formMessage} role="status">{message}</p> : null}

    <div className={styles.formActions}>
      <button className={styles.formButton} type="button" onClick={() => submit(canPublish ? 'publish_now' : 'approve_only')} disabled={!ready}>
        {pending ? '처리 중…' : primaryLabel}
      </button>
      <Link className={styles.secondaryLink} href={`/app/work/${preview.contentId}/edit`}>
        수정하면 v{preview.versionNumber + 1}이 생기고 다시 승인해야 해요
      </Link>
    </div>

    {canPublish ? <div className={styles.scheduleDisclosure}>
      <details open={scheduleOpen}>
        <summary onClick={(event) => { event.preventDefault(); setScheduleOpen((open) => !open) }}>예약 게시 설정</summary>
      </details>
      {scheduleOpen ? <form className={styles.dispatchOptions} onSubmit={(event) => { event.preventDefault(); submit('schedule') }}>
        <p className={styles.pageIntro}>선택한 시각에 지금 확인한 정확한 버전을 게시합니다.</p>
        <label className={styles.field}>
          예약 시각 · Asia/Seoul
          <input type="datetime-local" value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} />
        </label>
        <button className={styles.mockButton} type="submit" disabled={!scheduleReady}>
          {alreadyApproved ? '예약' : '승인하고 예약'}
        </button>
      </form> : null}
    </div> : null}
  </section>
}
