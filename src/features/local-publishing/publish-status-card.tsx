'use client'

import { useState, useTransition } from 'react'

import { reconfirmLocalPublishAction } from './actions/reconfirm-local-publish'
import { retryLocalPublishBeforeSubmitAction } from './actions/retry-local-publish-before-submit'
import { NAVER_VISIBILITY_LABELS, type NaverVisibility } from '@/features/naver-publish/types'
import { parseNaverBlogPostUrl } from '@/features/naver-publish/blog-url'
import styles from './publish-status-card.module.css'

export type LocalExecutionViewState =
  | 'device_waiting'
  | 'running'
  | 'reconfirmation_required'
  | 'unknown_after_submit'
  | 'succeeded'
  | 'failed_before_submit'

export type LocalPublishStatusEntry = Readonly<{
  id: string
  status: LocalExecutionViewState
  channel: 'naver_blog' | 'daangn_business'
  targetLabel: string
  contentVersionId: string
  scheduledAt: string | null
  autoExecuteUntil: string | null
  failureCode: string | null
  visibility?: NaverVisibility
  resultUrl?: string | null
  phaseText?: string | null
  phase?: string | null
}>

export const LOCAL_PUBLISH_PHASE_LABELS: Readonly<Record<string, string>> = {
  claimed: '기기 확인',
  device_waiting: '기기 확인',
  account_verified: '네이버 접속',
  editor_ready: '글 입력',
  content_filled: '글 입력',
  preflight_verified: '글 입력',
  submitted: '게시',
  result_observed: '확인',
  succeeded: '확인',
}

export const NAVER_POLICY_STOPPED_LABEL = '정책으로 중단됨 — 네이버에는 자동으로 올리지 않아요. 원고는 보관돼 있으니 복사해서 직접 올려 주세요.'

const stateCopy: Readonly<Record<LocalExecutionViewState, Readonly<{ title: string; description: string }>>> = {
  device_waiting: { title: '연결된 크롬을 기다리고 있어요', description: '승인한 게시물은 연결된 기기가 준비되면 실행돼요.' },
  running: { title: '승인한 게시물을 작성하고 있어요', description: '게시 전에 내용과 채널 상태를 마지막으로 확인하고 있어요.' },
  reconfirmation_required: { title: '예약 시간이 30분 넘게 지났어요', description: '예약 시간이 지나 자동 게시를 멈췄어요. 대상과 내용을 다시 확인해 주세요.' },
  unknown_after_submit: { title: '게시 결과 확인 중', description: '다시 게시하지 않고 공식 채널의 결과를 확인하고 있어요.' },
  succeeded: { title: '게시 결과를 확인했어요', description: '확인된 외부 게시 주소가 실행 기록에 저장되었습니다.' },
  failed_before_submit: { title: '게시 전에 멈췄어요', description: '외부 채널에 보내기 전에 멈췄어요. 내용을 확인해 주세요.' },
}

function formatDateTime(value: string | null) {
  if (!value) return '즉시 게시'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value))
}

export function PublishStatusCard({ entry, workspaceId, canManage }: Readonly<{
  entry: LocalPublishStatusEntry
  workspaceId: string
  canManage: boolean
}>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const copy = stateCopy[entry.status]
  const isNaverPending = entry.channel === 'naver_blog' && (
    entry.status === 'device_waiting' ||
    entry.status === 'running' ||
    entry.status === 'unknown_after_submit' ||
    entry.status === 'reconfirmation_required'
  )
  const failureMessage = entry.status === 'failed_before_submit'
    ? entry.failureCode === 'CATEGORY_NOT_FOUND'
      ? '선택한 카테고리를 네이버에서 찾지 못했어요. 카테고리 목록을 새로 가져와 주세요.'
      : entry.failureCode === 'REAUTH_REQUIRED'
        ? '네이버 로그인이 필요해요. 크롬에서 네이버에 로그인한 뒤 다시 시도해 주세요.'
        : entry.failureCode === 'DRAFT_RECOVERY_PENDING'
          ? '네이버 글쓰기 화면에 작성 중인 글이 있어요. 그 글을 저장하거나 지운 뒤 다시 시도해 주세요.'
          : null
    : null

  function reconfirm() {
    startTransition(async () => {
      const result = await reconfirmLocalPublishAction({ workspaceId, actionId: entry.id })
      setMessage(result.error?.message ?? '게시 실행을 다시 확인했습니다.')
    })
  }

  function retryBeforeSubmit() {
    startTransition(async () => {
      const result = await retryLocalPublishBeforeSubmitAction({ workspaceId, actionId: entry.id })
      setMessage(result.error?.message ?? '외부 채널에 보내지 않은 게시를 다시 실행합니다.')
    })
  }

  return <section aria-label={`${entry.targetLabel} 로컬 게시 상태`} className={styles.card}>
    <header className={styles.header}><strong>{isNaverPending ? NAVER_POLICY_STOPPED_LABEL : copy.title}</strong><p>{failureMessage ?? copy.description}</p></header>
    <dl className={styles.facts}>
      <div><dt>대상 계정</dt><dd>{entry.targetLabel}</dd></div>
      <div><dt>게시 예정</dt><dd>{formatDateTime(entry.scheduledAt)}</dd></div>
      <div><dt>공개 범위</dt><dd>{entry.visibility ? NAVER_VISIBILITY_LABELS[entry.visibility] : '비공개'}</dd></div>
      {entry.status === 'succeeded' && entry.resultUrl && parseNaverBlogPostUrl(entry.resultUrl) ? (() => {
        const parsed = parseNaverBlogPostUrl(entry.resultUrl!)!
        return (
          <div>
            <dt>게시 결과</dt>
            <dd>
              <a href={`https://blog.naver.com/${parsed.blogId}/${parsed.logNo}`} target="_blank" rel="noopener noreferrer">
                글 보기
              </a>
            </dd>
          </div>
        )
      })() : null}
      {(entry.phaseText || (entry.phase && LOCAL_PUBLISH_PHASE_LABELS[entry.phase])) ? (
        <div>
          <dt>진행 단계</dt>
          <dd>{entry.phaseText ?? (entry.phase ? LOCAL_PUBLISH_PHASE_LABELS[entry.phase] : '')}</dd>
        </div>
      ) : null}
    </dl>
    {entry.status === 'reconfirmation_required' && canManage
      ? <button className={styles.action} type="button" disabled={pending} onClick={reconfirm}>게시 내용 다시 확인</button>
      : null}
    {entry.status === 'failed_before_submit' && entry.channel === 'naver_blog'
      && (entry.failureCode === 'UI_DRIFT' || entry.failureCode === 'CONTENT_MISMATCH'
        || entry.failureCode === 'DEVICE_OFFLINE') && canManage
      ? <button className={styles.action} type="button" disabled={pending} onClick={retryBeforeSubmit}>문제를 확인하고 다시 실행</button>
      : null}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
  </section>
}
