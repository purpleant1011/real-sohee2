'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyNaverPostWithResult, type NaverCopyPart, type NaverCopyResult } from '../copy-naver-post'
import { downloadNaverHandoff } from '../naver-handoff'
import { buildNaverStepSequence } from '../naver-step-sequence'
import {
  loadConversationPublishingAction,
  type ConversationPublishingState,
  type ConversationPublishReceipt,
} from '@/features/chat/actions/load-conversation-publishing'
import {
  type NaverVisibility,
} from '@/features/naver-publish/types'
import { NaverPostUrlForm } from '@/features/publishing/naver-post-url-form'
import { NaverPhotoSaveList } from './naver-photo-save-list'
import { NaverReadinessSection, NaverSearchObservationSection } from './naver-quality-sections'
import { NaverStepList } from './naver-step-list'
import { NaverOneShotCard } from './naver-one-shot-card'

export type NaverReviewSettings = Readonly<{
  visibility?: NaverVisibility
  categoryName?: string | null
  imageCount?: number
  scheduledAt?: string | null
  postMode?: 'information' | 'faq' | 'comparison' | 'consultation' | string | null
}>

export type NaverReviewStepProps = Readonly<{
  workspaceId: string
  contentId: string
  versionId?: string
  settings?: NaverReviewSettings
  onReset?: () => void
  onPublished?: (receipt: ConversationPublishReceipt) => void
  compact?: boolean
}>

const WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver'

function formatFullManuscript(
  naverCopy: NonNullable<ConversationPublishingState['preview']['naverCopy']>,
  disclosure?: string | null,
) {
  const parts: string[] = []
  if (naverCopy.title) {
    parts.push(`[제목]\n${naverCopy.title}`)
  }
  const bodySections: string[] = []
  if (naverCopy.introduction) {
    bodySections.push(naverCopy.introduction)
  }
  naverCopy.sections?.forEach((s) => {
    if (s.heading) bodySections.push(`### ${s.heading}`)
    if (s.body) bodySections.push(s.body)
  })
  if (naverCopy.cta) {
    bodySections.push(naverCopy.cta)
  }
  if (disclosure) {
    bodySections.push(disclosure)
  }
  if (bodySections.length > 0) {
    parts.push(`[본문]\n${bodySections.join('\n\n')}`)
  }
  if (naverCopy.keywords?.length) {
    parts.push(`[태그]\n${naverCopy.keywords.join(', ')}`)
  }
  return parts.join('\n\n')
}

export function NaverReviewStep({
  workspaceId,
  contentId,
  versionId,
  settings,
  onReset,
  onPublished,
  compact = false,
}: NaverReviewStepProps) {
  const [loading, setLoading] = useState(true)
  const [publishingState, setPublishingState] = useState<ConversationPublishingState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportedUrl, setReportedUrl] = useState<string | null>(null)
  const [copyResult, setCopyResult] = useState<Readonly<{
    mode: NaverCopyResult
    opened: boolean
    part: NaverCopyPart
  }> | null>(null)
  const [copying, setCopying] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadResult, setDownloadResult] = useState<'requested' | 'failed' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [showFullTextFallback, setShowFullTextFallback] = useState(false)

  async function handleCopy(part: NaverCopyPart) {
    if (!publishingState?.preview.naverCopy || copying) return
    setCopying(true)
    setCopyResult(null)
    const preview = publishingState.preview
    const post = {
      ...preview.naverCopy!,
      editorBlocks: preview.naverBlocks,
      media: preview.media,
      imageUrls: preview.media.map((media) => media.src),
      disclosure: preview.disclosure,
    }

    try {
      const mode = await copyNaverPostWithResult(post, part)
      const copyFailed = mode === 'failed' || mode === 'permission_denied' || mode === 'clipboard_unavailable'
      if (copyFailed) {
        setShowFullTextFallback(true)
      }
      setCopyResult({ mode, opened: false, part })
    } catch {
      setShowFullTextFallback(true)
      setCopyResult({ mode: 'failed', opened: false, part })
    } finally {
      setCopying(false)
    }
  }

  async function handleDownload() {
    if (!publishingState?.preview.naverCopy || downloading) return
    setDownloading(true)
    setDownloadResult(null)
    const preview = publishingState.preview
    try {
      await downloadNaverHandoff(workspaceId, {
        ...preview.naverCopy!,
        sourceVersion: {
          workspaceId: preview.workspaceId,
          contentId: preview.contentId,
          versionId: preview.versionId,
          fingerprint: preview.fingerprint,
        },
        editorBlocks: preview.naverBlocks,
        media: preview.media,
        disclosure: preview.disclosure,
      })
      setDownloadResult('requested')
    } catch (err) {
      setDownloadResult('failed')
      throw err
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadState = async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/naver-posts/${contentId}`)
        if (response.ok) {
          const json = await response.json()
          if (json.data) return { data: json.data }
        }
      } catch {
        // fallback to server action
      }
      return loadConversationPublishingAction({ workspaceId, contentId })
    }

    loadState()
      .then((res: any) => {
        if (!active) return
        if (res.error) {
          setError(res.error.message)
        } else {
          setPublishingState(res.data)
          if (res.data.receipt && onPublished) {
            onPublished(res.data.receipt)
          }
        }
      })
      .catch(() => {
        if (active) setError('게시물을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [workspaceId, contentId, onPublished, reloadKey])

  function handleReload() {
    setLoading(true)
    setError(null)
    setReloadKey((prev) => prev + 1)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
        <Loader2 className="size-8 text-primary animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">미리보기를 불러오고 있어요…</p>
      </div>
    )
  }

  if (error || !publishingState) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4 text-center">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive">
          <AlertCircle className="size-6" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-foreground">{error ?? '게시물을 불러오지 못했어요.'}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleReload} className="min-h-11">
            <RefreshCw className="size-4" aria-hidden="true" />
            다시 불러오기
          </Button>
          {onReset ? (
            <Button type="button" variant="ghost" size="sm" onClick={onReset} className="min-h-11">
              처음으로
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  const naverCopy = publishingState.preview.naverCopy
  const fullManuscript = naverCopy
    ? formatFullManuscript(naverCopy, publishingState.preview.disclosure)
    : ''
  const photos = (publishingState.preview.media ?? []).map((m, idx) => ({
    id: m.id || `photo-${idx}`,
    src: m.src,
    alt: m.altText || `사진 ${idx + 1}`,
  }))

  const naverBlocks = publishingState.preview.naverBlocks
  const hasInterleavedBlocks = Boolean(
    naverBlocks &&
    naverBlocks.length > 0 &&
    naverBlocks.some((block) => block.kind === 'image'),
  )

  const stepSequence = (hasInterleavedBlocks && naverCopy)
    ? buildNaverStepSequence({
        title: naverCopy.title,
        blocks: naverBlocks,
        media: publishingState.preview.media,
        keywords: naverCopy.keywords,
        disclosure: publishingState.preview.disclosure,
        postMode: settings?.postMode,
      })
    : null

  const naverPostForCopy = naverCopy
    ? {
        ...naverCopy,
        editorBlocks: publishingState.preview.naverBlocks,
        media: publishingState.preview.media,
        imageUrls: (publishingState.preview.media ?? []).map((m) => m.src),
        disclosure: publishingState.preview.disclosure,
      }
    : null

  return (
    <div className="space-y-6 min-w-0 break-words">
      {onReset ? (
        <>
          {/* Settings Summary Card */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border bg-card p-4 shadow-2xs">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">작성 내용</span>
              <p className="text-sm text-foreground">
                <strong>사진 {settings?.imageCount ?? 0}장</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReset}
                className="shrink-0 text-xs min-h-11"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                처음부터 다시 만들기
              </Button>
            </div>
          </div>

          {/* Manuscript Preview (원고 미리보기) */}
          {naverCopy ? (
            <details className="group rounded-2xl border bg-card p-4 sm:p-5 break-words min-w-0">
              <summary className="cursor-pointer font-bold text-sm sm:text-base text-foreground flex items-center justify-between min-h-11 select-none">
                <span className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" aria-hidden="true" />
                  <span>원고 미리보기</span>
                </span>
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                  펼쳐서 확인하기
                </span>
                <span className="text-xs font-normal text-muted-foreground hidden group-open:inline">
                  접기
                </span>
              </summary>
              <article className="mt-4 space-y-4 pt-4 border-t text-sm break-words min-w-0 leading-relaxed">
                {/* 제목 */}
                {naverCopy.title ? (
                  <h4 className="text-base sm:text-lg font-bold text-foreground break-words">
                    {naverCopy.title}
                  </h4>
                ) : null}

                {/* 본문 및 사진 (naverBlocks 또는 sections) */}
                {publishingState.preview.naverBlocks?.length ? (
                  <div className="space-y-3 break-words min-w-0">
                    {publishingState.preview.naverBlocks.map((block, idx) => {
                      if (block.kind === 'heading') {
                        return (
                          <h5 key={idx} className="font-bold text-sm sm:text-base text-foreground break-words pt-1">
                            {block.text}
                          </h5>
                        )
                      }
                      if (block.kind === 'paragraph') {
                        return (
                          <p key={idx} className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {block.text}
                          </p>
                        )
                      }
                      if (block.kind === 'quote') {
                        return (
                          <blockquote key={idx} className="border-l-2 border-primary/40 pl-3 italic text-sm text-muted-foreground break-words">
                            {block.text}
                          </blockquote>
                        )
                      }
                      if (block.kind === 'image') {
                        const item = publishingState.preview.media.find((m) => m.id === block.mediaId)
                        const src = item?.src
                        if (!src) return null
                        return (
                          <figure key={idx} className="my-2 space-y-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={block.altText || item.altText || '사진'}
                              loading="lazy"
                              className="rounded-lg max-h-60 w-auto object-cover border max-w-full"
                            />
                            {block.altText ? (
                              <figcaption className="text-xs text-muted-foreground break-words">
                                {block.altText}
                              </figcaption>
                            ) : null}
                          </figure>
                        )
                      }
                      if (block.kind === 'link') {
                        return (
                          <a
                            key={idx}
                            href={block.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary underline break-words block"
                          >
                            {block.title || block.url}
                          </a>
                        )
                      }
                      if (block.kind === 'map') {
                        return (
                          <div key={idx} className="text-xs text-muted-foreground break-words">
                            지도: {block.placeName}
                          </div>
                        )
                      }
                      if (block.kind === 'cta') {
                        return (
                          <div key={idx} className="rounded-lg bg-muted/50 p-3 text-sm font-medium text-foreground break-words">
                            {block.text}
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                ) : (
                  <div className="space-y-3 break-words min-w-0">
                    {naverCopy.introduction ? (
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                        {naverCopy.introduction}
                      </p>
                    ) : null}
                    {naverCopy.sections?.map((section, idx) => (
                      <div key={idx} className="space-y-1.5 break-words min-w-0">
                        {section.heading ? (
                          <h5 className="font-bold text-sm sm:text-base text-foreground break-words pt-1">
                            {section.heading}
                          </h5>
                        ) : null}
                        {section.body ? (
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {section.body}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {publishingState.preview.media?.length ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {publishingState.preview.media.map((item, idx) => (
                          <figure key={item.id ?? idx} className="space-y-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.src}
                              alt={item.altText || `사진 ${idx + 1}`}
                              loading="lazy"
                              className="rounded-lg max-h-48 w-auto object-cover border max-w-full"
                            />
                            {item.altText ? (
                              <figcaption className="text-xs text-muted-foreground break-words">
                                {item.altText}
                              </figcaption>
                            ) : null}
                          </figure>
                        ))}
                      </div>
                    ) : null}
                    {naverCopy.cta ? (
                      <div className="rounded-lg bg-muted/50 p-3 text-sm font-medium text-foreground break-words">
                        {naverCopy.cta}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 마지막 안내 (disclosure) */}
                {publishingState.preview.disclosure ? (
                  <p className="text-xs text-muted-foreground break-words pt-2 border-t">
                    {publishingState.preview.disclosure}
                  </p>
                ) : null}

                {/* 태그 */}
                {naverCopy.keywords?.length ? (
                  <div className="pt-2 border-t flex flex-wrap gap-1.5">
                    {naverCopy.keywords.map((keyword, idx) => (
                      <span
                        key={idx}
                        className="rounded-full bg-secondary/80 px-2 py-0.5 text-xs text-secondary-foreground break-words"
                      >
                        #{keyword.replace(/^#+/u, '')}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            </details>
          ) : null}
        </>
      ) : null}

      {/* Manual Publishing Helper Section */}
      <section
        aria-label="네이버 직접 작성 도우미"
        className={compact ? 'space-y-3 p-1' : 'rounded-2xl border bg-card p-5 space-y-5'}
      >
        {!compact ? (
          <div className="space-y-1.5 border-b pb-4">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden="true" />
              <span>수동 게시 도우미</span>
            </h3>
            <p className="text-sm font-medium text-foreground">
              소희가 원고와 사진을 준비했어요. 네이버에서 직접 게시해 주세요.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              원고 내용과 사진을 차례대로 복사/저장하고, 네이버 스마트에디터에 붙여넣어 완성해 주세요.
              복사나 다운로드만으로 블로그에 등록되지 않아요.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            원고와 사진을 가져가 네이버 블로그 앱에 붙여넣어 주세요.
          </p>
        )}

        {!naverCopy ? (
          <p role="alert" className="text-sm text-destructive">
            전체 원고를 불러오지 못했어요. 다시 불러온 뒤 복사해 주세요.
          </p>
        ) : null}

        {stepSequence && naverPostForCopy ? (
          <div className="space-y-4">
            <NaverOneShotCard
              post={naverPostForCopy}
              cacheKey={`${contentId}:${versionId || publishingState?.preview?.versionId || ''}`}
              writeUrl={WRITE_URL}
              compact={compact}
              onDownloadZip={handleDownload}
              downloading={downloading}
            />

            <details className="group rounded-2xl border bg-card p-4 sm:p-5 break-words min-w-0">
              <summary className="cursor-pointer font-bold text-sm sm:text-base text-foreground flex items-center justify-between min-h-11 select-none">
                <span className="flex items-center gap-2">
                  <span>한 조각씩 따라 하기 (자세히)</span>
                </span>
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                  펼쳐서 확인하기
                </span>
                <span className="text-xs font-normal text-muted-foreground hidden group-open:inline">
                  접기
                </span>
              </summary>
              <div className="mt-4 pt-4 border-t space-y-4">
                <NaverStepList
                  steps={stepSequence.steps}
                  postMode={settings?.postMode}
                />
              </div>
            </details>

            {/* 보조 기능 (글 전체 복사, ZIP 받기, 네이버 글쓰기 열기) */}
            <div className="space-y-3 border-t pt-4">
              <h4 className="text-xs font-semibold text-muted-foreground">보조 기능</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* 글 전체 한 번에 복사 */}
                <Button
                  type="button"
                  variant="outline"
                  aria-label="글 전체 한 번에 복사"
                  disabled={copying || !naverCopy}
                  onClick={() => void handleCopy('body')}
                  className="min-h-11 justify-start px-3 text-xs font-semibold"
                >
                  <Copy className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                  <span>글 전체 한 번에 복사</span>
                </Button>

                {/* ZIP 으로 한꺼번에 받기 */}
                <Button
                  type="button"
                  variant="outline"
                  aria-label="ZIP 으로 한꺼번에 받기"
                  disabled={downloading || !naverCopy}
                  onClick={() => void handleDownload()}
                  className="min-h-11 justify-start px-3 text-xs font-semibold"
                >
                  <Download className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                  <span>{downloading ? '파일 준비 중…' : 'ZIP 으로 한꺼번에 받기'}</span>
                </Button>

                {/* 네이버 글쓰기 열기 */}
                <Button
                  asChild
                  variant="outline"
                  className="min-h-11 justify-start px-3 text-xs font-semibold"
                >
                  <a
                    href={WRITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="네이버 글쓰기 열기"
                    className="min-h-11 justify-start px-3 text-xs font-semibold"
                  >
                    <ExternalLink className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                    <span>네이버 글쓰기 열기</span>
                  </a>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* 6 Manual Publishing CTAs in Exact UX Order (Fallback) */
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground">직접 올리기 단계</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {/* ① 제목 복사 */}
              <Button
                type="button"
                variant="outline"
                aria-label="제목 복사"
                disabled={copying || !naverCopy}
                onClick={() => void handleCopy('title')}
                className="min-h-11 justify-start px-3 text-xs font-semibold"
              >
                <Copy className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">① 제목 복사</span>
              </Button>

              {/* ② 본문 복사 */}
              <Button
                type="button"
                variant="outline"
                aria-label="본문 복사"
                disabled={copying || !naverCopy}
                onClick={() => void handleCopy('body')}
                className="min-h-11 justify-start px-3 text-xs font-semibold"
              >
                <Copy className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">② 본문 복사</span>
              </Button>

              {/* ③ 태그 복사 */}
              <Button
                type="button"
                variant="outline"
                aria-label="태그 복사"
                disabled={copying || !naverCopy}
                onClick={() => void handleCopy('tags')}
                className="min-h-11 justify-start px-3 text-xs font-semibold"
              >
                <Copy className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">③ 태그 복사</span>
              </Button>

              {/* ④ 사진 받기/ZIP */}
              <Button
                type="button"
                variant="outline"
                aria-label="사진 받기/ZIP"
                disabled={downloading || !naverCopy}
                onClick={() => void handleDownload()}
                className="min-h-11 justify-start px-3 text-xs font-semibold"
              >
                <Download className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">{downloading ? '파일 준비 중…' : '④ 사진 받기/ZIP'}</span>
              </Button>

              {/* ④ 아래 사진 개별 저장 목록 */}
              {photos.length > 0 ? <NaverPhotoSaveList photos={photos} /> : null}

              {/* ⑤ 네이버 글쓰기 열기 */}
              <Button
                asChild
                variant="outline"
                className="min-h-11 justify-start px-3 text-xs font-semibold"
              >
                <a
                  href={WRITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="네이버 글쓰기 열기"
                  className="min-h-11 justify-start px-3 text-xs font-semibold"
                >
                  <ExternalLink className="size-3.5 mr-1.5 shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold">⑤ 네이버 글쓰기 열기</span>
                </a>
              </Button>
            </div>
          </div>
        )}

        {/* Copy Result Feedback & Status */}
        {copyResult ? (
          <div
            role={
              copyResult.mode === 'failed' ||
              copyResult.mode === 'permission_denied' ||
              copyResult.mode === 'clipboard_unavailable'
                ? 'alert'
                : 'status'
            }
            aria-label="직접 복사 결과"
            className="rounded-xl border bg-muted/40 p-3.5 text-xs space-y-1.5"
          >
            <p className="font-medium text-foreground">
              {copyResult.mode === 'permission_denied'
                ? '브라우저 클립보드 접근 권한이 거부되었어요. 아래 전체 원고 텍스트를 직접 복사해 주세요.'
                : copyResult.mode === 'clipboard_unavailable'
                  ? '현재 브라우저에서 클립보드 기능을 사용할 수 없어요. 아래 전체 원고 텍스트를 직접 복사해 주세요.'
                  : copyResult.mode === 'failed'
                    ? '내용을 복사하지 못했어요. 아래 전체 원고 텍스트를 직접 복사해 주세요.'
                    : copyResult.part === 'title'
                      ? '제목을 복사했어요.'
                      : copyResult.part === 'tags'
                        ? '태그를 복사했어요.'
                        : '본문이 복사됐어요. 사진은 따로 첨부해 주세요.'}
            </p>
            {copyResult.mode === 'html_unsupported' ? (
              <p className="text-muted-foreground">
                HTML 서식 복사를 지원하지 않는 브라우저여서 텍스트만 복사했어요. 사진과 서식은 포함되지 않았어요.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ZIP Download Status */}
        {downloadResult ? (
          <div
            role={downloadResult === 'failed' ? 'alert' : 'status'}
            className="rounded-xl border bg-muted/40 p-3.5 text-xs space-y-1"
          >
            <p className="font-medium text-foreground">
              {downloadResult === 'failed'
                ? '원고·사진 파일을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.'
                : '사진 한꺼번에 저장을 요청했어요. 브라우저의 다운로드 목록을 확인해 주세요. 게시 완료가 아니에요.'}
            </p>
          </div>
        ) : null}

        {/* Fallback Selectable Full-Text Sheet */}
        {(showFullTextFallback ||
          copyResult?.mode === 'permission_denied' ||
          copyResult?.mode === 'clipboard_unavailable' ||
          copyResult?.mode === 'failed') &&
        naverCopy ? (
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <label htmlFor="naver-full-text-sheet" className="text-xs font-semibold text-foreground">
                전체 원고 텍스트 직접 선택/복사
              </label>
              <span className="text-xs text-muted-foreground">텍스트를 드래그하여 복사하세요</span>
            </div>
            <textarea
              id="naver-full-text-sheet"
              aria-label="전체 원고 텍스트"
              readOnly
              value={fullManuscript}
              rows={8}
              className="w-full rounded-lg border bg-muted/20 p-3 text-base md:text-sm leading-relaxed font-mono select-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        ) : null}

        {/* 게시 URL 등록 Form */}
        <div className="border-t pt-4 space-y-2">
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-foreground">게시 URL 등록</h4>
            <p className="text-xs text-muted-foreground">
              게시하셨다면 글 주소를 알려 주세요.
            </p>
          </div>
          <NaverPostUrlForm workspaceId={workspaceId} itemId={contentId} onRecorded={setReportedUrl} />
        </div>

        {/* 소희 자체 콘텐츠 준비도 (네이버 점수·순위 아님) */}
        <details className="group rounded-2xl border bg-card p-4 sm:p-5 break-words min-w-0">
          <summary className="cursor-pointer font-bold text-sm sm:text-base text-foreground flex items-center justify-between min-h-11 select-none">
            <span className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden="true" />
              <span>소희 콘텐츠 준비도 보기</span>
            </span>
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">
              펼쳐서 확인하기
            </span>
            <span className="text-xs font-normal text-muted-foreground hidden group-open:inline">
              접기
            </span>
          </summary>
          <div className="mt-4 pt-4 border-t">
            <NaverReadinessSection workspaceId={workspaceId} contentId={contentId} />
          </div>
        </details>

        {/* 검색 발견 현황 */}
        {reportedUrl ? (
          <NaverSearchObservationSection
            workspaceId={workspaceId}
            contentId={contentId}
            ownerPostUrl={reportedUrl}
            defaultQuery={naverCopy?.keywords?.[0] ?? ''}
          />
        ) : null}
      </section>
    </div>
  )
}
