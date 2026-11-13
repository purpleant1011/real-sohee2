'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  BookOpenText,
  Camera,
  CheckCircle2,
  ChevronRight,
  Copy,
  Info,
  Loader2,
  MessageCircle,
  PenLine,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ChannelPreview } from '@/features/preview/channel-preview'
import {
  STUDIO_CHANNELS,
  STUDIO_CHANNEL_LABELS,
  type ChannelDraftResult,
  type ChannelDraftVariant,
  type StudioChannel,
} from '../types'
import { buildChannelCopyText } from './channel-copy'
import { payloadToPreview } from './payload-to-preview'

export interface FourChannelStudioProps {
  workspaceId: string
  fetcher?: typeof fetch
  initialDraft?: ChannelDraftResult | null
  onClose?: () => void
}

const RECOMMENDED_TOPICS = [
  '가게 첫 인사',
  '신메뉴 소개',
  '이번 주 이벤트 안내',
  '단골 고객 혜택 안내',
] as const

const GENERATION_ERRORS: Record<string, string> = {
  KNOWLEDGE_UNAVAILABLE: '가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  KNOWLEDGE_MISSING: '나의 지식에서 가게 정보를 먼저 확인해 주세요.',
  DAILY_LIMIT_REACHED: '하루에 만들 수 있는 글 10개를 모두 사용했어요.',
  VALIDATION_FAILED: '주제와 요청 정보를 확인해 주세요.',
  MODEL_FAILED: '글을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  MODEL_OUTPUT_INVALID: '글 생성 결과를 확인하지 못했어요. 다시 시도해 주세요.',
  PERSISTENCE_FAILED: '글을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.',
  WORKSPACE_FORBIDDEN: '이 매장에 접근할 수 없어요.',
  DRAFT_NOT_FOUND: '수정하려는 글을 찾지 못했어요. 글을 다시 만들어 주세요.',
  EDIT_CONFLICT: '다른 곳에서 먼저 바뀐 글이에요. 글을 다시 만든 뒤 고쳐 주세요.',
  INSUFFICIENT_CREDITS: '이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.',
  CREDIT_UNAVAILABLE: '이용 한도를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
}
const EDIT_ERROR_FALLBACK = '수정한 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const GENERATION_ERROR_FALLBACK = '채널별 글을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'

const CHANNEL_ICONS: Record<StudioChannel, LucideIcon> = {
  instagram: Camera,
  threads: MessageCircle,
  naver_blog: BookOpenText,
  daangn_business: Store,
}

interface ChannelEditState {
  title?: string
  text?: string
  caption?: string
  hashtags?: string
}

function parseHashtags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter((tag) => tag.length > 0)
}

function getOriginalFieldValues(variant: ChannelDraftVariant) {
  const p = variant.payload ?? {}
  const caption = typeof p.caption === 'string' ? p.caption : typeof p.text === 'string' ? p.text : ''
  const text = typeof p.text === 'string' ? p.text : typeof p.caption === 'string' ? p.caption : ''
  const title = typeof p.title === 'string' ? p.title : ''
  const hashtags = Array.isArray(p.hashtags)
    ? p.hashtags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.replace(/^#+/, '').trim())
        .filter(Boolean)
    : []

  return {
    caption,
    text,
    title,
    hashtags,
    hashtagsString: hashtags.map((t) => `#${t}`).join(' '),
  }
}

function computeDirtyEdits(variant: ChannelDraftVariant, edits?: ChannelEditState) {
  if (!edits) {
    return { isDirty: false, changedEdits: {} as Record<string, unknown> }
  }

  const orig = getOriginalFieldValues(variant)
  const changedEdits: Record<string, unknown> = {}
  let isDirty = false

  switch (variant.channel) {
    case 'instagram': {
      if (edits.caption !== undefined && edits.caption !== orig.caption) {
        changedEdits.caption = edits.caption
        isDirty = true
      }
      if (edits.hashtags !== undefined) {
        const parsed = parseHashtags(edits.hashtags)
        const isSame =
          parsed.length === orig.hashtags.length &&
          parsed.every((val, idx) => val === orig.hashtags[idx])
        if (!isSame) {
          changedEdits.hashtags = parsed
          isDirty = true
        }
      }
      break
    }
    case 'threads': {
      if (edits.text !== undefined && edits.text !== orig.text) {
        changedEdits.text = edits.text
        isDirty = true
      }
      break
    }
    case 'naver_blog': {
      if (edits.title !== undefined && edits.title !== orig.title) {
        changedEdits.title = edits.title
        isDirty = true
      }
      if (edits.text !== undefined && edits.text !== orig.text) {
        changedEdits.text = edits.text
        isDirty = true
      }
      break
    }
    case 'daangn_business': {
      if (edits.text !== undefined && edits.text !== orig.text) {
        changedEdits.text = edits.text
        isDirty = true
      }
      break
    }
  }

  return { isDirty, changedEdits }
}

export function FourChannelStudio({
  workspaceId,
  fetcher = fetch,
  initialDraft = null,
  onClose,
}: FourChannelStudioProps) {
  const [topic, setTopic] = useState(initialDraft?.topic ?? '')
  const [includeImage, setIncludeImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ChannelDraftResult | null>(initialDraft)
  const [activeTab, setActiveTab] = useState<number>(0)
  const [savingChannel, setSavingChannel] = useState<StudioChannel | null>(null)
  const [savedChannels, setSavedChannels] = useState<Record<string, boolean>>({})
  const [saveErrors, setSaveErrors] = useState<Record<string, string | null>>({})

  // Copy state
  const [copySuccess, setCopySuccess] = useState(false)
  const [copyFallbackText, setCopyFallbackText] = useState<string | null>(null)
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Direct editing state
  const [editingChannel, setEditingChannel] = useState<StudioChannel | null>(null)
  const [channelEdits, setChannelEdits] = useState<Partial<Record<StudioChannel, ChannelEditState>>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string | null>>({})

  const requestKeyRef = useRef<string | null>(initialDraft?.requestKey ?? null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  async function handleGenerate(isRetry = false) {
    const trimmed = topic.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setIsRegenerating(false)
    setError(null)

    if (!isRetry || !requestKeyRef.current) {
      requestKeyRef.current = crypto.randomUUID()
    }
    const currentKey = requestKeyRef.current

    try {
      const response = await fetcher(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/channel-drafts`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topic: trimmed,
            requestKey: currentKey,
            includeImage,
          }),
        },
      )

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const code = typeof data?.code === 'string' ? data.code : ''
        throw new Error(Object.hasOwn(GENERATION_ERRORS, code) ? GENERATION_ERRORS[code] : GENERATION_ERROR_FALLBACK)
      }

      if (!data.draft || !Array.isArray(data.draft.variants) || data.draft.variants.length !== STUDIO_CHANNELS.length) {
        throw new Error('생성 결과를 확인할 수 없어요. 다시 시도해 주세요.')
      }

      setDraft(data.draft)
      setActiveTab(0)
      setSavedChannels({})
      setSaveErrors({})
      setChannelEdits({})
      setEditingChannel(null)
      setEditErrors({})
      setCopySuccess(false)
      setCopyFallbackText(null)
    } catch (err: any) {
      setError(err?.message ?? '오류가 발생했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRegenerate() {
    if (!draft || busy) return

    setBusy(true)
    setIsRegenerating(true)
    setError(null)

    const newKey = crypto.randomUUID()
    requestKeyRef.current = newKey

    try {
      const response = await fetcher(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/channel-drafts`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topic: draft.topic,
            requestKey: newKey,
            includeImage,
          }),
        },
      )

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const code = typeof data?.code === 'string' ? data.code : ''
        throw new Error(Object.hasOwn(GENERATION_ERRORS, code) ? GENERATION_ERRORS[code] : GENERATION_ERROR_FALLBACK)
      }

      if (!data.draft || !Array.isArray(data.draft.variants) || data.draft.variants.length !== STUDIO_CHANNELS.length) {
        throw new Error('생성 결과를 확인할 수 없어요. 다시 시도해 주세요.')
      }

      setDraft(data.draft)
      setSavedChannels({})
      setSaveErrors({})
      setChannelEdits({})
      setEditingChannel(null)
      setEditErrors({})
      setCopySuccess(false)
      setCopyFallbackText(null)
    } catch (err: any) {
      setError(err?.message ?? '오류가 발생했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
      setIsRegenerating(false)
    }
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const total = STUDIO_CHANNELS.length
    let next: number | null = null

    if (e.key === 'ArrowRight') {
      next = (index + 1) % total
    } else if (e.key === 'ArrowLeft') {
      next = (index - 1 + total) % total
    } else if (e.key === 'Home') {
      next = 0
    } else if (e.key === 'End') {
      next = total - 1
    }

    if (next !== null) {
      e.preventDefault()
      setActiveTab(next)
      setCopySuccess(false)
      setCopyFallbackText(null)
      tabRefs.current[next]?.focus()
    }
  }

  async function handleSaveChannel(variant: ChannelDraftVariant) {
    if (!variant.vaultSavable || !variant.contentId || !variant.versionId || savingChannel) {
      return
    }

    setSavingChannel(variant.channel)
    setSaveErrors((prev) => ({ ...prev, [variant.channel]: null }))

    try {
      const idempotencyKey = crypto.randomUUID()
      const response = await fetcher(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/vault`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contentId: variant.contentId,
            versionId: variant.versionId,
            channels: [variant.channel],
            targetDate: null,
            idempotencyKey,
          }),
        },
      )

      const result = await response.json().catch(() => ({}))
      if (
        !response.ok ||
        !Array.isArray(result.saved) ||
        result.saved.length === 0 ||
        result.external_posts !== 0
      ) {
        throw new Error('보관 결과를 확인할 수 없어요. 잠시 후 다시 확인해 주세요.')
      }

      setSavedChannels((prev) => ({ ...prev, [variant.channel]: true }))
    } catch (err: any) {
      setSaveErrors((prev) => ({
        ...prev,
        [variant.channel]: err?.message ?? '보관하지 못했어요. 다시 시도해 주세요.',
      }))
    } finally {
      setSavingChannel(null)
    }
  }

  function handleCopy(variant: ChannelDraftVariant) {
    const text = buildChannelCopyText(variant.channel, variant.payload)
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopySuccess(true)
          setCopyFallbackText(null)
          copyTimeoutRef.current = setTimeout(() => {
            setCopySuccess(false)
          }, 2000)
        })
        .catch(() => {
          setCopyFallbackText(text)
        })
    } else {
      setCopyFallbackText(text)
    }
  }

  async function handleSaveEdit(variant: ChannelDraftVariant) {
    if (!draft || savingEdit) return
    const { changedEdits } = computeDirtyEdits(variant, channelEdits[variant.channel])
    setSavingEdit(true)
    setEditErrors((prev) => ({ ...prev, [variant.channel]: null }))

    try {
      const response = await fetcher(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/channel-drafts`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestKey: draft.requestKey,
            channel: variant.channel,
            edits: changedEdits,
          }),
        },
      )

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const code = typeof data?.code === 'string' ? data.code : ''
        throw new Error(Object.hasOwn(GENERATION_ERRORS, code) ? GENERATION_ERRORS[code] : EDIT_ERROR_FALLBACK)
      }

      if (!data.draft || !Array.isArray(data.draft.variants)) {
        throw new Error('수정 결과를 확인할 수 없어요. 다시 시도해 주세요.')
      }

      setDraft(data.draft)
      // An edit creates a new version; the earlier vault copy no longer matches what is on screen.
      setSavedChannels((prev) => ({ ...prev, [variant.channel]: false }))
      setEditingChannel(null)
      setChannelEdits((prev) => {
        const next = { ...prev }
        delete next[variant.channel]
        return next
      })
    } catch (err: any) {
      setEditErrors((prev) => ({
        ...prev,
        [variant.channel]: err?.message ?? EDIT_ERROR_FALLBACK,
      }))
    } finally {
      setSavingEdit(false)
    }
  }

  const currentVariant =
    draft?.variants.find((v) => v.channel === STUDIO_CHANNELS[activeTab]) ?? draft?.variants[activeTab]
  const readyCount = draft?.variants.filter((v) => v.status === 'READY').length ?? 0
  const totalCount = draft?.variants.length ?? 0

  const currentOrig = currentVariant ? getOriginalFieldValues(currentVariant) : null
  const currentEdits = currentVariant ? channelEdits[currentVariant.channel] : undefined
  const { isDirty: currentIsDirty } = currentVariant
    ? computeDirtyEdits(currentVariant, currentEdits)
    : { isDirty: false }

  const isEditingCurrent = currentVariant ? editingChannel === currentVariant.channel : false

  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <header className="relative border-b bg-gradient-to-br from-accent via-card to-card px-5 py-6 sm:px-8 sm:py-7">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm"
          >
            <Sparkles className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs font-semibold tracking-wide text-primary">소희가 대신 써 드려요</p>
            <h2 className="text-balance text-xl font-bold tracking-tight sm:text-2xl">4채널 글 만들기</h2>
            <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
              사장님의 가게 지식과 말투로 인스타그램, 스레드, 네이버 블로그, 당근 비즈프로필 맞춤 글을 한 번에 만들어요.
            </p>
            <p className="inline-flex max-w-full items-center gap-1.5 rounded-2xl border border-primary/25 bg-card/80 px-3 py-1.5 text-xs font-medium leading-snug text-accent-foreground break-keep">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
              미리보기만 해요 · 실제 SNS에는 올라가지 않아요
            </p>
          </div>
          {onClose && (
            <Button type="button" variant="ghost" size="sm" onClick={onClose} className="min-h-11 shrink-0">
              닫기
            </Button>
          )}
        </div>
      </header>

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Composer */}
        <section aria-label="글 작성" className="space-y-3">
          <label htmlFor="studio-topic-input" className="block text-sm font-semibold">
            어떤 소식을 전할까요?
          </label>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <input
              id="studio-topic-input"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleGenerate(false)
                }
              }}
              placeholder="예: 이번 주 새로 나온 딸기 케이크를 소개해 주세요"
              maxLength={300}
              disabled={busy}
              className="min-h-12 flex-1 rounded-2xl border border-input bg-background px-4 text-sm shadow-xs transition-shadow placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:opacity-60"
            />
            <Button
              type="button"
              onClick={() => void handleGenerate(false)}
              disabled={busy || !topic.trim()}
              className="min-h-12 shrink-0 rounded-2xl px-6 text-sm font-semibold shadow-sm"
            >
              {busy && !isRegenerating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  만드는 중…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" aria-hidden="true" />
                  채널별 글 만들기
                </>
              )}
            </Button>
          </div>

          <label className="flex min-h-11 items-center gap-3 rounded-2xl border bg-background px-4 text-sm">
            <input
              type="checkbox"
              checked={includeImage}
              onChange={(event) => setIncludeImage(event.target.checked)}
              disabled={busy}
              className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            사진도 함께 만들기 (조금 더 걸려요)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">추천 주제</span>
            {RECOMMENDED_TOPICS.map((rec) => (
              <button
                key={rec}
                type="button"
                onClick={() => setTopic(rec)}
                disabled={busy}
                className="min-h-11 rounded-full border bg-background px-3.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {rec}
              </button>
            ))}
          </div>
        </section>

        {/* Generating (initial generation only) */}
        {busy && !isRegenerating && (
          <div className="space-y-4 animate-in fade-in-0 motion-reduce:animate-none">
            <div
              role="status"
              className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-accent/60 p-4 text-sm"
            >
              <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              <span>사장님 가게 지식에 맞춰 4개 채널별 글과 예상 화면을 준비하고 있어요…</span>
            </div>
            <div aria-hidden="true" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <Skeleton className="h-72 rounded-2xl" />
              <div className="space-y-3">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !busy && (
          <div
            role="alert"
            className="flex flex-col justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
              <span className="font-medium text-destructive">{error}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleGenerate(true)}
              className="min-h-11 shrink-0 self-end border-destructive/30 text-destructive hover:bg-destructive/10 sm:self-auto"
            >
              다시 시도
            </Button>
          </div>
        )}

        {/* Result */}
        {draft && (!busy || isRegenerating) && (
          <section aria-label="생성 결과" className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
            {/* Summary bar + Regenerate */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2
                  className={cn('size-4 shrink-0', readyCount > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}
                  aria-hidden="true"
                />
                <span>
                  {totalCount}개 채널 중 <strong className="font-semibold text-foreground">{readyCount}개</strong>가 규격 확인을 마쳤어요.
                  {readyCount < totalCount && ' 나머지는 아래 안내를 확인해 주세요.'}
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleRegenerate()}
                className="min-h-11 shrink-0 rounded-xl px-4 text-xs font-semibold"
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    다시 만드는 중…
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-2 size-4" aria-hidden="true" />
                    같은 주제로 다시 만들기
                  </>
                )}
              </Button>
            </div>

            {/* Channel tabs */}
            <div role="tablist" aria-label="채널 선택" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {STUDIO_CHANNELS.map((ch, idx) => {
                const variant = draft.variants.find((v) => v.channel === ch)
                const isSelected = activeTab === idx
                const isReady = variant?.status === 'READY'
                const Icon = CHANNEL_ICONS[ch]

                return (
                  <button
                    key={ch}
                    ref={(el) => {
                      tabRefs.current[idx] = el
                    }}
                    role="tab"
                    type="button"
                    id={`studio-tab-${ch}`}
                    aria-selected={isSelected}
                    aria-controls={`studio-panel-${ch}`}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => {
                      setActiveTab(idx)
                      setCopySuccess(false)
                      setCopyFallbackText(null)
                    }}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                    className={cn(
                      'group flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected
                        ? 'border-primary bg-accent shadow-sm ring-1 ring-primary/30'
                        : 'bg-background hover:border-primary/40 hover:bg-accent/40',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-xl transition-colors',
                        isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block break-keep text-sm leading-tight', isSelected ? 'font-semibold' : 'font-medium')}>
                        {STUDIO_CHANNEL_LABELS[ch]}
                      </span>
                      {variant && (
                        <span
                          className={cn(
                            'mt-0.5 flex items-center gap-1 text-xs font-medium',
                            isReady ? 'text-emerald-800 dark:text-emerald-400' : 'text-amber-800 dark:text-amber-400',
                          )}
                        >
                          {isReady ? (
                            <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
                          ) : (
                            <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
                          )}
                          <span className="break-keep leading-tight">
                            {variant.statusLabel || (isReady ? '규격 확인 완료' : '확인이 필요해요')}
                          </span>
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Panel: stage + rail */}
            {currentVariant && (
              <div
                role="tabpanel"
                id={`studio-panel-${currentVariant.channel}`}
                aria-labelledby={`studio-tab-${currentVariant.channel}`}
                className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
              >
                {/* Stage */}
                <div className="min-w-0 rounded-3xl border bg-muted/40 bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_65%)] p-3 sm:p-6">
                  <div className="mx-auto w-full max-w-[420px]">
                    <ChannelPreview {...payloadToPreview(currentVariant.channel, currentVariant.payload)} />
                  </div>
                </div>

                {/* Rail */}
                <aside aria-label="검사와 보관" className="min-w-0 space-y-3">
                  <div className="space-y-3 rounded-2xl border bg-background p-4">
                    {/* Status header */}
                    <div className="flex items-center gap-2">
                      {currentVariant.status === 'READY' ? (
                        <CheckCircle2 className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                      )}
                      <p className="text-sm font-semibold">
                        {STUDIO_CHANNEL_LABELS[currentVariant.channel]} ·{' '}
                        {currentVariant.statusLabel || (currentVariant.status === 'READY' ? '규격 확인 완료' : '확인이 필요해요')}
                      </p>
                    </div>

                    {/* Issues */}
                    {currentVariant.issues.length > 0 && (
                      <ul className="space-y-1.5 rounded-xl bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                        {currentVariant.issues.map((issue, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span aria-hidden="true">·</span>
                            <span>{issue}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Unsaved changes notice */}
                    {currentIsDirty && (
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        저장하지 않은 수정이 있어요
                      </p>
                    )}

                    {/* Copy action */}
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleCopy(currentVariant)}
                        className="min-h-11 w-full rounded-xl text-xs font-semibold"
                      >
                        <Copy className="mr-2 size-4" aria-hidden="true" />
                        글 복사하기
                      </Button>
                      {copySuccess && (
                        <div
                          role="status"
                          className="rounded-xl border border-emerald-600/25 bg-emerald-500/10 p-2.5 text-center text-xs font-medium text-emerald-900 dark:text-emerald-200"
                        >
                          복사했어요
                        </div>
                      )}
                      {copyFallbackText !== null && (
                        <div className="space-y-1.5 rounded-xl border bg-muted/40 p-3">
                          <label
                            htmlFor={`studio-copy-fallback-${currentVariant.channel}`}
                            className="block text-xs font-medium text-muted-foreground"
                          >
                            직접 선택해서 복사해 주세요
                          </label>
                          <textarea
                            id={`studio-copy-fallback-${currentVariant.channel}`}
                            readOnly
                            value={copyFallbackText}
                            onFocus={(e) => e.currentTarget.select()}
                            rows={4}
                            className="w-full resize-none rounded-lg border bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </div>
                      )}
                    </div>

                    {/* Direct edit toggle & panel */}
                    <div className="space-y-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (isEditingCurrent) {
                            setEditingChannel(null)
                          } else {
                            setEditingChannel(currentVariant.channel)
                            setEditErrors((prev) => ({ ...prev, [currentVariant.channel]: null }))
                          }
                        }}
                        aria-expanded={isEditingCurrent}
                        className="min-h-11 w-full rounded-xl text-xs font-semibold"
                      >
                        <PenLine className="mr-2 size-4" aria-hidden="true" />
                        {isEditingCurrent ? '수정 접기' : '직접 고치기'}
                      </Button>

                      {isEditingCurrent && currentOrig && (
                        <div className="space-y-3 rounded-xl border bg-muted/20 p-3.5">
                          {/* Instagram edit inputs */}
                          {currentVariant.channel === 'instagram' && (
                            <>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label
                                    htmlFor={`edit-caption-${currentVariant.channel}`}
                                    className="text-xs font-semibold"
                                  >
                                    캡션
                                  </label>
                                  <span className="text-[11px] text-muted-foreground">
                                    {(currentEdits?.caption ?? currentOrig.caption).length}자
                                  </span>
                                </div>
                                <textarea
                                  id={`edit-caption-${currentVariant.channel}`}
                                  value={currentEdits?.caption ?? currentOrig.caption}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setChannelEdits((prev) => ({
                                      ...prev,
                                      [currentVariant.channel]: {
                                        ...prev[currentVariant.channel],
                                        caption: val,
                                      },
                                    }))
                                  }}
                                  rows={4}
                                  className="min-h-[44px] w-full rounded-xl border border-input bg-background p-3 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label
                                    htmlFor={`edit-hashtags-${currentVariant.channel}`}
                                    className="text-xs font-semibold"
                                  >
                                    해시태그 (공백 또는 쉼표로 구분)
                                  </label>
                                  <span className="text-[11px] text-muted-foreground">
                                    {parseHashtags(currentEdits?.hashtags ?? currentOrig.hashtagsString).length}개
                                  </span>
                                </div>
                                <input
                                  id={`edit-hashtags-${currentVariant.channel}`}
                                  type="text"
                                  value={currentEdits?.hashtags ?? currentOrig.hashtagsString}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setChannelEdits((prev) => ({
                                      ...prev,
                                      [currentVariant.channel]: {
                                        ...prev[currentVariant.channel],
                                        hashtags: val,
                                      },
                                    }))
                                  }}
                                  placeholder="예: 딸기케이크 맛집 카페"
                                  className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                              </div>
                            </>
                          )}

                          {/* Threads edit inputs */}
                          {currentVariant.channel === 'threads' && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <label
                                  htmlFor={`edit-text-${currentVariant.channel}`}
                                  className="text-xs font-semibold"
                                >
                                  본문
                                </label>
                                <span className="text-[11px] text-muted-foreground">
                                  {(currentEdits?.text ?? currentOrig.text).length}자
                                </span>
                              </div>
                              <textarea
                                id={`edit-text-${currentVariant.channel}`}
                                value={currentEdits?.text ?? currentOrig.text}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setChannelEdits((prev) => ({
                                    ...prev,
                                    [currentVariant.channel]: {
                                      ...prev[currentVariant.channel],
                                      text: val,
                                    },
                                  }))
                                }}
                                rows={5}
                                className="min-h-[44px] w-full rounded-xl border border-input bg-background p-3 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              />
                            </div>
                          )}

                          {/* Naver blog edit inputs */}
                          {currentVariant.channel === 'naver_blog' && (
                            <>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label
                                    htmlFor={`edit-title-${currentVariant.channel}`}
                                    className="text-xs font-semibold"
                                  >
                                    제목
                                  </label>
                                  <span className="text-[11px] text-muted-foreground">
                                    {(currentEdits?.title ?? currentOrig.title).length}자
                                  </span>
                                </div>
                                <input
                                  id={`edit-title-${currentVariant.channel}`}
                                  type="text"
                                  value={currentEdits?.title ?? currentOrig.title}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setChannelEdits((prev) => ({
                                      ...prev,
                                      [currentVariant.channel]: {
                                        ...prev[currentVariant.channel],
                                        title: val,
                                      },
                                    }))
                                  }}
                                  className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label
                                    htmlFor={`edit-text-${currentVariant.channel}`}
                                    className="text-xs font-semibold"
                                  >
                                    본문
                                  </label>
                                  <span className="text-[11px] text-muted-foreground">
                                    {(currentEdits?.text ?? currentOrig.text).length}자
                                  </span>
                                </div>
                                <textarea
                                  id={`edit-text-${currentVariant.channel}`}
                                  value={currentEdits?.text ?? currentOrig.text}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setChannelEdits((prev) => ({
                                      ...prev,
                                      [currentVariant.channel]: {
                                        ...prev[currentVariant.channel],
                                        text: val,
                                      },
                                    }))
                                  }}
                                  rows={5}
                                  className="min-h-[44px] w-full rounded-xl border border-input bg-background p-3 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                              </div>
                            </>
                          )}

                          {/* Daangn edit inputs */}
                          {currentVariant.channel === 'daangn_business' && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <label
                                  htmlFor={`edit-text-${currentVariant.channel}`}
                                  className="text-xs font-semibold"
                                >
                                  본문
                                </label>
                                <span className="text-[11px] text-muted-foreground">
                                  {(currentEdits?.text ?? currentOrig.text).length}자
                                </span>
                              </div>
                              <textarea
                                id={`edit-text-${currentVariant.channel}`}
                                value={currentEdits?.text ?? currentOrig.text}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setChannelEdits((prev) => ({
                                    ...prev,
                                    [currentVariant.channel]: {
                                      ...prev[currentVariant.channel],
                                      text: val,
                                    },
                                  }))
                                }}
                                rows={5}
                                className="min-h-[44px] w-full rounded-xl border border-input bg-background p-3 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              />
                            </div>
                          )}

                          {/* Save & verify button */}
                          <Button
                            type="button"
                            disabled={savingEdit || !currentIsDirty}
                            onClick={() => void handleSaveEdit(currentVariant)}
                            className="min-h-11 w-full rounded-xl text-xs font-semibold"
                          >
                            {savingEdit ? (
                              <>
                                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                                저장하고 다시 확인하는 중…
                              </>
                            ) : (
                              '저장하고 다시 확인'
                            )}
                          </Button>

                          {editErrors[currentVariant.channel] && (
                            <p role="alert" className="text-xs font-medium leading-relaxed text-destructive">
                              {editErrors[currentVariant.channel]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Vault save action */}
                    {savedChannels[currentVariant.channel] ? (
                      <div className="space-y-2 rounded-xl border border-emerald-600/25 bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
                        <p className="flex items-center gap-2 font-semibold">
                          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                          보관했어요 · 외부 게시 전
                        </p>
                        <Link
                          href="/app/vault"
                          className="inline-flex min-h-11 items-center gap-0.5 text-xs font-semibold underline underline-offset-2 hover:no-underline"
                        >
                          보관함에서 확인하기
                          <ChevronRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Button
                          type="button"
                          onClick={() => void handleSaveChannel(currentVariant)}
                          disabled={
                            !currentVariant.vaultSavable ||
                            savingChannel === currentVariant.channel ||
                            isEditingCurrent ||
                            currentIsDirty ||
                            savingEdit
                          }
                          className="min-h-12 w-full rounded-xl font-semibold"
                        >
                          {savingChannel === currentVariant.channel ? (
                            <>
                              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                              보관하는 중…
                            </>
                          ) : (
                            '이 채널 글 보관하기'
                          )}
                        </Button>
                        {(isEditingCurrent || currentIsDirty) && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            수정한 내용을 먼저 저장하고 확인해 주세요.
                          </p>
                        )}
                        {!currentVariant.vaultSavable && !isEditingCurrent && !currentIsDirty && currentVariant.blockedReason && (
                          <p className="text-xs leading-relaxed text-muted-foreground">{currentVariant.blockedReason}</p>
                        )}
                        {saveErrors[currentVariant.channel] && (
                          <p role="alert" className="text-xs leading-relaxed text-destructive">
                            {saveErrors[currentVariant.channel]}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {(draft.basisNotes.length > 0 || draft.imageNotice) && (
                    <div className="space-y-2 rounded-2xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
                      {draft.basisNotes.length > 0 && (
                        <div>
                          <p className="flex items-center gap-1.5 font-semibold text-foreground">
                            <Info className="size-3.5 text-primary" aria-hidden="true" />
                            이 글의 기준
                          </p>
                          <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                            {draft.basisNotes.map((note, idx) => (
                              <li key={idx}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {draft.imageNotice && <p className="text-amber-900 dark:text-amber-300">· {draft.imageNotice}</p>}
                    </div>
                  )}
                </aside>
              </div>
            )}

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              * 모든 채널 화면은 실제 SNS 게시 화면과 다를 수 있는 예상 화면입니다. 소희는 사장님의 동의 없이 외부 SNS에 자동으로 글을 올리지 않습니다.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
