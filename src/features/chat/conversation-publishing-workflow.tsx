'use client'

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileText,
  GalleryHorizontalEnd,
  Hash,
  Loader2,
  MessagesSquare,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { approveAndDispatchAction } from '@/features/approvals/actions/approve-and-dispatch'
import { ChannelPreviewCard } from '@/features/approvals/channel-preview-card'
import type { MediaReadinessStatus } from '@/features/approvals/channel-preview-card'
import { DetailPanel } from '@/components/layout/detail-panel'
import { StatusBadge } from '@/components/status/status-badge'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { NAVER_VISIBILITY_LABELS } from '@/features/naver-publish/types'
import {
  loadConversationPublishingAction,
  type ConversationPublishingState,
  type ConversationPublishReceipt,
} from './actions/load-conversation-publishing'
import { partialContentRevisionAction } from './actions/partial-content-revision'
import { naverMetaRevisionAction } from './actions/naver-meta-revision'
import { NAVER_BLOCK_SELECT_EVENT, type NaverBlockSelectDetail } from './naver-block-select-event'
import { restoreNaverVersionAction } from './actions/restore-naver-version'
import { publishWriteKey } from '@/features/pwa/external-write'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { NAVER_REVISION_UNAVAILABLE } from '@/features/content/naver-revision-readiness'
import {
  findPlaceholdersInVersion,
  hasInformationRequestPlaceholder,
} from '@/features/content/placeholder-detect'
import { PlaceholderNotice } from './placeholder-notice'
import { PostPublishCarePanel } from './post-publish-care-panel'
import { OverlayComposer } from '@/features/image-style/overlay/overlay-composer'
import type { WorkspaceStyleSummary } from '@/features/image-style/style-summary'
import { loadWorkspaceStyleSummaryAction } from '@/features/image-style/actions/load-style-summary'
import styles from './channel-result-card.module.css'

type EditScope = 'caption' | 'hashtags' | 'image_add' | 'image_replace' | 'media_reorder' | 'media_limit' | 'disclosure_repair' | 'naver_block'

const channelRuleCodes = new Set(['instagram_media', 'instagram_text', 'threads_media', 'threads_text'])
const mediaIntegrityCodes = new Set(['media_order', 'media_rights', 'media_alt_text', 'evidence'])

function resultMessage(next: 'approved' | 'scheduled' | 'published' | 'failed' | 'unknown', versionNumber: number) {
  if (next === 'approved') return `v${versionNumber} 승인이 기록됐어요. 게시 방식은 별도로 선택해 주세요.`
  if (next === 'scheduled') return `v${versionNumber} 예약 게시가 기록됐어요.`
  if (next === 'published') return `v${versionNumber} 채널 게시를 확인했어요.`
  if (next === 'failed') return '게시하지 못했어요. 실패 기록을 보존했으며 안전한 재시도 상태를 확인해 주세요.'
  return '게시 결과를 확인하고 있어요. 중복 게시를 막기 위해 다시 실행하지 마세요.'
}

function channelLabel(preview: ApprovalPreviewSnapshot) {
  if (preview.channel === 'instagram') return 'Instagram'
  if (preview.channel === 'threads') return 'Threads'
  if (preview.channel === 'naver_blog') return '네이버 블로그'
  return preview.channel
}

function channelIcon(channel: ApprovalPreviewSnapshot['channel']) {
  if (channel === 'threads') {
    return <MessagesSquare aria-hidden="true" className={styles.channelIcon} />
  }
  if (channel === 'instagram') {
    return <GalleryHorizontalEnd aria-hidden="true" className={styles.channelIcon} />
  }
  return <FileText aria-hidden="true" className={styles.channelIcon} />
}

export type ConversationReviewContext = Readonly<{
  evidence: readonly string[]
  limitations: readonly string[]
  unresolvedQuestions: readonly string[]
}>

const emptyReviewContext: ConversationReviewContext = Object.freeze({
  evidence: Object.freeze([]),
  limitations: Object.freeze([]),
  unresolvedQuestions: Object.freeze([]),
})

function mediaLabel(count: number) {
  return `이미지 ${count}장`
}

function formatReceiptDate(publishAt?: string | null): string {
  if (!publishAt) return ''
  const d = new Date(publishAt)
  if (isNaN(d.getTime())) return ''
  try {
    return `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(d)} · `
  } catch {
    return ''
  }
}

export function ConversationPublishingWorkflow({
  initialState,
  reviewContext = emptyReviewContext,
  onDispatched,
}: Readonly<{
  initialState: ConversationPublishingState
  reviewContext?: ConversationReviewContext
  onDispatched?: (receipt: ConversationPublishReceipt) => void
}>) {
  const [state, setState] = useState(initialState)
  const [editScope, setEditScope] = useState<EditScope | null>(null)
  const [instruction, setInstruction] = useState('')
  const [targetPosition, setTargetPosition] = useState(1)
  const [targetBlockIndex, setTargetBlockIndex] = useState(0)
  const [threadsRepresentativePosition, setThreadsRepresentativePosition] = useState(1)
  const [orderedMediaIds, setOrderedMediaIds] = useState(() => initialState.preview.media.map((media) => media.id))
  const [mediaReady, setMediaReady] = useState(initialState.preview.media.length === 0)
  const [mediaStatus, setMediaStatus] = useState<MediaReadinessStatus>(() => ({
    total: initialState.preview.media.length,
    loaded: 0,
    failedPositions: [],
    ready: initialState.preview.media.length === 0,
  }))
  const [mediaRetryRequest, setMediaRetryRequest] = useState(0)
  const [metaOpen, setMetaOpen] = useState(false)
  const [metaTitle, setMetaTitle] = useState('')
  const [metaKeywords, setMetaKeywords] = useState('')
  const [revisionSummary, setRevisionSummary] = useState('')
  const [message, setMessage] = useState('')
  const [executionUncertain, setExecutionUncertain] = useState(initialState.receipt?.next === 'unknown')
  const [receipt, setReceipt] = useState<ConversationPublishReceipt | null>(initialState.receipt)
  const [feedback, setFeedback] = useState<
    | { kind: 'none' }
    | { kind: 'pending' }
    | { kind: 'success'; verifiedUrl: string | null }
    | { kind: 'error'; message: string }
    | { kind: 'uncertain'; message: string }
  >(() => {
    if (initialState.receipt?.next === 'unknown') {
      return { kind: 'uncertain', message: '결과를 확인하고 있어요. 다시 누르지 마세요' }
    }
    if (initialState.receipt?.next === 'published' || initialState.receipt?.next === 'scheduled') {
      return { kind: 'success', verifiedUrl: initialState.receipt.destinationUrl }
    }
    return { kind: 'none' }
  })
  const statusRegionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (feedback.kind !== 'none') {
      try {
        if (typeof statusRegionRef.current?.scrollIntoView === 'function') {
          statusRegionRef.current.scrollIntoView({ block: 'center' })
        }
      } catch {
        // Ignore scroll errors in environments that do not support smooth/block scroll
      }
    }
  }, [feedback])

  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [allowedPlaceholderVersionId, setAllowedPlaceholderVersionId] = useState<string | null>(null)
  const [publishTiming, setPublishTiming] = useState<'now' | 'schedule'>('now')
  const [publishConfirmed, setPublishConfirmed] = useState(false)
  const [scheduledLocal, setScheduledLocal] = useState('')
  const [pending, startTransition] = useTransition()
  const runExternalWrite = useExternalWriteGuard()
  const preview = state.preview
  const [styleSummary, setStyleSummary] = useState<WorkspaceStyleSummary | null>(null)

  useEffect(() => {
    let active = true
    void loadWorkspaceStyleSummaryAction({ workspaceId: preview.workspaceId })
      .then((result) => {
        if (active && result && 'data' in result && result.data) {
          setStyleSummary(result.data)
        }
      })
      .catch(() => {
        // 실패 시 칩 숨김
      })
    return () => {
      active = false
    }
  }, [preview.workspaceId])

  const accountLabel = preview?.account?.label ?? '공식 계정'
  const accountStatus = preview?.account?.status ?? 'disconnected'
  const connectionReady = accountStatus === 'connected'
  const previewIssues = Array.isArray(preview?.issues) ? preview.issues : []
  const previewMedia = Array.isArray(preview?.media) ? preview.media : []

  const allowPlaceholders = allowedPlaceholderVersionId === preview.versionId

  const canApprove = state.role !== 'viewer'
  const canPublish = state.role === 'owner' || state.role === 'manager'
  const serverReady = previewIssues.length === 0 && connectionReady
  const ready = serverReady && mediaReady && !pending && !executionUncertain
  const approved = preview.approval?.status === 'approved' && preview.approval?.fingerprint === preview.fingerprint
  const isNaver = preview.channel === 'naver_blog'
  const canEditNaver = canApprove && preview.naverRevisionReadiness === 'ready'
  const versionIssues = previewIssues.filter((issue) => issue && issue.code !== 'channel_disconnected')
  const versionReady = versionIssues.length === 0
  const channelRuleIssues = versionIssues.filter((issue) => channelRuleCodes.has(issue.code))
  const disclosureIssue = versionIssues.find((issue) => issue.code === 'disclosure') ?? null
  const mediaIntegrityIssues = versionIssues.filter((issue) => mediaIntegrityCodes.has(issue.code))
  const otherVersionIssues = versionIssues.filter((issue) => !channelRuleCodes.has(issue.code)
    && issue.code !== 'disclosure'
    && !mediaIntegrityCodes.has(issue.code))
  const scopeIssue = previewIssues.find(
    (issue) => issue?.code === 'channel_missing_scope'
      || (typeof issue?.message === 'string' && (
        issue.message.includes('연결이 만료되었거나 권한이 없어요')
        || issue.message.includes('연결 권한이 부족해요')
      )),
  ) ?? null
  const reconnectHref = scopeIssue?.recoveryHref ?? '/app/channels'
  const threadsMediaIssue = preview.channel === 'threads'
    && channelRuleIssues.some((issue) => issue.code === 'threads_media')
  const instagramMediaIssue = preview.channel === 'instagram'
    && channelRuleIssues.some((issue) => issue.code === 'instagram_media')
  const textLengthIssue = channelRuleIssues.find((issue) => issue.code === 'instagram_text' || issue.code === 'threads_text') ?? null
  const channelRulesReady = channelRuleIssues.length === 0
  const disclosureReady = disclosureIssue === null
  const mediaIntegrityReady = mediaIntegrityIssues.length === 0
  const exactVersionReady = otherVersionIssues.length === 0
  const permissionReady = canApprove && canPublish
  const placeholders = useMemo(() => findPlaceholdersInVersion(preview), [preview])
  const hasPlaceholders = placeholders.length > 0
  const hasInfoRequest = useMemo(() => hasInformationRequestPlaceholder(placeholders), [placeholders])
  const placeholderBlocked = hasInfoRequest || (hasPlaceholders && !allowPlaceholders)
  const selectedThreadsMedia = threadsMediaIssue
    ? previewMedia.find((media) => media.position === threadsRepresentativePosition) ?? previewMedia[0] ?? null
    : null
  const displayedPreview = useMemo<ApprovalPreviewSnapshot>(() => {
    if (!selectedThreadsMedia) return preview
    return {
      ...preview,
      media: [{ ...selectedThreadsMedia, position: 1 }],
    }
  }, [preview, selectedThreadsMedia])

  const isPublishDisabled =
    pending ||
    executionUncertain ||
    !canPublish ||
    (!approved && !isNaver) ||
    placeholderBlocked ||
    !ready ||
    !publishConfirmed ||
    (publishTiming === 'schedule' && scheduledLocal.trim().length === 0)

  const isPublished =
    !executionUncertain &&
    (receipt?.next === 'published' ||
      (feedback.kind === 'success' && receipt?.next !== 'scheduled' && publishTiming === 'now'))

  let publishDisabledReason: string | null = null
  if (pending || executionUncertain) {
    publishDisabledReason = null
  } else if (!canPublish) {
    publishDisabledReason = '게시 권한이 필요해요'
  } else if (!approved && !isNaver) {
    publishDisabledReason = '게시 전 승인이 필요해요'
  } else if (placeholderBlocked) {
    publishDisabledReason = hasInfoRequest ? '이벤트 정보를 먼저 알려주세요' : '빈칸을 채우거나 승인을 확인해 주세요'
  } else if (!connectionReady) {
    publishDisabledReason = `${accountLabel} 계정 연결을 확인해 주세요`
  } else if (scopeIssue) {
    publishDisabledReason = scopeIssue.message
  } else if (previewIssues.length > 0) {
    publishDisabledReason = previewIssues[0]?.message ?? '게시 전 확인이 필요해요'
  } else if (!mediaReady || !mediaStatus.ready) {
    publishDisabledReason = '이미지를 불러오는 중이에요'
  } else if (publishTiming === 'schedule' && scheduledLocal.trim().length === 0) {
    publishDisabledReason = '예약 시각을 선택해 주세요'
  } else if (!publishConfirmed) {
    publishDisabledReason = '게시 동의를 체크해 주세요'
  }
  const naverGate = executionUncertain
    ? { kind: 'unknown' as const, title: '게시 결과 확인 필요', description: '중복 게시를 막기 위해 다시 실행하지 않아요. 최신 게시 상태를 확인해 주세요.', buttonLabel: '게시 결과 확인 필요' }
    : pending
    ? {
        kind: 'pending' as const,
        title: '게시 요청을 처리하고 있어요',
        description: '중복 게시를 막기 위해 완료될 때까지 기다려 주세요.',
        buttonLabel: '게시 요청 중',
      }
    : !connectionReady
      ? {
          kind: 'connection' as const,
          title: `${accountLabel} 계정 연결이 필요해요`,
          description: '게시물은 안전하게 보존되어 있습니다. 아래에서 현재 Chrome 연결을 완료해 주세요.',
          buttonLabel: `${accountLabel} 연결을 완료해 주세요`,
        }
      : placeholderBlocked
        ? {
            kind: 'placeholder' as const,
            title: hasInfoRequest ? '이벤트 정보를 먼저 알려주세요' : '빈칸을 채운 뒤 승인할 수 있어요',
            description: hasInfoRequest
              ? '고객에게 보여줄 글이 아니라 소희의 정보 요청이에요. 이벤트 정보를 알려주고 다시 만들어 주세요.'
              : '원고에 채워지지 않은 빈칸이 있습니다. 문구 다듬기로 내용을 채우거나 확인 후 승인해 주세요.',
            buttonLabel: `${preview.visibility === 'public' ? '공개' : preview.visibility ? NAVER_VISIBILITY_LABELS[preview.visibility] : '비공개'} v${preview.versionNumber} 네이버 원고 승인`,
          }
      : !versionReady
        ? {
            kind: 'version' as const,
            title: '게시 전 확인이 필요해요',
            description: versionIssues[0]?.message ?? '승인할 게시 버전의 문제를 먼저 확인해 주세요.',
            buttonLabel: '게시 전 확인이 필요해요',
          }
        : !permissionReady
          ? {
              kind: 'permission' as const,
              title: '게시 권한이 필요해요',
              description: '작업공간 소유자 또는 관리자만 네이버에 게시할 수 있어요.',
              buttonLabel: '소유자 또는 관리자에게 게시 승인을 요청해 주세요',
            }
          : mediaStatus.failedPositions.length > 0
            ? {
                kind: 'media_failed' as const,
                title: `${mediaStatus.failedPositions.join(', ')}번 이미지를 확인하지 못했어요`,
                description: `나머지 ${mediaStatus.loaded}장은 정상입니다. 실패한 이미지만 다시 확인할 수 있어요.`,
                buttonLabel: '실패한 이미지 다시 확인',
              }
            : !mediaStatus.ready
              ? {
                  kind: 'media_loading' as const,
                  title: `이미지 ${mediaStatus.loaded}/${mediaStatus.total}장 확인 중`,
                  description: '아래로 스크롤하지 않아도 소희가 자동으로 확인합니다.',
                  buttonLabel: `이미지 확인 중 ${mediaStatus.loaded}/${mediaStatus.total}`,
                }
              : {
                  kind: 'ready' as const,
                  title: '게시 준비 완료',
                  description: `${preview.account.label} 계정에 보이는 내용 그대로 게시할 수 있어요.`,
                  buttonLabel: `${preview.visibility === 'public' ? '공개' : preview.visibility ? NAVER_VISIBILITY_LABELS[preview.visibility] : '비공개'} v${preview.versionNumber} 네이버 원고 승인`,
                }

  function openEdit(scope: EditScope) {
    if (isNaver && !canEditNaver) return
    setEditScope(scope)
    const firstTextIndex = preview.naverBlocks?.findIndex(block => 'text' in block) ?? -1
    const firstTextBlock = preview.naverBlocks?.[firstTextIndex]
    setTargetBlockIndex(Math.max(0, firstTextIndex))
    setInstruction(scope === 'naver_block' && firstTextBlock && 'text' in firstTextBlock ? firstTextBlock.text
      : scope === 'media_reorder' ? '대화에서 선택한 이미지 순서 변경' : '')
    setTargetPosition(1)
    setOrderedMediaIds(preview.media.map((media) => media.id))
    setMessage('')
    window.setTimeout(() => {
      const panel = document.getElementById('conversation-partial-revision')
      if (typeof panel?.scrollIntoView === 'function') {
        try {
          panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {
          // Ignore scroll errors
        }
      }
    }, 0)
  }

  // 레일에서 고른 문단이 이 원고의 텍스트 문단일 때만 직접 수정 패널을 연다.
  useEffect(() => {
    function onSelect(event: Event) {
      const detail = (event as CustomEvent<NaverBlockSelectDetail>).detail
      const block = preview.naverBlocks?.[detail?.index ?? -1]
      if (!detail || detail.contentId !== preview.contentId || preview.channel !== 'naver_blog'
        || !block || !('text' in block) || !canEditNaver || pending) return
      setMetaOpen(false)
      setEditScope('naver_block')
      setTargetBlockIndex(detail.index)
      setInstruction(block.text)
      setMessage('')
      window.setTimeout(() => {
        const panel = document.getElementById('conversation-partial-revision')
        if (typeof panel?.scrollIntoView === 'function') {
          try {
            panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } catch {
            // Ignore scroll errors
          }
        }
      }, 0)
    }
    window.addEventListener(NAVER_BLOCK_SELECT_EVENT, onSelect)
    return () => window.removeEventListener(NAVER_BLOCK_SELECT_EVENT, onSelect)
  }, [preview.naverBlocks, preview.contentId, preview.channel, canEditNaver, pending])

  function moveMedia(index: number, offset: -1 | 1) {
    setOrderedMediaIds((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const selected = next[index]
      next[index] = next[target]!
      next[target] = selected!
      return next
    })
  }

  function openMeta() {
    if (!canEditNaver) return
    setMetaTitle(preview.naverCopy?.title ?? '')
    setMetaKeywords((preview.naverCopy?.keywords ?? []).join(', '))
    setMetaOpen(true)
    setEditScope(null)
  }

  function submitMeta() {
    if (!canEditNaver) { setMessage(NAVER_REVISION_UNAVAILABLE); return }
    setMessage('')
    startTransition(async () => {
      const result = await naverMetaRevisionAction({
        workspaceId: preview.workspaceId,
        contentId: preview.contentId,
        versionId: preview.versionId,
        fingerprint: preview.fingerprint,
        title: metaTitle,
        keywords: metaKeywords.split(/[,\n]/u).map(keyword => keyword.trim()).filter(keyword => keyword.length > 0),
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMediaReady(result.data.preview.media.length === 0)
      setMediaStatus({ total: result.data.preview.media.length, loaded: 0, failedPositions: [], ready: result.data.preview.media.length === 0 })
      setMediaRetryRequest(0)
      setOrderedMediaIds(result.data.preview.media.map((media) => media.id))
      setState((current) => ({
        ...current,
        preview: result.data.preview,
        previousVersions: [
          { id: current.preview.versionId, versionNumber: current.preview.versionNumber, createdAt: new Date().toISOString(), revisionReason: null },
          ...(current.previousVersions ?? []),
        ].slice(0, 10),
      }))
      setRevisionSummary(result.data.summary)
      setMetaOpen(false)
      setReceipt(null)
    })
  }

  function restoreVersion(sourceVersionId: string) {
    if (!canEditNaver) { setMessage(NAVER_REVISION_UNAVAILABLE); return }
    setMessage('')
    startTransition(async () => {
      const result = await restoreNaverVersionAction({
        workspaceId: preview.workspaceId,
        contentId: preview.contentId,
        versionId: preview.versionId,
        fingerprint: preview.fingerprint,
        sourceVersionId,
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMediaReady(result.data.preview.media.length === 0)
      setMediaStatus({ total: result.data.preview.media.length, loaded: 0, failedPositions: [], ready: result.data.preview.media.length === 0 })
      setMediaRetryRequest(0)
      setOrderedMediaIds(result.data.preview.media.map((media) => media.id))
      // 복원본은 새 버전이라 기존 목록의 현재 버전이 이전 버전이 된다.
      setState((current) => ({
        ...current,
        preview: result.data.preview,
        previousVersions: [
          { id: current.preview.versionId, versionNumber: current.preview.versionNumber, createdAt: new Date().toISOString(), revisionReason: null },
          ...(current.previousVersions ?? []),
        ].slice(0, 10),
      }))
      setRevisionSummary(result.data.summary)
      setEditScope(null)
      setInstruction('')
      setReceipt(null)
    })
  }

  function runRevision(
    scope: EditScope,
    revisionInstruction: string,
    revisionTargetPosition: number | null,
    revisionOrderedMediaIds: readonly string[] | null,
    existingAssetId?: string,
  ) {
    if (revisionInstruction.trim().length === 0) return
    setMessage('')
    startTransition(async () => {
      const result = await partialContentRevisionAction({
        workspaceId: preview.workspaceId,
        contentId: preview.contentId,
        versionId: preview.versionId,
        fingerprint: preview.fingerprint,
        scope,
        instruction: revisionInstruction,
        targetPosition: revisionTargetPosition,
        orderedMediaIds: revisionOrderedMediaIds,
        ...(scope === 'naver_block' ? { targetBlockIndex } : {}),
        ...(existingAssetId ? { existingAssetId } : {}),
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMediaReady(result.data.preview.media.length === 0)
      setMediaStatus({
        total: result.data.preview.media.length,
        loaded: 0,
        failedPositions: [],
        ready: result.data.preview.media.length === 0,
      })
      setMediaRetryRequest(0)
      setOrderedMediaIds(result.data.preview.media.map((media) => media.id))
      setState((current) => ({ ...current, preview: result.data.preview }))
      setRevisionSummary(result.data.revisionSummary)
      setEditScope(null)
      setInstruction('')
      setThreadsRepresentativePosition(1)
      setReceipt(null)
    })
  }

  function submitRevision() {
    if (!editScope) return
    runRevision(
      editScope,
      instruction,
      editScope === 'image_replace' ? targetPosition : null,
      editScope === 'media_reorder' ? orderedMediaIds : null,
    )
  }

  function repairThreadsMediaLimit() {
    runRevision(
      'media_limit',
      'Threads 이미지 1장 제한에 맞춰 선택한 대표 이미지만 유지합니다.',
      threadsRepresentativePosition,
      null,
    )
  }

  function repairDisclosure() {
    runRevision(
      'disclosure_repair',
      '비어 있는 게시 고지에 안전한 기본 문구를 적용합니다.',
      null,
      null,
    )
  }

  function repairTextLength() {
    runRevision(
      'caption',
      `${channelLabel(preview)} 게시 가능한 글자 수 안에서 핵심 내용과 말투를 유지해 본문을 줄여 주세요.`,
      null,
      null,
    )
  }

  async function refreshPublishingState() {
    try {
      const refreshed = await loadConversationPublishingAction({
        workspaceId: preview.workspaceId,
        contentId: preview.contentId,
      })
      if (refreshed.error) {
        setMessage(refreshed.error.message)
        setFeedback({ kind: 'error', message: refreshed.error.message })
        return false
      }
      setState(refreshed.data)
      setReceipt(refreshed.data.receipt)
      if (refreshed.data.receipt) {
        if (refreshed.data.receipt.next === 'unknown') {
          setExecutionUncertain(true)
          setFeedback({
            kind: 'uncertain',
            message: '결과를 확인하고 있어요. 다시 누르지 마세요',
          })
        } else if (
          refreshed.data.receipt.next === 'published' ||
          refreshed.data.receipt.next === 'scheduled'
        ) {
          setFeedback({
            kind: 'success',
            verifiedUrl: refreshed.data.receipt.destinationUrl,
          })
        }
      }
      return true
    } catch {
      setMessage('최신 상태를 불러오지 못했어요. 다시 시도해 주세요.')
      setFeedback({ kind: 'error', message: '최신 상태를 불러오지 못했어요. 다시 시도해 주세요.' })
      return false
    }
  }

  function approve() {
    if (!canApprove || !ready || approved || placeholderBlocked) return
    setMessage('')
    startTransition(async () => {
      try {
        const result = await approveAndDispatchAction({
          workspaceId: preview.workspaceId,
          contentId: preview.contentId,
          versionId: preview.versionId,
          fingerprint: preview.fingerprint,
          mode: 'approve_only',
          channelConnectionId: null,
          scheduledLocal: null,
          timezone: null,
        })
        if (result.error) {
          setMessage(result.error.message)
          return
        }
        setMessage(resultMessage('approved', preview.versionNumber))
        await refreshPublishingState()
      } catch {
        setMessage('승인 요청을 완료하지 못했어요. 다시 시도해 주세요.')
      }
    })
  }

  function dispatch(mode: 'publish_now' | 'schedule', scheduledLocal: string | null) {
    if (pending) return
    if (executionUncertain) {
      setFeedback({ kind: 'uncertain', message: '결과를 확인하고 있어요. 다시 누르지 마세요' })
      return
    }
    if (!canPublish) {
      setFeedback({ kind: 'error', message: '게시 권한이 필요해요' })
      return
    }
    if (!approved && !isNaver) {
      setFeedback({ kind: 'error', message: '게시 전 승인이 필요해요' })
      return
    }
    if (placeholderBlocked) {
      setFeedback({
        kind: 'error',
        message: hasInfoRequest ? '이벤트 정보를 먼저 알려주세요' : '빈칸을 채우거나 승인을 확인해 주세요',
      })
      return
    }
    if (!connectionReady) {
      setFeedback({ kind: 'error', message: `${accountLabel} 계정 연결을 확인해 주세요` })
      return
    }
    if (previewIssues.length > 0) {
      setFeedback({ kind: 'error', message: previewIssues[0]?.message ?? '게시 전 확인이 필요해요' })
      return
    }
    if (!mediaReady || !mediaStatus.ready) {
      setFeedback({ kind: 'error', message: '이미지를 불러오는 중이에요' })
      return
    }
    if (!publishConfirmed) {
      setFeedback({ kind: 'error', message: '게시 동의를 체크해 주세요' })
      return
    }
    if (mode === 'schedule' && (!scheduledLocal || scheduledLocal.trim().length === 0)) {
      setFeedback({ kind: 'error', message: '예약 시각을 선택해 주세요' })
      return
    }

    setMessage('')
    setFeedback({ kind: 'pending' })
    startTransition(async () => {
      // 승인·발행 요청은 오프라인이거나 같은 건이 이미 진행 중이면 보내지 않는다(ANI-1778, D4).
      const outcome = await runExternalWrite('publish', publishWriteKey(preview.channel, preview.contentId, mode), async () => {
        try {
          return await approveAndDispatchAction({
            workspaceId: preview.workspaceId, contentId: preview.contentId,
            versionId: preview.versionId, fingerprint: preview.fingerprint, mode,
            channelConnectionId: preview.account.connectionId,
            scheduledLocal: mode === 'schedule' ? scheduledLocal : null,
            timezone: 'Asia/Seoul',
          })
        } catch {
          // A lost response is not proof that the write did not commit. Never send a fallback command.
          setExecutionUncertain(true)
          return { error: { message: '게시 요청의 반영 여부를 확인하지 못했어요. 중복 게시를 막기 위해 다시 실행하지 말고 최신 게시 상태를 확인해 주세요.', requestId: 'conversation-publish-unknown' } }
        }
      })
      if (!outcome.ran) {
        setMessage(outcome.decision.message)
        setFeedback({ kind: 'error', message: outcome.decision.message })
        return
      }
      const result = outcome.value
      if (result.error) {
        setMessage(result.error.message)
        setFeedback({ kind: 'error', message: result.error.message })
        return
      }
      const next = result.data.next === 'approved' ? 'unknown' : result.data.next
      if (next === 'unknown') {
        setExecutionUncertain(true)
        setFeedback({
          kind: 'uncertain',
          message: '결과를 확인하고 있어요. 다시 누르지 마세요',
        })
      } else {
        setFeedback({
          kind: 'success',
          verifiedUrl: null,
        })
      }
      setMessage(resultMessage(next, preview.versionNumber))
      if (result.data.scheduleId || next === 'published') {
        const nextReceipt: ConversationPublishReceipt = {
          next,
          scheduleId: result.data.scheduleId ?? result.data.attemptId ?? 'published-now',
          attemptId: result.data.attemptId,
          providerPostId: result.data.providerPostId,
          destinationUrl: null,
          publishAt: new Date().toISOString(),
        }
        setReceipt(nextReceipt)
        onDispatched?.(nextReceipt)
      }
      await refreshPublishingState()
    })
  }

  function approvalControl() {
    if (!approved) {
      if (isNaver && naverGate.kind === 'media_failed') {
        return <button className={styles.workflowRepair} onClick={() => setMediaRetryRequest((current) => current + 1)} type="button">
          {naverGate.buttonLabel}
        </button>
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          <button
            className={styles.workflowPrimary}
            disabled={isNaver ? (naverGate.kind !== 'ready' || placeholderBlocked) : (!ready || !canApprove || placeholderBlocked)}
            onClick={approve}
            type="button"
          >
            {isNaver ? naverGate.buttonLabel : pending ? '처리 중…' : '이대로 승인'}
          </button>
          {!isNaver && !hasInfoRequest && hasPlaceholders && !allowPlaceholders ? (
            <p className="text-center text-xs text-muted-foreground">빈칸을 채우거나 아래 확인을 체크하면 승인할 수 있어요.</p>
          ) : null}
          {!hasInfoRequest && hasPlaceholders ? (
            <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 text-xs text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={allowPlaceholders}
                onChange={(e) => setAllowedPlaceholderVersionId(e.target.checked ? preview.versionId : null)}
                className="size-4 rounded border-border"
              />
              <span>빈칸이 있어도 이대로 승인할게요</span>
            </label>
          ) : null}
        </div>
      )
    }
    if (isNaver) {
      return (
        <div className="space-y-2 p-3 rounded-xl border bg-muted/30 text-xs">
          <p className="font-semibold text-foreground">
            소희는 네이버 자동 게시를 하지 않아요. 글·사진을 준비해 드리고 직접 올리실 수 있게 도와요
          </p>
          <p className="text-muted-foreground">
            소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.
          </p>
        </div>
      )
    }
    if (isPublished) {
      return <p className={styles.approvedMessage}>v{preview.versionNumber} 승인이 완료됐어요.</p>
    }
    return <p className={styles.approvedMessage}>정확한 v{preview.versionNumber} 승인이 기록됐어요.</p>
  }

  return (
    <section aria-label="대화 안 게시물 검토와 실행" className={styles.publishingWorkflow} data-layout="single-column">
      <header className={styles.publishingHeading}>
        <div className={styles.channelHeaderLine}>
          {channelIcon(preview.channel)}
          <h2>{channelLabel(preview)} · {accountLabel}</h2>
        </div>
        <StatusBadge
          label={approved ? `v${preview.versionNumber} 승인됨` : `v${preview.versionNumber} 승인 대기`}
          tone={approved ? 'success' : 'review'}
        />
      </header>

      {styleSummary ? (
        <div className={styles.styleSummaryContainer}>
          <ul aria-label="현재 등록된 스타일" className={styles.styleSummaryChips}>
            {!isNaver ? (
              <li className={styles.styleSummaryChip}>
                <Link href="/app/settings/image-style" className={styles.styleSummaryLink}>
                  {styleSummary.image.configured
                    ? `이미지 스타일 · ${styleSummary.image.headline}${styleSummary.image.referenceCount > 0 ? ` · 기준 사진 ${styleSummary.image.referenceCount}장` : ''}`
                    : '이미지 스타일 없음 · 만들기'}
                </Link>
              </li>
            ) : null}
            <li className={styles.styleSummaryChip}>
              <Link
                href={styleSummary.text.configured ? '/app/settings/brand' : '/app/settings/image-style'}
                className={styles.styleSummaryLink}
              >
                {styleSummary.text.configured
                  ? `글 방식 · ${styleSummary.text.voiceSummary.length > 24 ? `${styleSummary.text.voiceSummary.slice(0, 24)}…` : styleSummary.text.voiceSummary}`
                  : '글 방식 없음 · 만들기'}
              </Link>
            </li>
          </ul>
          <span className={styles.styleSummaryNotice}>다음 제작·수정부터 사용해요</span>
        </div>
      ) : null}

      <div className={styles.reviewLayout}>
        <div className={styles.previewSurface}>
          {hasPlaceholders ? (
            <div className="mb-3 w-full">
              <PlaceholderNotice placeholders={placeholders} />
            </div>
          ) : null}
          <ChannelPreviewCard
            onEditCaption={() => openEdit(isNaver ? 'naver_block' : 'caption')}
            onEditImage={isNaver ? undefined : () => openEdit('image_replace')}
            preview={displayedPreview}
            onMediaReadinessChange={setMediaReady}
            onMediaStatusChange={setMediaStatus}
            retryRequest={mediaRetryRequest}
          />
          {selectedThreadsMedia ? <p className={styles.selectionPreviewNote} role="status">
            {threadsRepresentativePosition}번 이미지를 대표 이미지로 미리 보고 있어요. 새 버전을 만들기 전에는 게시되지 않아요.
          </p> : null}
        </div>

        <details aria-label="안전·게시 정보" className={styles.approvalSummary} open={!ready}>
          <summary className={styles.approvalDisclosure}>
            <span>{ready ? '자세히' : '게시 전 확인이 필요해요'}</span>
            <small>안전·게시 정보</small>
          </summary>
          <dl className={styles.summaryFacts}>
            <div><dt>채널</dt><dd>{channelLabel(preview)}</dd></div>
            <div><dt>계정</dt><dd>{accountLabel}</dd></div>
            <div><dt>버전</dt><dd>v{preview.versionNumber}</dd></div>
            <div><dt>미디어</dt><dd>{mediaLabel(preview.media.length)}</dd></div>
          </dl>
          {!isNaver ? <div className={styles.connectionFact} data-connected={connectionReady}>
            <span aria-hidden="true" />
            {connectionReady ? '게시 계정 연결 확인됨' : '게시 계정 연결을 확인해 주세요'}
          </div> : null}
          <button className={styles.evidenceButton} onClick={() => setEvidenceOpen(true)} type="button">
            근거 보기
          </button>
          {isPublished ? (
            <div className={styles.versionApprovalNote}>
              <ShieldCheck aria-hidden="true" />
              <p><span>실행 기록은 대화에 남아 있어요</span></p>
            </div>
          ) : (
            <div className={styles.versionApprovalNote}>
              <ShieldCheck aria-hidden="true" />
              <p><strong>정확한 버전 v{preview.versionNumber}</strong><span>부분 수정은 새 버전으로 남고 기존 승인은 이어지지 않아요.</span></p>
            </div>
          )}
          <p className={styles.legaleseNote}>요청 뒤 결과가 불명확하면 자동 재실행하지 않고 공식 채널 상태를 먼저 확인해요.</p>
          {isNaver ? <div
            aria-label="게시 전 확인"
            className={styles.publishGate}
            data-tone={naverGate.kind === 'ready' ? 'ready' : naverGate.kind === 'media_failed' ? 'failure' : 'waiting'}
            role="status"
          >
            <strong>{naverGate.title}</strong>
            <span>{naverGate.description}</span>
            <ul>
              <li data-complete={connectionReady}>계정 연결</li>
              <li data-complete={versionReady}>정확한 버전</li>
              <li data-complete={mediaStatus.ready}>이미지 {mediaStatus.total}장</li>
              <li data-complete={permissionReady}>게시 권한</li>
            </ul>
          </div> : null}
          {!isNaver ? <div
            aria-label="게시 전 확인"
            className={styles.publishGate}
            data-tone={ready ? 'ready' : threadsMediaIssue ? 'failure' : 'waiting'}
            role="status"
          >
            <strong>{pending
              ? '게시 요청을 처리하고 있어요'
              : !connectionReady
                ? `${accountLabel} 계정 연결이 필요해요`
                : threadsMediaIssue
                  ? 'Threads 이미지 수를 맞춰야 해요'
                  : instagramMediaIssue
                    ? 'Instagram 이미지가 필요해요'
                    : textLengthIssue
                      ? '본문 길이를 채널에 맞춰야 해요'
                      : disclosureIssue
                        ? '게시 고지를 복구할 수 있어요'
                  : !versionReady
                    ? '게시 전 확인이 필요해요'
                    : !permissionReady
                      ? '게시 권한이 필요해요'
                      : mediaStatus.failedPositions.length > 0
                        ? `${mediaStatus.failedPositions.join(', ')}번 이미지를 확인하지 못했어요`
                        : !mediaStatus.ready
                          ? `이미지 ${mediaStatus.loaded}/${mediaStatus.total}장 확인 중`
                          : '게시 준비 완료'}</strong>
            <span>{threadsMediaIssue
              ? `Threads 이미지가 ${preview.media.length}장입니다. 대표 이미지 1장을 선택해 주세요.`
              : instagramMediaIssue
                ? 'Instagram 이미지가 없습니다. 이미지를 1장 이상 추가해 주세요.'
                : textLengthIssue
                  ? '본문이 게시 가능한 길이를 넘었습니다. 채널에 맞게 줄여 주세요.'
                  : disclosureIssue
                    ? '게시 고지가 비어 있습니다. 안전한 기본 문구를 적용할 수 있어요.'
                    : versionIssues[0]?.message
                ?? (ready ? `${accountLabel} 계정에 보이는 내용 그대로 승인할 수 있어요.` : '완료되지 않은 항목을 이 화면에서 확인해 주세요.')}</span>
            <ul>
              <li data-complete={connectionReady}>계정 연결</li>
              <li data-complete={channelRulesReady} data-testid="channel-rules-status">채널 규격</li>
              <li data-complete={disclosureReady} data-testid="disclosure-status">게시 고지</li>
              <li data-complete={mediaIntegrityReady && mediaStatus.ready}>이미지 표시</li>
              <li data-complete={exactVersionReady}>버전 근거</li>
              <li data-complete={permissionReady}>승인 권한</li>
            </ul>
            {threadsMediaIssue ? <div className={styles.partialInstruction}>
              <label>
                Threads에 사용할 대표 이미지
                <select
                  aria-label="Threads에 사용할 대표 이미지"
                  onChange={(event) => setThreadsRepresentativePosition(Number(event.target.value))}
                  value={threadsRepresentativePosition}
                >
                  {preview.media.map((media) => <option key={media.id} value={media.position}>{media.position}번 이미지 · {media.altText}</option>)}
                </select>
              </label>
              <button
                className={styles.workflowRepair}
                disabled={pending}
                onClick={repairThreadsMediaLimit}
                type="button"
              >
                선택한 이미지 1장으로 새 버전 만들기
              </button>
            </div> : null}
            {!threadsMediaIssue && instagramMediaIssue ? <button
              className={styles.workflowRepair}
              disabled={pending}
              onClick={() => openEdit('image_add')}
              type="button"
            >
              Instagram 이미지 추가하기
            </button> : null}
            {!threadsMediaIssue && !instagramMediaIssue && textLengthIssue ? <button
              className={styles.workflowRepair}
              disabled={pending}
              onClick={repairTextLength}
              type="button"
            >
              채널 길이에 맞게 본문 줄이기
            </button> : null}
            {!threadsMediaIssue && !instagramMediaIssue && !textLengthIssue && disclosureIssue ? <button
              className={styles.workflowRepair}
              disabled={pending}
              onClick={repairDisclosure}
              type="button"
            >
              안전한 게시 고지를 적용하고 새 버전 만들기
            </button> : null}
          </div> : null}
        </details>

        <div aria-label="게시물 빠른 작업" className={styles.reviewDock}>
          {!isNaver ? <button onClick={() => openEdit('image_replace')} type="button"><RefreshCw aria-hidden="true" />이미지 바꾸기</button> : null}
          <button disabled={pending || !canApprove || (isNaver && !canEditNaver)} onClick={() => openEdit(isNaver ? 'naver_block' : 'caption')} type="button"><PencilLine aria-hidden="true" />문구 다듬기</button>
          {approvalControl()}
        </div>
      </div>

      <DetailPanel
        description="생성에 사용한 근거와 아직 확인할 내용을 분리해서 보여줘요."
        onOpenChange={setEvidenceOpen}
        open={evidenceOpen}
        title="이 버전의 근거"
      >
        <div className={styles.evidencePanel}>
          <section><h3>사용한 근거</h3>{reviewContext.evidence.length > 0 ? <ul>{reviewContext.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p>표시할 근거가 없어요.</p>}</section>
          <section><h3>해석의 한계</h3>{reviewContext.limitations.length > 0 ? <ul>{reviewContext.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>추가로 표시할 한계가 없어요.</p>}</section>
          <section><h3>확인이 필요한 항목</h3>{reviewContext.unresolvedQuestions.length > 0 ? <ul>{reviewContext.unresolvedQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>추가 확인 항목이 없어요.</p>}</section>
        </div>
      </DetailPanel>

      <section aria-label="부분 수정" className={styles.partialRevisionPanel} id="conversation-partial-revision">
        <small>부분 수정</small>
        <h3>전체를 다시 만들지 않고 필요한 부분만 바꾸기</h3>
        {isNaver && !canEditNaver && canApprove ? <Alert><AlertDescription>{NAVER_REVISION_UNAVAILABLE}</AlertDescription></Alert> : null}
        <div className={styles.partialRevisionActions}>
          {isNaver && preview.naverBlocks?.some(block => 'text' in block) ? <button disabled={pending || !canEditNaver} onClick={() => openEdit('naver_block')} type="button"><PencilLine aria-hidden="true" />원고 문단 직접 수정</button> : null}
          {isNaver && preview.naverCopy ? <button disabled={pending || !canEditNaver} onClick={openMeta} type="button"><Hash aria-hidden="true" />제목·태그 수정</button> : null}
          {!isNaver ? <><button onClick={() => openEdit('image_add')} type="button"><Plus aria-hidden="true" />이미지 추가 생성</button>
          <button onClick={() => openEdit('image_replace')} type="button"><RefreshCw aria-hidden="true" />이미지 교체</button>
          <button onClick={() => openEdit('caption')} type="button"><PencilLine aria-hidden="true" />본문 수정 지시</button>
          <button onClick={() => openEdit('hashtags')} type="button"><Hash aria-hidden="true" />해시태그 수정</button>
          {preview.media.length > 1 ? <button onClick={() => openEdit('media_reorder')} type="button"><ArrowUp aria-hidden="true" />이미지 순서 변경</button> : null}</> : null}
        </div>

        {metaOpen ? (
          <div className={styles.partialInstruction}>
            <label>제목<input disabled={pending} maxLength={200} onChange={event => setMetaTitle(event.target.value)} value={metaTitle} /></label>
            <label>태그 (쉼표로 구분)<textarea aria-label="태그" disabled={pending} onChange={event => setMetaKeywords(event.target.value)} value={metaKeywords} /></label>
            <p>본문과 사진은 그대로 두고 제목·태그만 바꿔요. 저장 후 새 버전을 다시 승인해야 해요.</p>
            <div>
              <button onClick={() => setMetaOpen(false)} type="button">취소</button>
              <button className={styles.primaryAction} disabled={pending || metaTitle.trim().length === 0 || metaKeywords.trim().length === 0} onClick={submitMeta} type="button">제목·태그를 새 버전으로 저장</button>
            </div>
          </div>
        ) : null}
        {editScope ? (
          <div className={styles.partialInstruction}>
            {editScope === 'naver_block' ? <>
              <label>수정할 문단<select value={targetBlockIndex} disabled={pending} onChange={event => {
                const index = Number(event.target.value)
                const block = preview.naverBlocks?.[index]
                setTargetBlockIndex(index)
                setInstruction(block && 'text' in block ? block.text : '')
              }}>{preview.naverBlocks?.map((block, index) => 'text' in block
                ? <option key={index} value={index}>{index + 1}번 · {block.text.slice(0, 40)}</option> : null)}</select></label>
              <section aria-label="문단 변경 비교">
                <p>변경 전</p><p>{(() => { const block = preview.naverBlocks?.[targetBlockIndex]; return block && 'text' in block ? block.text : '' })()}</p>
                <p>변경 후</p><p>{instruction}</p>
                <p>사진은 다시 만들지 않아요. 저장 후 새 버전을 다시 승인해야 해요.</p>
              </section>
            </> : null}
            {editScope === 'image_replace' ? (
              <label>
                교체할 이미지
                <select value={targetPosition} onChange={(event) => setTargetPosition(Number(event.target.value))}>
                  {preview.media.map((media) => <option key={media.id} value={media.position}>{media.position}번 이미지</option>)}
                </select>
              </label>
            ) : null}
            {editScope === 'media_reorder' ? (
              <ol className={styles.mediaOrderList}>
                {orderedMediaIds.map((id, index) => {
                  const media = preview.media.find((item) => item.id === id)
                  return <li key={id}>
                    <span>{index + 1}번 · {media?.altText ?? '이미지'}</span>
                    <button aria-label={`${index + 1}번 이미지를 앞으로`} disabled={index === 0} onClick={() => moveMedia(index, -1)} type="button"><ArrowUp /></button>
                    <button aria-label={`${index + 1}번 이미지를 뒤로`} disabled={index === orderedMediaIds.length - 1} onClick={() => moveMedia(index, 1)} type="button"><ArrowDown /></button>
                  </li>
                })}
              </ol>
            ) : (
              <label>
                {editScope === 'naver_block' ? '바꿀 문단 내용' : editScope === 'caption'
                  ? '소희에게 수정할 문장을 알려주세요'
                  : editScope === 'hashtags'
                    ? '해시태그를 어떻게 바꿀까요?'
                    : '어떤 이미지가 필요할지 알려주세요'}
                <textarea
                  aria-label={editScope === 'naver_block' ? '바꿀 문단 내용' : editScope === 'caption' ? '소희에게 수정할 문장을 알려주세요' : undefined}
                  disabled={pending}
                  maxLength={2_000}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder={editScope === 'image_replace' ? '예: 선택한 이미지만 더 자연광 느낌으로 바꿔줘' : '바꿀 부분만 구체적으로 알려주세요.'}
                  value={instruction}
                />
              </label>
            )}
            {editScope === 'image_replace' || editScope === 'image_add' ? (
              <details>
                <summary>문구·삽입컷 얹기 (전 사진 컷, 제목 문구)</summary>
                <OverlayComposer
                  workspaceId={preview.workspaceId}
                  baseUrl={editScope === 'image_replace' ? (preview.media[targetPosition - 1]?.src ?? null) : null}
                  onSaved={(saved) => {
                    if (editScope === 'image_replace') {
                      runRevision('image_replace', '문구·삽입컷을 얹은 이미지로 교체', targetPosition, null, saved.assetId)
                    } else {
                      runRevision('image_add', '문구·삽입컷을 얹은 이미지 추가', null, null, saved.assetId)
                    }
                  }}
                />
              </details>
            ) : null}
            {editScope === 'image_replace' || editScope === 'image_add' ? (
              <p>
                원하는 이미지 모습을 미리 등록해 두면 매번 그대로 만들어요. <Link href="/app/settings/image-style">우리 매장 이미지 스타일 설정</Link>
              </p>
            ) : null}
            <div>
              <button onClick={() => setEditScope(null)} type="button">취소</button>
              <button className={styles.primaryAction} disabled={pending || instruction.trim().length === 0} onClick={submitRevision} type="button">{editScope === 'naver_block' ? '문단을 새 버전으로 저장' : '이 부분만 수정'}</button>
            </div>
          </div>
        ) : null}
        {isNaver && canApprove && state.previousVersions && state.previousVersions.length > 0 ? (
          <section aria-label="이전 버전">
            <h4>이전 버전으로 되돌리기</h4>
            <p>선택한 버전의 내용이 새 버전으로 추가돼요. 기존 버전은 그대로 남고, 새 버전은 다시 승인해야 해요.</p>
            <ul>{state.previousVersions.map(version => (
              <li key={version.id}>
                <span>v{version.versionNumber}{version.revisionReason ? ` · ${version.revisionReason}` : ''}</span>
                <button disabled={pending || !canEditNaver} onClick={() => restoreVersion(version.id)} type="button">v{version.versionNumber} 내용으로 새 버전 만들기</button>
              </li>
            ))}</ul>
          </section>
        ) : null}
        {revisionSummary ? <p className={styles.revisionResult}><CheckCircle2 aria-hidden="true" /><span><strong>v{preview.versionNumber} 부분 수정 완료</strong>{revisionSummary}</span></p> : null}
      </section>

      {!(approved && canPublish && !isNaver) && previewIssues.length > 0 ? <div className={styles.publishingIssues}>{previewIssues.map((issue) => <p key={issue.code}>{issue.message}</p>)}</div> : null}
      {!(approved && canPublish && !isNaver) && !mediaReady && preview.media.length > 0 ? <p className={styles.workflowMessage}>모든 이미지의 실제 표시를 확인하면 승인할 수 있어요.</p> : null}
      {!(approved && canPublish && !isNaver) && message ? <p className={styles.workflowMessage} role="status">{message}</p> : null}

      {approved && canPublish && !isNaver && !isPublished ? (
        placeholderBlocked ? (
          !hasInfoRequest && hasPlaceholders ? (
            <div className="flex flex-col items-center justify-center p-3">
              <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 text-xs text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={allowPlaceholders}
                  onChange={(e) => setAllowedPlaceholderVersionId(e.target.checked ? preview.versionId : null)}
                  className="size-6 sm:size-4 rounded border-border shrink-0"
                />
                <span>빈칸이 있어도 이대로 승인할게요</span>
              </label>
            </div>
          ) : null
        ) : (
          <section aria-label="승인 후 실행 선택" className={styles.publishContainer}>
            <div aria-label="게시 시점" className={styles.segmentedToggle} role="group">
              <button
                aria-label="지금 게시"
                aria-pressed={publishTiming === 'now'}
                className={styles.segmentButton}
                data-active={publishTiming === 'now'}
                onClick={() => {
                  setPublishTiming('now')
                  setPublishConfirmed(false)
                }}
                type="button"
              >
                지금
              </button>
              <button
                aria-label="예약 게시"
                aria-pressed={publishTiming === 'schedule'}
                className={styles.segmentButton}
                data-active={publishTiming === 'schedule'}
                onClick={() => {
                  setPublishTiming('schedule')
                  setPublishConfirmed(false)
                }}
                type="button"
              >
                예약
              </button>
            </div>

            {publishTiming === 'schedule' ? (
              <div className={styles.schedulePicker}>
                <label className={styles.scheduleLabel}>
                  <span>예약 시각 (한국 시간)</span>
                  <input
                    aria-label="예약 시각 (한국 시간)"
                    className={styles.scheduleInput}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                    type="datetime-local"
                    value={scheduledLocal}
                  />
                </label>
              </div>
            ) : null}

            <label className={styles.compactConsent}>
              <input
                aria-label={`승인한 v${preview.versionNumber}을 ${accountLabel} 계정에 지금 게시합니다`}
                checked={publishConfirmed}
                className="size-6 sm:size-4 rounded border-border shrink-0"
                onChange={(e) => setPublishConfirmed(e.target.checked)}
                type="checkbox"
              />
              <span>{accountLabel} 계정에 {publishTiming === 'schedule' ? '예약' : '지금'} 게시합니다</span>
            </label>

            <div
              ref={statusRegionRef}
              className={styles.publishStatusRegion}
              data-tone={feedback.kind === 'error' || feedback.kind === 'uncertain' ? 'alert' : feedback.kind}
              role={feedback.kind === 'error' || feedback.kind === 'uncertain' ? 'alert' : 'status'}
              aria-live={feedback.kind === 'error' || feedback.kind === 'uncertain' ? 'assertive' : 'polite'}
            >
              {feedback.kind === 'pending' ? (
                <div className={styles.publishStatusItem}>
                  <Loader2 className="mr-1.5 size-4 animate-spin text-primary shrink-0" aria-hidden="true" />
                  <span>게시하는 중…</span>
                </div>
              ) : null}

              {feedback.kind === 'uncertain' ? (
                <div className={styles.publishStatusItem}>
                  <span>{feedback.message}</span>
                </div>
              ) : null}

              {feedback.kind === 'error' ? (
                <div className={styles.publishStatusItem}>
                  <span>{feedback.message}</span>
                  <button
                    className={styles.retryButton}
                    onClick={() => {
                      if (publishTiming === 'schedule') {
                        dispatch('schedule', scheduledLocal)
                      } else {
                        dispatch('publish_now', null)
                      }
                    }}
                    type="button"
                  >
                    다시 시도
                  </button>
                  {feedback.message.includes('다시 연결') ? (
                    <a
                      className={styles.reconnectButton}
                      href={reconnectHref}
                    >
                      채널 다시 연결
                    </a>
                  ) : null}
                </div>
              ) : null}

              {feedback.kind === 'success' ? (
                <div className={styles.publishStatusItem}>
                  <CheckCircle2 className="mr-1.5 size-4 text-primary shrink-0" aria-hidden="true" />
                  <span>게시했어요</span>
                  {feedback.verifiedUrl ? (
                    <a
                      className={styles.verifiedLink}
                      href={feedback.verifiedUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      게시물 확인하기
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>

            {scopeIssue ? (
              <div className={styles.publishBlockingBanner}>
                <p>{scopeIssue.message}</p>
                <a
                  className={styles.reconnectButton}
                  href={scopeIssue.recoveryHref ?? reconnectHref}
                >
                  채널 다시 연결
                </a>
              </div>
            ) : null}

            <button
              aria-busy={pending}
              className={styles.workflowPrimary}
              disabled={isPublishDisabled}
              onClick={() => {
                if (publishTiming === 'schedule') {
                  dispatch('schedule', scheduledLocal)
                } else {
                  dispatch('publish_now', null)
                }
              }}
              type="button"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                  <span>게시하는 중…</span>
                </>
              ) : (
                '게시하기'
              )}
            </button>
            {!scopeIssue && isPublishDisabled && publishDisabledReason ? (
              <p className={styles.publishDisabledReason}>{publishDisabledReason}</p>
            ) : null}
          </section>
        )
      ) : approved && !isPublished ? <p className={styles.workflowMessage}>v{preview.versionNumber} 승인이 완료됐어요. 소유자 또는 관리자가 게시 방식을 선택할 수 있어요.</p> : null}

      {receipt && receipt.next !== 'published' ? <article aria-label="SNS 게시 실행 결과" className={styles.publishReceipt} data-state={receipt.next}>
        <CheckCircle2 aria-hidden="true" />
        <div>
          <small>{channelLabel(preview)} · 정확한 버전 v{preview.versionNumber}</small>
          <strong>{resultMessage(receipt.next, preview.versionNumber)}</strong>
          <span>{formatReceiptDate(receipt.publishAt)}실행 기록은 일정과 이 대화에 함께 남습니다.</span>
          {receipt.destinationUrl ? <a href={receipt.destinationUrl} target="_blank" rel="noreferrer">실제 게시물 열기</a> : null}
        </div>
      </article> : null}

      {isPublished ? (
        <div
          ref={statusRegionRef}
          aria-live="polite"
          role="status"
        >
          <PostPublishCarePanel
            workspaceId={preview.workspaceId}
            channel={preview.channel}
            accountLabel={accountLabel}
            publishedAt={receipt?.publishAt}
            destinationUrl={receipt?.destinationUrl ?? (feedback.kind === 'success' ? feedback.verifiedUrl : null)}
          />
        </div>
      ) : null}
    </section>
  )
}
