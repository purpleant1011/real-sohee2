'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Images,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { NaverPostForCopy } from '../copy-naver-post'
import {
  buildGalleryPlainText,
  copyPreparedPost as defaultCopyPreparedPost,
  evictPreparedAsset,
  getOrStartPreparedAssets,
  prepareOneShotAssets as defaultPrepareOneShotAssets,
  sharePreparedPhotos as defaultSharePreparedPhotos,
  type OneShotAssets,
  type OneShotCopyOutcome,
  type SharePhotosOutcome,
} from '../one-shot-handoff'

export const NAVER_BLOG_APP_URL = 'naverblog://'
export const NAVER_BLOG_WEB_WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver'

function subscribeToDesktopChange(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia('(pointer: coarse)')
  mql.addEventListener?.('change', onStoreChange)
  return () => {
    mql.removeEventListener?.('change', onStoreChange)
  }
}

function getDesktopSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  let canShareFiles = false
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
      const testFile = new File([''], 'test.png', { type: 'image/png' })
      canShareFiles = Boolean(navigator.canShare({ files: [testFile] }))
    }
  } catch {
    canShareFiles = false
  }
  const isCoarse = Boolean(
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
  return !canShareFiles || !isCoarse
}

function getServerDesktopSnapshot(): boolean {
  return false
}

export type NaverOneShotCardDeps = Readonly<{
  prepare?: (post: NaverPostForCopy, options?: { signal?: AbortSignal }) => Promise<OneShotAssets>
  copy?: (assets: OneShotAssets, post: NaverPostForCopy) => Promise<OneShotCopyOutcome>
  share?: (assets: OneShotAssets) => Promise<SharePhotosOutcome>
  isDesktop?: boolean
}>

export type NaverOneShotCardProps = Readonly<{
  post: NaverPostForCopy
  cacheKey?: string
  writeUrl?: string
  appUrl?: string
  compact?: boolean
  deps?: NaverOneShotCardDeps
  onDownloadZip?: () => void | Promise<void>
  downloading?: boolean
}>

export function NaverOneShotCard({
  post,
  cacheKey,
  writeUrl,
  appUrl,
  compact = false,
  deps,
  onDownloadZip,
  downloading = false,
}: NaverOneShotCardProps) {
  const webWriteUrl = writeUrl || NAVER_BLOG_WEB_WRITE_URL
  const targetAppUrl = appUrl || NAVER_BLOG_APP_URL
  const initialPhotoCount = post.media?.length ?? post.imageUrls?.length ?? 0
  const [prepareStatus, setPrepareStatus] = useState<'preparing' | 'ready' | 'error'>('preparing')
  const [assets, setAssets] = useState<OneShotAssets | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)

  const [copying, setCopying] = useState(false)
  const [copyOutcome, setCopyOutcome] = useState<OneShotCopyOutcome | null>(null)

  const [sharing, setSharing] = useState(false)
  const [shareOutcome, setShareOutcome] = useState<SharePhotosOutcome | null>(null)

  const detectedDesktop = useSyncExternalStore(
    subscribeToDesktopChange,
    getDesktopSnapshot,
    getServerDesktopSnapshot,
  )
  const [zipStatus, setZipStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle')
  const [zipError, setZipError] = useState<string | null>(null)
  const [internalDownloadingZip, setInternalDownloadingZip] = useState(false)
  const isZipDownloading = Boolean(downloading || internalDownloadingZip || zipStatus === 'downloading')

  const isPc = deps?.isDesktop !== undefined
    ? deps.isDesktop
    : detectedDesktop || shareOutcome === 'unsupported'

  const postId = 'id' in post && typeof (post as { id?: unknown }).id === 'string' ? (post as { id: string }).id : ''
  const postVersionId = 'versionId' in post && typeof (post as { versionId?: unknown }).versionId === 'string' ? (post as { versionId: string }).versionId : ''
  const effectiveKey = cacheKey || (postId && postVersionId ? `${postId}:${postVersionId}` : '')

  const handleRetryPrepare = () => {
    setPrepareStatus('preparing')
    setPrepareError(null)
    if (effectiveKey) {
      evictPreparedAsset(effectiveKey)
    }
    const prepareFn = deps?.prepare ?? ((p) => (effectiveKey ? getOrStartPreparedAssets(effectiveKey, p) : defaultPrepareOneShotAssets(p)))
    try {
      const promise = prepareFn(post)
      promise
        .then((result) => {
          setAssets(result)
          setPrepareStatus('ready')
        })
        .catch((err) => {
          setPrepareStatus('error')
          setPrepareError(err?.message || '사진을 준비하지 못했어요.')
        })
    } catch (err: any) {
      setPrepareStatus('error')
      setPrepareError(err?.message || '사진을 준비하지 못했어요.')
    }
  }

  useEffect(() => {
    let ignore = false
    const prepareFn = deps?.prepare ?? ((p) => (effectiveKey ? getOrStartPreparedAssets(effectiveKey, p) : defaultPrepareOneShotAssets(p)))

    Promise.resolve()
      .then(() => prepareFn(post))
      .then((result) => {
        if (ignore) return
        setAssets(result)
        setPrepareStatus('ready')
      })
      .catch((err: any) => {
        if (ignore) return
        setPrepareStatus('error')
        setPrepareError(err?.message || '사진을 준비하지 못했어요.')
      })

    return () => {
      ignore = true
    }
  }, [deps?.prepare, post, effectiveKey])

  // ①② 한 번에 준비: 클릭 핸들러 안에서 copyPreparedPost와 sharePreparedPhotos를 연달아 동기 호출
  const handlePrepareAll = () => {
    if (!assets || copying || sharing) return
    setCopying(true)
    setSharing(true)

    const copyFn = deps?.copy ?? defaultCopyPreparedPost
    const shareFn = deps?.share ?? defaultSharePreparedPhotos

    // 1) 글+서식 복사 (동기 호출 시작)
    try {
      const copyPromise = copyFn(assets, post)
      copyPromise
        .then((outcome) => {
          setCopyOutcome(outcome)
        })
        .catch(() => {
          setCopyOutcome({ status: 'failed', photos: 0 })
        })
        .finally(() => {
          setCopying(false)
        })
    } catch {
      setCopyOutcome({ status: 'failed', photos: 0 })
      setCopying(false)
    }

    // 2) 사진 일괄 공유/저장 시트 (동기 호출 시작 - user activation 유지)
    try {
      const sharePromise = shareFn(assets)
      sharePromise
        .then((outcome) => {
          if (outcome === 'cancelled') {
            setShareOutcome(null)
          } else {
            setShareOutcome(outcome)
          }
        })
        .catch(() => {
          setShareOutcome('failed')
        })
        .finally(() => {
          setSharing(false)
        })
    } catch {
      setShareOutcome('failed')
      setSharing(false)
    }
  }

  // PC 전용 1단계 핸들러: 글 복사(동기)와 사진 ZIP 받기(동기)를 한 번에 실행
  const handlePrepareAllPc = () => {
    if (!assets || copying || isZipDownloading) return
    setCopying(true)

    const copyFn = deps?.copy ?? defaultCopyPreparedPost

    // 1) 글+서식 복사 (동기 호출 시작)
    try {
      const copyPromise = copyFn(assets, post)
      copyPromise
        .then((outcome) => {
          setCopyOutcome(outcome)
        })
        .catch(() => {
          setCopyOutcome({ status: 'failed', photos: 0 })
        })
        .finally(() => {
          setCopying(false)
        })
    } catch {
      setCopyOutcome({ status: 'failed', photos: 0 })
      setCopying(false)
    }

    // 2) ZIP 다운로드 (동기 호출 시작)
    if (onDownloadZip) {
      setZipError(null)
      setZipStatus('downloading')
      setInternalDownloadingZip(true)
      try {
        const res = onDownloadZip()
        if (res && typeof (res as Promise<void>).then === 'function') {
          ;(res as Promise<void>)
            .then(() => {
              setZipStatus('done')
            })
            .catch((err: any) => {
              setZipStatus('error')
              setZipError(err?.message || 'ZIP 파일을 준비하지 못했어요. 다시 시도해 주세요.')
            })
            .finally(() => {
              setInternalDownloadingZip(false)
            })
        } else {
          setZipStatus('done')
          setInternalDownloadingZip(false)
        }
      } catch (err: any) {
        setZipStatus('error')
        setZipError(err?.message || 'ZIP 파일을 준비하지 못했어요. 다시 시도해 주세요.')
        setInternalDownloadingZip(false)
      }
    }
  }

  // 사진 저장 실패/미지원 시 사진만 재시도하는 보조 핸들러
  const handleRetryShareOnly = () => {
    if (!assets || sharing) return
    setSharing(true)
    const shareFn = deps?.share ?? defaultSharePreparedPhotos
    try {
      const sharePromise = shareFn(assets)
      sharePromise
        .then((outcome) => {
          if (outcome === 'cancelled') {
            setShareOutcome(null)
          } else {
            setShareOutcome(outcome)
          }
        })
        .catch(() => {
          setShareOutcome('failed')
        })
        .finally(() => {
          setSharing(false)
        })
    } catch {
      setShareOutcome('failed')
      setSharing(false)
    }
  }

  const handleDownloadZip = async () => {
    if (!onDownloadZip || isZipDownloading) return
    setZipError(null)
    setZipStatus('downloading')
    setInternalDownloadingZip(true)
    try {
      const res = onDownloadZip()
      if (res && typeof (res as Promise<void>).then === 'function') {
        await res
      }
      setZipStatus('done')
    } catch (err: any) {
      setZipStatus('error')
      setZipError(err?.message || 'ZIP 파일을 준비하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setInternalDownloadingZip(false)
    }
  }

  const photoCount = assets?.photoCount ?? initialPhotoCount
  const fullText = buildGalleryPlainText(post)

  const copyFailed =
    copyOutcome?.status === 'denied' ||
    copyOutcome?.status === 'unavailable' ||
    copyOutcome?.status === 'failed'

  const isCopySuccess = copyOutcome?.status === 'ok'
  const isWorking = copying || sharing || (isPc && isZipDownloading)
  const showZipButton =
    photoCount > 0 &&
    (shareOutcome === 'unsupported' ||
      shareOutcome === 'failed' ||
      (isPc && (zipStatus !== 'idle' || downloading)))

  return (
    <div
      aria-label="한 번에 올리기 카드"
      className={
        compact
          ? 'rounded-2xl border bg-card p-3 space-y-2.5 shadow-2xs'
          : 'rounded-2xl border bg-card p-4 space-y-3 shadow-2xs'
      }
    >
      {/* 상단 요약 헤더 (한 줄로 제목 + 준비완료 배지) */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <h4 className="text-sm font-bold text-foreground">
          사진 {photoCount}장 · 글 한 번에 붙여넣기
        </h4>
        {prepareStatus === 'ready' ? (
          <Badge variant="secondary" className="text-xs">
            준비 완료
          </Badge>
        ) : null}
      </div>

      {/* 준비 진행바 (준비 중일 때만 표시) */}
      {prepareStatus === 'preparing' ? (
        <div className="space-y-1.5 pt-0.5" role="status" aria-live="polite">
          <Progress value={45} className="h-1.5" />
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground min-h-6">
            <Loader2 className="size-3.5 animate-spin text-primary shrink-0" aria-hidden="true" />
            <span>사진 {photoCount}장 준비 중…</span>
          </div>
        </div>
      ) : null}

      {/* 에러 상태 안내 */}
      {prepareStatus === 'error' ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs space-y-2"
        >
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{prepareError || '원고와 사진을 준비하지 못했어요.'}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetryPrepare}
            className="min-h-11 text-xs"
          >
            <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
            다시 시도
          </Button>
        </div>
      ) : null}

      {/* 준비 중 스켈레톤 행들 */}
      {prepareStatus === 'preparing' ? (
        <div className="space-y-2.5 py-0.5">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : null}

      {/* 준비 완료 시 단계 행 */}
      {prepareStatus === 'ready' ? (
        <div className="space-y-3">
          {/* 1단계: 글+사진 한 번에 준비하기 (주 버튼) */}
          <section
            role="group"
            aria-labelledby="step-1-title"
            className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3"
          >
            {/* 세로 배치: 번호 배지 + 제목 + 한 줄 설명 */}
            <div className="flex items-start gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary mt-0.5">
                1
              </span>
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h5 id="step-1-title" className="text-sm font-bold text-foreground">
                    {isPc ? '글 복사하고 사진 ZIP 받기' : '글+사진 한 번에 준비'}
                  </h5>
                  {isCopySuccess ? (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 gap-0.5">
                      <Check className="size-3 text-primary" aria-hidden="true" />
                      <span>준비됨</span>
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isPc
                    ? '글 복사와 사진 압축 파일(ZIP) 다운로드를 한 번에 시작해요'
                    : '글 복사와 사진 저장을 한 번에 시작해요'}
                </p>
              </div>
            </div>

            {/* 전폭 주 버튼 (min-h-12) */}
            <Button
              type="button"
              variant={isCopySuccess ? 'outline' : 'default'}
              aria-label={isPc ? '글 복사하고 사진 ZIP 받기' : '글+사진 한 번에 준비하기'}
              disabled={isWorking}
              onClick={isPc ? handlePrepareAllPc : handlePrepareAll}
              className="w-full min-h-12 text-sm font-semibold justify-center"
            >
              {isWorking ? (
                <Loader2 className="size-4 mr-1.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : isPc ? (
                <Download className="size-4 mr-1.5 shrink-0" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4 mr-1.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {isWorking
                  ? (isPc ? '글 복사 및 ZIP 준비 중…' : '글+사진 준비 중…')
                  : (isPc ? '글 복사하고 사진 ZIP 받기' : '글+사진 한 번에 준비하기')}
              </span>
            </Button>

            {/* 결과 메시지 영역: 가벼운 상태 영역, 높이 예약 min-h-[44px] */}
            <div
              data-testid="step-1-feedback-area"
              className="min-h-[44px] rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs flex flex-col justify-center gap-1.5"
            >
              {!copyOutcome && !shareOutcome && zipStatus === 'idle' && !downloading ? (
                <p className="text-muted-foreground text-xs leading-normal">
                  {isPc
                    ? '버튼을 누르면 글 복사와 사진 한꺼번에 저장이 동시에 진행돼요.'
                    : '버튼을 누르면 글 복사와 사진 저장이 동시에 진행돼요.'}
                </p>
              ) : (
                <div role={copyFailed || zipStatus === 'error' ? 'alert' : 'status'} aria-live="polite" className="space-y-1.5">
                  {/* 줄 1: 글 복사 결과 */}
                  {copyOutcome ? (
                    <div className="flex items-center gap-1.5 text-foreground">
                      {isCopySuccess ? (
                        <Check className="size-3.5 text-primary shrink-0" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="size-3.5 text-destructive shrink-0" aria-hidden="true" />
                      )}
                      <span className="font-medium">
                        {copyOutcome.status === 'ok' &&
                          '글을 복사했어요. 네이버 글쓰기에서 붙여넣기만 하면 돼요'}
                        {copyFailed && '복사하지 못했어요'}
                      </span>
                    </div>
                  ) : null}

                  {/* 줄 2 (PC): ZIP 받기 진행·완료·실패 */}
                  {isPc ? (
                    (zipStatus !== 'idle' || downloading) ? (
                      <div className="flex items-center justify-between gap-1 text-foreground">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isZipDownloading ? (
                            <Loader2 className="size-3.5 animate-spin text-primary shrink-0" aria-hidden="true" />
                          ) : zipStatus === 'done' ? (
                            <Check className="size-3.5 text-primary shrink-0" aria-hidden="true" />
                          ) : (
                            <AlertCircle className="size-3.5 text-destructive shrink-0" aria-hidden="true" />
                          )}
                          <span className="font-medium text-muted-foreground">
                            {isZipDownloading && `사진 ${photoCount}장 파일 다운로드 중…`}
                            {!isZipDownloading && zipStatus === 'done' && `사진 ${photoCount}장 사진 한꺼번에 저장을 시작했어요 (브라우저 다운로드 확인)`}
                            {!isZipDownloading && zipStatus === 'error' && (zipError || '파일을 준비하지 못했어요')}
                          </span>
                        </div>
                      </div>
                    ) : null
                  ) : (
                    /* 줄 2 (모바일): 사진 저장 시트 안내 */
                    shareOutcome ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-1 text-foreground">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {shareOutcome === 'shared' ? (
                              <Check className="size-3.5 text-primary shrink-0" aria-hidden="true" />
                            ) : (
                              <Images className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                            )}
                            <span className="font-medium text-muted-foreground">
                              {shareOutcome === 'shared' &&
                                `공유 시트에서 '이미지 ${photoCount}개 저장'을 눌러 주세요`}
                              {(shareOutcome === 'unsupported' || shareOutcome === 'failed') &&
                                '이 기기는 한 번에 저장을 지원하지 않아요. 아래 ZIP으로 받아 주세요'}
                            </span>
                          </div>
                          {shareOutcome === 'unsupported' || shareOutcome === 'failed' ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleRetryShareOnly}
                              disabled={sharing}
                              className="h-7 px-2 text-xs font-semibold shrink-0"
                            >
                              사진만 다시 시도
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>

            {/* ZIP 단독 받기/재시도 버튼 (모바일 미지원 또는 데스크톱 결과 시 노출) */}
            {showZipButton ? (
              <div className="pt-0.5 space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isZipDownloading || !onDownloadZip}
                  onClick={handleDownloadZip}
                  aria-label={isZipDownloading ? 'ZIP 파일 준비 중…' : `사진 ${photoCount}장 ZIP으로 받기`}
                  className="w-full min-h-11 justify-center text-xs font-semibold"
                >
                  {isZipDownloading ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin shrink-0" aria-hidden="true" />
                  ) : (
                    <Download className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {isZipDownloading ? 'ZIP 파일 준비 중…' : `사진 ${photoCount}장 ZIP으로 받기`}
                  </span>
                </Button>
                {zipError ? (
                  <div role="alert" className="flex items-center gap-1.5 text-xs text-destructive font-medium">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{zipError}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 사진 권한 안내: 접이식 안내 (모바일에서만 표시, PC에선 숨김) */}
            {!isPc ? (
              <details className="group rounded-lg border border-border/50 bg-background/60 text-xs">
                <summary className="cursor-pointer font-medium p-2 text-muted-foreground hover:text-foreground flex items-center justify-between select-none min-h-11">
                  <span>네이버 앱에서 방금 저장한 사진이 안 보이면</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-1 group-open:hidden">
                    펼치기
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-1 hidden group-open:inline">
                    접기
                  </span>
                </summary>
                <div className="p-2.5 pt-1.5 border-t border-border/40 text-muted-foreground leading-relaxed">
                  사진 선택 화면 위쪽의 &apos;설정&apos; 또는 iPhone 설정 &gt; 네이버 블로그 &gt; 사진 &gt; &apos;모든 사진&apos;을 허용해 주세요.
                </div>
              </details>
            ) : null}

            {/* 복사 실패 시 선택 가능 텍스트 영역 폴백 */}
            {copyFailed ? (
              <div className="space-y-1.5 border-t border-border/50 pt-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="naver-one-shot-full-text"
                    className="text-xs font-semibold text-foreground"
                  >
                    전체 원고 텍스트 직접 선택/복사
                  </label>
                  <span className="text-xs text-muted-foreground">텍스트를 드래그하여 복사하세요</span>
                </div>
                <textarea
                  id="naver-one-shot-full-text"
                  aria-label="전체 원고 텍스트"
                  readOnly
                  value={fullText}
                  rows={6}
                  className="w-full rounded-lg border bg-background p-2.5 text-base md:text-sm leading-relaxed font-mono select-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            ) : null}
          </section>

          {/* 2단계: 네이버 블로그 앱 열기 또는 PC 글쓰기 열기 */}
          <section
            role="group"
            aria-labelledby="step-2-title"
            className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3"
          >
            {/* 세로 배치: 번호 배지 + 제목 + 한 줄 설명 */}
            <div className="flex items-start gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary mt-0.5">
                2
              </span>
              <div className="space-y-0.5 min-w-0 flex-1">
                <h5 id="step-2-title" className="text-sm font-bold text-foreground">
                  {isPc ? '네이버 글쓰기 열기(PC)' : '네이버 블로그 앱 열기'}
                </h5>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isPc
                    ? '네이버 블로그 글쓰기 새 창을 열고 붙여넣기만 하면 돼요'
                    : '네이버 블로그 앱을 열고 + → 블로그 글쓰기에서 붙여넣기만 하면 돼요'}
                </p>
              </div>
            </div>

            {/* 전폭 주 버튼 (min-h-12) */}
            <Button
              asChild
              variant={isCopySuccess ? 'default' : 'outline'}
              className="w-full min-h-12 text-sm font-semibold justify-center"
            >
              <a
                href={isPc ? webWriteUrl : targetAppUrl}
                target={isPc ? '_blank' : undefined}
                rel={isPc ? 'noopener noreferrer' : undefined}
                aria-label={isPc ? '네이버 글쓰기 열기(PC)' : '네이버 블로그 앱 열기'}
              >
                <ExternalLink className="size-4 mr-1.5 shrink-0" aria-hidden="true" />
                <span>{isPc ? '네이버 글쓰기 열기(PC)' : '네이버 블로그 앱 열기'}</span>
              </a>
            </Button>

            {/* 네이버에서 할 일 3줄 체크리스트: 기본 펼침(open) */}
            <details open className="group rounded-lg border border-border/60 bg-background/70 text-xs">
              <summary className="cursor-pointer font-semibold p-2.5 text-foreground flex items-center justify-between select-none min-h-11">
                <span className="flex items-center gap-1.5 min-w-0">
                  <Check className="size-3.5 text-primary shrink-0" aria-hidden="true" />
                  <span>네이버에서 할 일</span>
                </span>
                <span className="text-xs text-muted-foreground shrink-0 ml-1 group-open:hidden">
                  펼치기
                </span>
                <span className="text-xs text-muted-foreground shrink-0 ml-1 hidden group-open:inline">
                  접기
                </span>
              </summary>
              <div className="p-3 pt-1.5 border-t border-border/50 space-y-2.5 text-muted-foreground">
                <ul className="space-y-1.5 leading-relaxed">
                  <li className="flex items-start gap-1.5">
                    <span className="font-bold text-primary shrink-0">①</span>
                    <span className="text-foreground">본문 칸에 붙여넣기</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="font-bold text-primary shrink-0">②</span>
                    <span className="text-foreground">
                      맨 윗줄(제목)을 잘라(길게 눌러→잘라내기 / PC는 Cmd·Ctrl+X) 제목 칸에 붙여넣기
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="font-bold text-primary shrink-0">③</span>
                    <span className="text-foreground">
                      {photoCount <= 10 ? (
                        <span>
                          소개 글 끝 빈 줄을 탭해 사진 → 저장한 {photoCount}장을 1번부터 차례로 선택해 첨부(&apos;슬라이드&apos; 추천)
                        </span>
                      ) : (
                        <span>
                          소개 글 끝 빈 줄을 탭해 사진 → 저장한 {photoCount}장을 1번부터 차례로 선택해 첨부(개별사진 또는 10장씩 두 번)
                        </span>
                      )}
                    </span>
                  </li>
                </ul>
                <div className="rounded-md border border-border/50 bg-muted/40 p-2 text-xs text-muted-foreground leading-relaxed">
                  맨 아래 #태그 줄은 발행할 때 네이버가 태그로 읽어요
                </div>
                <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-xs font-semibold text-primary leading-relaxed">
                  끝나면 네이버 앱에서 바로 등록하세요 (소희로 돌아올 필요 없어요)
                </div>
              </div>
            </details>

            {/* 바로 아래 보조 텍스트 링크 (모바일 환경일 때만 앱 대신 웹으로 열기 표시) */}
            {!isPc ? (
              <div className="flex justify-center pt-0.5">
                <a
                  href={webWriteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground inline-flex items-center justify-center gap-1 min-h-11 px-2 py-1"
                >
                  <span>앱이 안 열리면 웹으로 열기</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  )
}
