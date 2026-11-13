'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AppLink as Link } from '@/components/navigation/app-link'
import { ShellScreen, type ShellScreenConfig } from '@/features/mobile-shell'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { approveAndDispatchAction } from '@/features/approvals/actions/approve-and-dispatch'
import { resolveWorkApproveCta } from './work-approve-cta'
import {
  findPlaceholdersInVersion,
  hasInformationRequestPlaceholder,
} from '@/features/content/placeholder-detect'
import { PlaceholderNotice } from '@/features/chat/placeholder-notice'

const CHANNEL_LABEL: Record<ApprovalPreviewSnapshot['channel'], string> = {
  instagram: 'Instagram',
  threads: 'Threads',
  naver_blog: '네이버 블로그',
}

const APPROVAL_LABEL: Record<ApprovalPreviewSnapshot['approval']['status'], string> = {
  unreviewed: '아직 승인 전',
  approved: '승인 기록 있음',
  rejected: '반려됨',
}

export type R2WorkApproveProps = Readonly<{
  workspaceId: string
  contentId: string
  role: string
  /** 조회 결과. 실패는 숨기지 않고 화면이 사유를 말한다. */
  snapshot: ApprovalPreviewSnapshot | null
}>

/**
 * 이 화면이 서버 명령에 넘기는 경계(온리 승인 기록).
 *
 * 승인은 `approve_only` 하나뿐이고, 게시·예약에 필요한 값은 모두 비운다 —
 * 이 화면에서 외부 전송으로 이어지는 입력이 만들어지지 않게 한다.
 * 서버 명령 자체(ANI-1765)는 이 경계 밖에서 처리된다.
 */
export function workApproveSubmitInput(
  workspaceId: string,
  contentId: string,
  snapshot: ApprovalPreviewSnapshot,
): {
  workspaceId: string
  contentId: string
  versionId: string
  fingerprint: string
  mode: 'approve_only'
  channelConnectionId: null
  scheduledLocal: null
  timezone: null
} {
  return {
    workspaceId,
    contentId,
    versionId: snapshot.versionId,
    fingerprint: snapshot.fingerprint,
    mode: 'approve_only',
    channelConnectionId: null,
    scheduledLocal: null,
    timezone: null,
  }
}

/**
 * 승인 완료 후 사용자의 명시적 게시 요청 입력.
 * 승인된 지문·버전·계정 연결을 서버로 전달해 즉시 게시를 요청한다.
 */
export function workPublishSubmitInput(
  workspaceId: string,
  contentId: string,
  snapshot: ApprovalPreviewSnapshot,
): {
  workspaceId: string
  contentId: string
  versionId: string
  fingerprint: string
  mode: 'publish_now'
  channelConnectionId: string | null
  scheduledLocal: null
  timezone: null
} {
  return {
    workspaceId,
    contentId,
    versionId: snapshot.versionId,
    fingerprint: snapshot.fingerprint,
    mode: 'publish_now',
    channelConnectionId: snapshot.account.connectionId,
    scheduledLocal: null,
    timezone: null,
  }
}

type PublishState = 'idle' | 'requesting' | 'published' | 'scheduled' | 'unknown' | 'failed'

/**
 * M07 게시 전 최종 확인 — `/app/work/:id/approve` (플래그 뒤).
 *
 * 기존 승인 계약(`ApprovalPreviewSnapshot` 의 지문·버전·계정 연결·issues)을 그대로 쓴다.
 * 1단계: 원고 및 지문 확인 후 '승인' (mode: approve_only).
 * 2단계: 승인 완료된 메타 채널에 한해 '지금 게시 요청' (mode: publish_now).
 * 네이버 블로그는 수동 원고 복사 경로를 유지한다.
 */
export function R2WorkApprove({ workspaceId, contentId, role, snapshot }: R2WorkApproveProps) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [publishState, setPublishState] = useState<PublishState>('idle')
  const [allowPlaceholders, setAllowPlaceholders] = useState(false)

  // 매장/원고/버전/지문 복합 identity 키를 추적하여 다른 원고·매장 상태 보존 방지
  const scopedKey = [workspaceId, contentId, snapshot?.versionId ?? '', snapshot?.fingerprint ?? ''].join(':')
  const [trackedKey, setTrackedKey] = useState(scopedKey)
  if (scopedKey !== trackedKey) {
    setTrackedKey(scopedKey)
    setApproved(false)
    setPublishState('idle')
    setAllowPlaceholders(false)
    setMessage(null)
  }

  const currentKeyRef = useRef(scopedKey)
  useEffect(() => {
    currentKeyRef.current = scopedKey
  }, [scopedKey])

  const isAlreadyApproved = snapshot?.approval.status === 'approved' && snapshot.approval.fingerprint === snapshot.fingerprint
  const isApproved = isAlreadyApproved || approved

  const placeholders = useMemo(() => findPlaceholdersInVersion(snapshot), [snapshot])
  const hasPlaceholders = placeholders.length > 0
  const hasInfoRequest = useMemo(() => hasInformationRequestPlaceholder(placeholders), [placeholders])
  const approvePlaceholderBlocked = hasInfoRequest || (hasPlaceholders && !allowPlaceholders)
  const publishPlaceholderBlocked = hasInfoRequest || hasPlaceholders

  const canApprove = role === 'owner' || role === 'manager'
  const isNaverBlog = snapshot?.channel === 'naver_blog'

  const effectiveSnapshot = useMemo<ApprovalPreviewSnapshot | null>(() => {
    if (!snapshot) return null
    if (isApproved) {
      return {
        ...snapshot,
        approval: {
          id: snapshot.approval.id ?? 'approved_record',
          status: 'approved' as const,
          fingerprint: snapshot.fingerprint,
        },
      }
    }
    return snapshot
  }, [snapshot, isApproved])

  const cta = useMemo(
    () =>
      resolveWorkApproveCta(
        effectiveSnapshot
          ? {
              state: 'ready',
              snapshot: effectiveSnapshot,
              canApprove,
              hasPlaceholders,
              hasInfoRequest,
            }
          : { state: 'error' },
      ),
    [effectiveSnapshot, canApprove, hasPlaceholders, hasInfoRequest],
  )

  const isPublishAction = cta.action === 'publish'
  const locked = isPublishAction ? publishState !== 'idle' || pending : approved || pending

  const config = useMemo<ShellScreenConfig>(() => {
    if (isPublishAction) {
      const isPublished = publishState === 'published'
      const isScheduled = publishState === 'scheduled'
      const isUnknown = publishState === 'unknown'
      const isFailed = publishState === 'failed'
      const isRequesting = publishState === 'requesting' || pending

      return {
        mode: 'REVIEW',
        title: '게시 전 최종 확인',
        backHref: `/app/work/${encodeURIComponent(contentId)}`,
        cta: {
          label: isPublished
            ? '게시 요청 접수됨'
            : isScheduled
              ? '게시 대기 중'
              : isUnknown
                ? '게시 상태 확인 필요'
                : isFailed
                  ? '게시 실패'
                  : isRequesting
                    ? '게시 요청 중…'
                    : cta.label,
          disabled: locked || cta.disabled || publishPlaceholderBlocked,
          disabledReason: isPublished
            ? '게시 요청이 접수되었어요. 공식 채널에서 게시 확인 중이에요.'
            : isScheduled
              ? '게시 요청이 접수되어 처리 대기 중이에요.'
              : isUnknown
                ? '결과 확인이 필요해요. 중복 게시를 방지하기 위해 작업 상세에서 확인해 주세요.'
                : isFailed
                  ? '게시 요청 처리에 실패했어요. 작업 상세에서 원인을 확인해 주세요.'
                  : isRequesting
                    ? '서버에 게시 요청을 전달하고 있어요.'
                    : publishPlaceholderBlocked
                      ? hasInfoRequest
                        ? '소희의 정보 요청이 포함된 원고는 실제 게시할 수 없어요. 이벤트 정보를 입력하고 다시 생성해 주세요.'
                        : '채워지지 않은 빈칸이 있어 실제 게시할 수 없어요. 내용을 먼저 완성해 주세요.'
                      : cta.reason,
          onPress: () => {
            if (!snapshot || locked || cta.disabled || publishPlaceholderBlocked) return
            const submitKey = scopedKey
            startTransition(async () => {
              setMessage(null)
              setPublishState('requesting')
              try {
                const result = await approveAndDispatchAction(workPublishSubmitInput(workspaceId, contentId, snapshot))
                if (currentKeyRef.current !== submitKey) return
                if (result.error) {
                  setPublishState('failed')
                  setMessage('게시 요청을 완료하지 못했어요. 작업 상세에서 원인을 확인해 주세요.')
                  return
                }

                const next = result.data?.next
                if (next === 'published' && Boolean(result.data?.providerPostId)) {
                  setPublishState('published')
                  setMessage('게시 요청이 접수되었어요. 공식 채널에서 게시 확인 중이에요.')
                } else if (next === 'scheduled') {
                  setPublishState('scheduled')
                  setMessage('게시 요청이 서버에 접수되어 처리 대기 중이에요. 일정 화면에서 예약 상태를 확인해 주세요.')
                } else if (next === 'failed') {
                  setPublishState('failed')
                  setMessage('게시 요청을 완료하지 못했어요. 작업 상세에서 원인을 확인해 주세요.')
                } else {
                  // unknown, uncertain, or published without providerPostId
                  setPublishState('unknown')
                  setMessage('게시 요청 결과를 명확히 확인하지 못했어요. 중복 게시를 방지하기 위해 다시 누르지 말고 작업 상세에서 상태를 확인해 주세요.')
                }
              } catch {
                if (currentKeyRef.current !== submitKey) return
                // transport throw: DO NOT assume un-transmitted!
                setPublishState('unknown')
                setMessage('통신 오류로 게시 요청 결과를 확인하지 못했어요. 중복 전송을 막기 위해 작업 상세에서 실제 게시 여부를 확인해 주세요.')
              }
            })
          },
        },
      }
    }

    return {
      mode: 'REVIEW',
      title: isNaverBlog ? '게시 준비 승인' : '게시 전 최종 확인',
      backHref: `/app/work/${encodeURIComponent(contentId)}`,
      cta: {
        label: approved
          ? '승인 기록됨'
          : pending
            ? '기록하는 중'
            : isNaverBlog && (cta.label === '승인' || !cta.disabled)
              ? '이 원고로 게시 준비 승인'
              : cta.label,
        disabled: locked || cta.disabled || approvePlaceholderBlocked,
        disabledReason: approved
          ? isNaverBlog
            ? '승인이 기록됐어요. 이제 복사·사진 저장 후 네이버에서 직접 게시해 주세요.'
            : '승인이 기록됐어요. 대상 계정과 게시물을 최종 확인한 뒤 지금 게시를 요청할 수 있어요.'
          : pending
            ? '승인을 기록하고 있어요.'
            : approvePlaceholderBlocked
              ? hasInfoRequest
                ? '고객에게 보여줄 글이 아니라 소희의 정보 요청이에요. 이벤트 정보를 알려주고 다시 만들어 주세요.'
                : '채워지지 않은 빈칸이 있어요. 빈칸이 있어도 승인하려면 아래 확인을 체크해 주세요.'
              : cta.reason,
        onPress: () => {
          if (!snapshot || locked || cta.disabled || approvePlaceholderBlocked) return
          const submitKey = scopedKey
          startTransition(async () => {
            setMessage(null)
            try {
              const result = await approveAndDispatchAction(workApproveSubmitInput(workspaceId, contentId, snapshot))
              if (currentKeyRef.current !== submitKey) return
              if (result.error) {
                setMessage(`${result.error.message} 승인된 것은 없어요.`)
                return
              }
              setApproved(true)
              setMessage(
                isNaverBlog
                  ? '승인이 기록됐어요. 이제 복사·사진 저장 후 네이버에서 직접 게시해 주세요.'
                  : '승인이 기록됐어요. 대상 계정과 게시물을 최종 확인한 뒤 지금 게시를 요청할 수 있어요.',
              )
            } catch {
              if (currentKeyRef.current !== submitKey) return
              setMessage('통신 오류로 승인 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
            }
          })
        },
      },
    }
  }, [
    isPublishAction,
    publishState,
    pending,
    cta,
    locked,
    publishPlaceholderBlocked,
    hasInfoRequest,
    isNaverBlog,
    approved,
    approvePlaceholderBlocked,
    contentId,
    snapshot,
    workspaceId,
    scopedKey,
  ])

  const bodyLabel = isNaverBlog ? '준비된 원고' : '게시할 내용'

  return (
    <>
      <ShellScreen {...config} />
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-6 text-foreground">
        {!snapshot ? (
          <section className="space-y-3 pt-1">
            <h1 className="text-2xl font-semibold tracking-tight">게시 전 최종 확인</h1>
            <p role="status" className="text-base leading-relaxed text-muted-foreground">
              확인 항목을 불러오지 못했어요.
            </p>
          </section>
        ) : (
          <>
            <header className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {CHANNEL_LABEL[snapshot.channel]}
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                  {isApproved ? '승인 기록 있음' : APPROVAL_LABEL[snapshot.approval.status]}
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                  {snapshot.versionNumber}번째 버전
                </span>
              </div>
              <h1 className="break-words break-keep text-2xl font-semibold leading-snug tracking-tight">
                {isNaverBlog ? '게시 준비 승인' : '게시 전 최종 확인'}
              </h1>
              <p className="text-base text-muted-foreground">
                {snapshot.account.label || '게시 대상 계정 확인 필요'}
              </p>
            </header>

            {hasPlaceholders ? (
              <div className="space-y-3">
                <PlaceholderNotice placeholders={placeholders} />
                {!hasInfoRequest && !isApproved ? (
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm text-foreground select-none">
                    <input
                      type="checkbox"
                      checked={allowPlaceholders}
                      onChange={(e) => setAllowPlaceholders(e.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    <span>빈칸이 있어도 이대로 승인할게요</span>
                  </label>
                ) : null}
              </div>
            ) : null}

            {snapshot.media && snapshot.media.length > 0 ? (
              <section aria-label="게시할 이미지" className="space-y-2">
                <h2 className="text-lg font-semibold">게시할 이미지 ({snapshot.media.length}장)</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {snapshot.media.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.src}
                        alt={item.altText || `게시 이미지 ${idx + 1}`}
                        className="size-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
                        {item.position || idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section aria-label={bodyLabel} className="space-y-2">
              <h2 className="text-lg font-semibold">{bodyLabel}</h2>
              <div className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-card p-5 text-base leading-7">
                {snapshot.text || '내용을 아직 확인하지 못했어요.'}
              </div>
            </section>

            <section aria-label="확인 결과" className="space-y-2">
              <h2 className="text-lg font-semibold">확인 결과</h2>
              {snapshot.issues.length ? (
                <ul className="space-y-2 rounded-2xl border border-border p-5 text-sm leading-relaxed text-muted-foreground">
                  {snapshot.issues.map((issue) => (
                    <li key={issue.code}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-2xl bg-muted/50 p-5 text-sm leading-relaxed text-muted-foreground">
                  {isApproved
                    ? isNaverBlog
                      ? '승인이 완료된 원고입니다. 아래 원고 복사 버튼을 눌러 네이버 블로그에 직접 게시해 주세요.'
                      : publishPlaceholderBlocked
                        ? '승인 기록은 있지만 아직 완성하지 않은 내용이 있어요. 원고를 완성한 뒤 게시를 요청해 주세요.'
                        : cta.disabled
                          ? cta.reason
                          : '대상 계정과 내용·이미지가 승인되었습니다. 지금 게시 요청 버튼을 눌러 실제 게시를 요청할 수 있어요.'
                    : '대상 계정과 내용이 확인됐어요. 승인해도 바로 게시되지는 않아요.'}
                </p>
              )}
            </section>

            {(isApproved && isNaverBlog) || message || publishState !== 'idle' ? (
              <div className="space-y-3">
                {message ? (
                  <p role="status" className="text-sm leading-relaxed text-muted-foreground">{message}</p>
                ) : null}
                {isApproved && isNaverBlog ? (
                  <Link
                    href={`/app/work/${encodeURIComponent(contentId)}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50"
                  >
                    원고 복사하러 가기
                  </Link>
                ) : null}
                {publishState !== 'idle' ? (
                  <Link
                    href={`/app/work/${encodeURIComponent(contentId)}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50"
                  >
                    작업 상세로 돌아가기
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
