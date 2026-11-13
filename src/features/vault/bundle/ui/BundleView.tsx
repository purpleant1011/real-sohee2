'use client'

import * as React from 'react'
import type { VaultCopyBundle } from '../types'

export interface BundleViewProps {
  bundle: VaultCopyBundle
  workspaceId: string
  onUrlRegistered?: (newUrl: string, statusLabel: string) => void
  /** Uses the same API transport as the dialog; fixture pages can refuse writes without network access. */
  fetchFn?: typeof fetch
}

export function BundleView({
  bundle,
  workspaceId,
  onUrlRegistered,
  fetchFn = globalThis.fetch,
}: BundleViewProps) {
  const [copyFeedback, setCopyFeedback] = React.useState<string | null>(null)
  const [fallbackText, setFallbackText] = React.useState<string | null>(null)
  const [urlInput, setUrlInput] = React.useState(bundle.publicationStatus.publishedUrl ?? '')
  const [isSubmittingUrl, setIsSubmittingUrl] = React.useState(false)
  const [urlError, setUrlError] = React.useState<string | null>(null)
  const [publicationStatus, setPublicationStatus] = React.useState(bundle.publicationStatus)

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setCopyFeedback(`${label}이(가) 복사되었어요.`)
        setFallbackText(null)
      } else {
        throw new Error('Clipboard API not available')
      }
    } catch {
      // Fallback: document.execCommand
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        const successful = document.execCommand('copy')
        document.body.removeChild(textarea)

        if (successful) {
          setCopyFeedback(`${label}이(가) 복사되었어요.`)
          setFallbackText(null)
          return
        }
      } catch {
        // Fallback failed
      }

      setFallbackText(text)
      setCopyFeedback('자동 복사가 지원되지 않는 환경이에요. 아래 텍스트 상자에서 직접 복사해 주세요.')
    }
  }

  React.useEffect(() => {
    if (copyFeedback) {
      const timer = setTimeout(() => setCopyFeedback(null), 3500)
      return () => clearTimeout(timer)
    }
  }, [copyFeedback])

  const handleRegisterUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    setUrlError(null)

    const trimmed = urlInput.trim()
    if (!trimmed) {
      setUrlError('게시한 글의 주소를 입력해 주세요.')
      return
    }

    if (!trimmed.startsWith('https://')) {
      setUrlError('주소는 https:// 로 시작해야 해요.')
      return
    }

    setIsSubmittingUrl(true)
    try {
      const res = await fetchFn(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/vault/${encodeURIComponent(bundle.itemRef)}/bundle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        },
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUrlError(json.error ?? '게시 주소를 등록하지 못했어요. 주소를 다시 확인해 주세요.')
        return
      }

      const nextStatus = {
        isPublishedUrlRegistered: true,
        publishedUrl: json.publishedUrl ?? trimmed,
        statusLabel: json.statusLabel ?? '사장님이 직접 올린 글로 기록됐어요(확인 전)',
        registeredAt: json.registeredAt ?? new Date().toISOString(),
      }
      setPublicationStatus(nextStatus)
      onUrlRegistered?.(nextStatus.publishedUrl, nextStatus.statusLabel)
    } catch {
      setUrlError('네트워크 연결을 확인한 후 다시 시도해 주세요.')
    } finally {
      setIsSubmittingUrl(false)
    }
  }

  return (
    <div className="w-full max-w-[480px] mx-auto p-4 sm:p-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm space-y-6 text-zinc-900 dark:text-zinc-100">
      {/* 1. Header & Channel Badge */}
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-state-ok-soft text-state-ok  border border-state-ok/30">
            {bundle.channelLabel}
          </span>
          <span
            className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            role="status"
          >
            {publicationStatus.statusLabel}
          </span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight">
          {bundle.title ?? `${bundle.channelLabel} 수동 게시 번들`}
        </h2>
      </header>

      {/* 2. Step Guide */}
      <section
        aria-labelledby="guide-heading"
        className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 space-y-3"
      >
        <h3 id="guide-heading" className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          게시 안내
        </h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {bundle.channelLabel} 앱 또는 웹사이트에서 직접 붙여넣고 게시하세요.
        </p>
        <ol className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-none pl-0">
          {bundle.guideSteps.map((step, idx) => (
            <li key={idx} className="leading-relaxed">
              {step}
            </li>
          ))}
        </ol>
        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700/60">
          <p className="text-xs text-state-warn leading-relaxed font-medium">
            안내: {bundle.settingsNotice}
          </p>
        </div>
      </section>

      {/* 3. Copy Section */}
      <section aria-labelledby="copy-heading" className="space-y-3">
        <h3 id="copy-heading" className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          내용 복사하기
        </h3>

        {/* Primary Action: Full Copy */}
        <button
          type="button"
          onClick={() => copyToClipboard(bundle.fullText, '전체 내용')}
          className="w-full py-3 px-4 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:active:bg-white dark:text-zinc-900 font-semibold text-sm rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300"
        >
          한 번에 전체 복사하기
        </button>

        {/* Individual Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {bundle.title ? (
            <button
              type="button"
              onClick={() => copyToClipboard(bundle.title ?? '', '제목')}
              className="py-2.5 px-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 text-xs font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              제목 복사
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => copyToClipboard(bundle.body, '본문')}
            className="py-2.5 px-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 text-xs font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            본문 복사
          </button>

          {bundle.tags.length > 0 ? (
            <button
              type="button"
              onClick={() => copyToClipboard(bundle.formattedTags, '태그')}
              className="py-2.5 px-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 text-xs font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              태그 복사
            </button>
          ) : null}
        </div>

        {/* Toast / Status Feedback */}
        {copyFeedback ? (
          <div
            role="status"
            aria-live="polite"
            className="p-2.5 text-xs text-center font-medium bg-state-ok-soft text-state-ok  rounded-lg border border-state-ok/30"
          >
            {copyFeedback}
          </div>
        ) : null}

        {/* Fallback Textarea if Clipboard API failed */}
        {fallbackText !== null ? (
          <div className="space-y-1.5 p-3 bg-state-warn-soft border border-state-warn/30 rounded-xl">
            <p className="text-xs text-state-warn font-medium">
              자동 복사에 실패했어요. 아래 텍스트를 길게 눌러 직접 복사해 주세요:
            </p>
            <textarea
              readOnly
              value={fallbackText}
              rows={4}
              aria-label="복사용 텍스트 상자"
              className="w-full text-base md:text-xs p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono resize-none focus:outline-none"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
          </div>
        ) : null}
      </section>

      {/* 4. Images Download Section */}
      <section aria-labelledby="images-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 id="images-heading" className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            이미지 내려받기
          </h3>
          <span className="text-xs text-zinc-500">
            총 {bundle.images.length}장
          </span>
        </div>

        {bundle.images.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              이미지 파일은 개별 링크를 통해 한 장씩 안전하게 내려받으실 수 있어요.
            </p>
            <ul className="space-y-2">
              {bundle.images.map((img, idx) => (
                <li
                  key={img.id}
                  className="flex items-center justify-between p-2.5 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 flex items-center justify-center text-xs font-semibold rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-medium truncate max-w-[180px] sm:max-w-[240px]">
                      {img.downloadFilename}
                    </span>
                  </div>
                  {img.signedUrl ? (
                    <a
                      href={img.signedUrl}
                      download={img.downloadFilename}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-xs font-medium rounded-lg text-zinc-800 dark:text-zinc-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                      내려받기
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-400">준비 중</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 py-3 text-center bg-zinc-50 dark:bg-zinc-800/30 rounded-xl">
            첨부된 이미지가 없습니다.
          </p>
        )}
      </section>

      {/* 5. Register Published URL Section */}
      <section
        aria-labelledby="url-heading"
        className="p-4 bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-100 dark:border-zinc-800 rounded-xl space-y-3"
      >
        <h3 id="url-heading" className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          게시 주소 등록
        </h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          직접 글을 올리셨나요? 주소를 등록해 두시면 나중에 다시 찾기 편해요.
        </p>

        {publicationStatus.isPublishedUrlRegistered ? (
          <div className="p-3 bg-state-ok-soft border border-state-ok/30 rounded-xl space-y-1.5">
            <p className="text-xs font-semibold text-state-ok">
              {publicationStatus.statusLabel}
            </p>
            {publicationStatus.publishedUrl ? (
              <a
                href={publicationStatus.publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-state-ok underline break-all hover:text-state-ok block"
              >
                {publicationStatus.publishedUrl}
              </a>
            ) : null}
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pt-1">
              소희가 외부 게시를 별도로 검증하지 않으며, 사장님이 알려주신 주소 그대로 기록되었어요.
            </p>
          </div>
        ) : (
          <form onSubmit={handleRegisterUrl} className="space-y-2.5">
            <div className="space-y-1">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
                aria-label="게시 완료된 글 주소"
                disabled={isSubmittingUrl}
                className="w-full text-base md:text-xs p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
              {urlError ? (
                <p className="text-xs text-state-danger font-medium" role="alert">
                  {urlError}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isSubmittingUrl}
              className="w-full py-2.5 px-3 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              {isSubmittingUrl ? '등록하는 중...' : '게시 주소 등록하기'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
