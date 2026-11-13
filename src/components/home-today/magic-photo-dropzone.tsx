'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ImagePlus, Loader2, MessageSquareText, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { MediaUploadCard } from '@/features/media/media-upload-card'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { boundedMobileRead } from '@/features/mobile-shell/bounded-mobile-read'
import { cn } from '@/lib/utils'

export interface MagicPhotoDropzoneProps {
  workspaceId: string
  density?: 'compact' | 'detailed'
  fetcher?: typeof fetch
  onPrepared?: (missionId: string) => void
}

type Operation = { fingerprint: string; id: string; attempted: boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function MagicPhotoDropzone(props: MagicPhotoDropzoneProps) {
  const context = useOptionalWorkspaceContext()
  return <PhotoPreparation key={`${props.workspaceId}:${context?.actorId ?? ''}`} {...props} />
}

function PhotoPreparation({ workspaceId, density = 'compact', fetcher = fetch, onPrepared }: MagicPhotoDropzoneProps) {
  const context = useOptionalWorkspaceContext()
  const router = useRouter()
  const canManage = context?.workspaceId === workspaceId && ['owner', 'manager'].includes(context.membershipRole)
  const [open, setOpen] = useState(false)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [photoVersion, setPhotoVersion] = useState(0)
  const [topic, setTopic] = useState('')
  const [quote, setQuote] = useState<number | null>(null)
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [quoteError, setQuoteError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const operation = useRef<Operation | null>(null)
  const locked = useRef(false)
  const active = useRef(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const requestController = useRef<AbortController | null>(null)
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/quick-post`

  useEffect(() => {
    active.current = true
    return () => { active.current = false; requestController.current?.abort() }
  }, [])

  useEffect(() => {
    if (!open || !canManage) return
    const controller = new AbortController()
    void (async () => {
      try {
        const cost = await boundedMobileRead(`${endpoint}?limit=1`, async response => {
          const body = await response.json()
          const cost = body?.credits?.photoDraftCost
          if (!response.ok || typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 0) throw new Error('quote unavailable')
          return cost
        }, controller.signal, fetcher)
        if (!controller.signal.aborted && active.current) { setQuote(cost); setQuoteError('') }
      } catch {
        if (!controller.signal.aborted && active.current) { setQuote(null); setQuoteError('제작 비용을 확인하지 못했어요. 다시 확인해 주세요.') }
      }
    })()
    return () => controller.abort()
  }, [open, canManage, endpoint, fetcher, quoteAttempt])

  function selectPhoto(id: string | null) {
    if (locked.current || pending) return
    setSourceId(id && UUID.test(id) ? id : null)
    operation.current = null
    setError('')
  }

  async function prepare() {
    if (!canManage || !sourceId || quote === null || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    const fingerprint = JSON.stringify([workspaceId, sourceId, topic.trim()])
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID(), attempted: false }
    const current = operation.current
    const controller = new AbortController()
    requestController.current = controller
    const deadline = setTimeout(() => controller.abort(), 90_000)
    async function readStored() {
      const response = await fetcher(`${endpoint}/${current.id}`, { cache: 'no-store', signal: controller.signal })
      if (response.status === 404) return false
      const body = await response.json()
      if (!response.ok || body?.item?.missionId !== current.id) throw new Error('저장한 글 초안을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.')
      if (!Array.isArray(body.item.imageIds) || body.item.imageIds.length !== 1 || body.item.imageIds[0] !== sourceId) throw new Error('선택한 원본 사진을 저장된 원고에서 확인하지 못했어요. 작업 탭에서 원고를 확인해 주세요.')
      return true
    }
    try {
      let stored = current.attempted ? await readStored() : false
      if (!active.current || controller.signal.aborted) return
      if (!stored) {
        current.attempted = true
        setPending(true)
        const response = await fetcher(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ topic: topic.trim(), requestId: current.id, sourceAssetIds: [sourceId], maxDraftCredits: quote }),
        })
        const body = await response.json()
        if (!active.current || controller.signal.aborted) return
        if (!response.ok) {
          if (response.status === 400 && body?.code === 'SOURCE_MEDIA_NOT_READY') {
            current.attempted = false
            setPending(false)
            setSourceId(null)
            setPhotoVersion(value => value + 1)
            throw new Error('사진의 저장 상태와 사용 권리를 확인한 뒤 다시 선택해 주세요.')
          }
          if (body?.code === 'DRAFT_COST_CHANGED') { current.attempted = false; setPending(false); setQuote(null); setQuoteError('제작 비용을 확인하지 못했어요. 다시 확인해 주세요.') }
          throw new Error(body?.code === 'DRAFT_COST_CHANGED' ? '제작 비용이 바뀌었어요. 새 비용을 확인하고 다시 요청해 주세요.' : '글 초안 준비 결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.')
        }
        if (body?.item?.missionId !== current.id) throw new Error('글 초안 준비 결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.')
        stored = await readStored()
      }
      if (!active.current || controller.signal.aborted) return
      if (!stored) throw new Error('저장한 글 초안을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.')
      if (onPrepared) onPrepared(current.id)
      else router.push(`/start/preview?missionId=${encodeURIComponent(current.id)}`)
    } catch (reason) {
      if (active.current) setError(reason instanceof Error && reason.name !== 'AbortError' ? reason.message : '요청 결과를 아직 확인하지 못했어요. 잠시 후 다시 확인해 주세요.')
    } finally {
      clearTimeout(deadline)
      locked.current = false
      if (active.current) setBusy(false)
    }
  }

  return (
    <section
      aria-label="사진 콘텐츠 준비"
      className="overflow-hidden rounded-2xl border border-border/80 bg-card transition-colors shadow-xs"
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={!canManage || busy}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-4">
            <ImagePlus aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-tight tracking-tight text-foreground">
              사진으로 글 만들기
            </span>
            <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
              사진 한 장이면 소식 글 초안을 준비해요
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          <ChevronRight className="size-4" aria-hidden="true" />
        </span>
      </button>

      {!canManage ? (
        <p className="px-4 pb-4 text-[13px] text-muted-foreground">
          현재 가게의 관리자 권한을 확인한 뒤 사진으로 글을 만들 수 있어요.
        </p>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[92dvh] flex-col gap-0 rounded-t-3xl p-0"
          onCloseAutoFocus={e => {
            e.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" aria-hidden="true" />
          <SheetClose asChild>
            <button
              type="button"
              aria-label="닫기"
              className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </SheetClose>
          <SheetHeader className="px-5 pt-2 pb-3 pr-14 text-left">
            <SheetTitle className="text-lg font-semibold">사진으로 글 만들기</SheetTitle>
            <SheetDescription className="sr-only">
              사장님 사진 한 장으로 글 초안을 만들어요. 올리기 전에 꼭 확인하실 수 있어요.
            </SheetDescription>
            <div
              role="img"
              aria-label={sourceId ? '2단계 소식 적기' : '1단계 사진 고르기'}
              className="flex items-center gap-1.5 pt-1.5"
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  sourceId ? 'w-1.5 bg-muted-foreground/30' : 'w-6 bg-primary',
                )}
              />
              <span
                className={cn(
                  'h-1.5 rounded-full transition-all duration-200',
                  sourceId ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                )}
              />
            </div>
          </SheetHeader>

          {canManage ? (
            <>
              <div className={cn('flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-4', density === 'detailed' ? 'p-2' : '')}>
                <fieldset disabled={busy || pending} className="flex min-w-0 flex-col gap-3">
                  <MediaUploadCard key={photoVersion} workspaceId={workspaceId} requirePhoto purpose="draft" onSelectionChange={selectPhoto} fetcher={fetcher} />
                  <div className="relative">
                    <div className="pointer-events-none absolute left-3 top-3 text-muted-foreground">
                      <MessageSquareText className="size-4" aria-hidden="true" />
                    </div>
                    <textarea
                      aria-label="전하고 싶은 소식 (선택)"
                      className="min-h-20 w-full rounded-2xl border border-border bg-background pl-9 pr-3 pt-2.5 pb-6 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      maxLength={300}
                      placeholder="한 줄 소식 (선택)"
                      value={topic}
                      onChange={event => setTopic(event.target.value)}
                    />
                    <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
                      {topic.length}/300
                    </span>
                  </div>
                </fieldset>
                {quote !== null ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      사진 원본 그대로
                    </span>
                    <span>준비한 내용은 게시 전에 확인해요</span>
                  </div>
                ) : null}
                {quoteError ? (
                  <div className="flex flex-col gap-2">
                    <p role="status" className="text-sm text-destructive">{quoteError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => { setQuote(null); setQuoteError(''); setQuoteAttempt(value => value + 1) }}
                      className="w-fit gap-1.5 rounded-xl"
                    >
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                      다시 확인
                    </Button>
                  </div>
                ) : null}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              </div>

              <div
                data-testid="photo-post-footer"
                className="border-t bg-background/95 backdrop-blur px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
              >
                <Button
                  type="button"
                  disabled={busy || !sourceId || quote === null}
                  onClick={() => void prepare()}
                  className="h-12 w-full rounded-2xl text-base font-medium gap-2"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="size-4" aria-hidden="true" />
                  )}
                  {busy
                    ? '원고 요청 결과 확인 중'
                    : pending
                      ? '저장 상태 다시 확인'
                      : '글 초안 만들기'}
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  )
}
