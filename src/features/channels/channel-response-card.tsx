'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import type { ChannelInteraction } from './interaction-repository'
import { approveAndSendResponseAction } from './actions/approve-and-send-response'
import styles from './channel-inbox.module.css'

const statusLabels = {
  needs_draft: '응답 초안 필요', draft: '승인 대기', approved: '승인됨', sending: '전송 중',
  sent: '전송 완료', failed: '전송 실패', unknown: '결과 확인 중', cancelled: '취소됨',
} as const

function resultMessage(status: 'sent' | 'failed' | 'unknown') {
  if (status === 'sent') return '승인한 응답을 공식 채널로 전송했습니다.'
  if (status === 'failed') return '응답을 전송하지 못했습니다. 상태를 확인한 뒤 다시 승인해 주세요.'
  return '외부 전송 결과를 확인하고 있습니다. 중복 전송을 막기 위해 다시 누르지 마세요.'
}

export function ChannelResponseCard({ workspaceId, role, interaction }: Readonly<{
  workspaceId: string
  role: WorkspaceRole
  interaction: ChannelInteraction
}>) {
  const router = useRouter()
  const [draft, setDraft] = useState(interaction.responseText ?? '')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const canManage = role === 'owner' || role === 'manager'
  const canSend = canManage
    && interaction.responseJobId !== null
    && interaction.responseStatus !== null
    && ['needs_draft', 'draft', 'approved', 'failed'].includes(interaction.responseStatus)

  function submit() {
    if (!canSend || draft.trim().length === 0 || pending || !interaction.responseJobId) return
    startTransition(async () => {
      setMessage('')
      const result = await approveAndSendResponseAction({
        workspaceId,
        responseJobId: interaction.responseJobId!,
        draftText: draft.trim(),
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMessage(resultMessage(result.data.status))
      router.refresh()
    })
  }

  return <section className={styles.response} aria-label="소희 응답">
    <span>소희 응답</span>
    <strong>{interaction.responseStatus ? statusLabels[interaction.responseStatus] : '응답 작업 준비 전'}</strong>
    {canSend ? <>
      <label className={styles.responseField}>
        소희 응답 문안
        <textarea value={draft} maxLength={2200} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button className={styles.primaryButton} type="button" onClick={submit} disabled={pending || draft.trim().length === 0}>
        {pending ? '전송 중…' : interaction.responseStatus === 'failed' ? '다시 승인하고 전송' : '승인하고 전송'}
      </button>
    </> : <p>{interaction.responseText ?? '승인된 응답 문안이 없습니다.'}</p>}
    {interaction.deliveryStatus ? <small>
      전송 기록: {interaction.deliveryStatus === 'succeeded'
        ? '성공'
        : interaction.deliveryStatus === 'failed'
          ? '실패'
          : interaction.deliveryStatus === 'unknown' ? '결과 확인 중' : '진행 중'}
    </small> : null}
    {message ? <p className={styles.statusMessage} role="status">{message}</p> : null}
  </section>
}
