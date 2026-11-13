'use client'

import { useState } from 'react'
import { Check, Copy, Download, Mail, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  buildExportText,
  buildMailtoHref,
  imageFileName,
  shareContent,
} from './export-kit'

export type ExportActionImage = Readonly<{
  src: string
  alt?: string
}>

export type ExportActionsProps = Readonly<{
  channel: string
  title: string
  caption: string
  hashtags?: readonly string[] | string[]
  images?: readonly ExportActionImage[] | ExportActionImage[]
}>

/**
 * 수동 채널(네이버 블로그, 당근 비즈프로필 등)용 내보내기 2x2 액션 키트.
 * 모든 동작은 브라우저 로컬에서만 수행되며 소희 백엔드로 전송하지 않는다.
 */
export function ExportActions({
  channel,
  title,
  caption,
  hashtags = [],
  images = [],
}: ExportActionsProps) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [sharing, setSharing] = useState(false)

  const exportText = buildExportText({ title, caption, hashtags, channel })
  const hasImages = images.length > 0

  async function handleCopy() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(exportText)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      setCopied(false)
    }
  }

  async function handleDownloadImages() {
    if (!hasImages || downloading) return
    setDownloading(true)
    try {
      for (const [index, img] of images.entries()) {
        try {
          const res = await fetch(img.src)
          if (!res.ok) continue
          const blob = await res.blob()
          const filename = imageFileName(index, blob.type)
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = filename
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch {
          // 사진 개별 다운로드 실패는 다음 사진으로 계속 진행
        }
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleShare() {
    if (sharing) return
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      const mailto = buildMailtoHref({ subject: title || '원고 내보내기', body: exportText })
      window.open(mailto, '_blank')
      return
    }

    setSharing(true)
    try {
      let files: File[] = []
      if (hasImages && typeof navigator.canShare === 'function') {
        const filePromises = images.map(async (img, idx) => {
          try {
            const res = await fetch(img.src)
            if (!res.ok) return null
            const blob = await res.blob()
            const filename = imageFileName(idx, blob.type)
            return new File([blob], filename, { type: blob.type })
          } catch {
            return null
          }
        })
        const fetched = await Promise.all(filePromises)
        files = fetched.filter((file): file is File => file !== null)
      }

      const result = await shareContent({ title, text: exportText, files })
      if (result === 'unsupported') {
        const mailto = buildMailtoHref({ subject: title || '원고 내보내기', body: exportText })
        window.open(mailto, '_blank')
      }
    } finally {
      setSharing(false)
    }
  }

  const mailtoHref = buildMailtoHref({ subject: title || '원고 내보내기', body: exportText })

  return (
    <section aria-label="수동 채널 내보내기 키트" className="space-y-3 rounded-2xl bg-muted/50 p-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className="min-h-14 flex-col gap-1.5 rounded-xl border-border bg-card px-2 py-2 text-xs font-semibold sm:flex-row sm:text-sm"
        >
          {copied ? (
            <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span>{copied ? '복사했어요' : '본문 복사'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={!hasImages || downloading}
          onClick={handleDownloadImages}
          className="min-h-14 flex-col gap-1.5 rounded-xl border-border bg-card px-2 py-2 text-xs font-semibold sm:flex-row sm:text-sm"
        >
          <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{downloading ? '저장 중…' : '이미지 저장'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={sharing}
          onClick={handleShare}
          className="min-h-14 flex-col gap-1.5 rounded-xl border-border bg-card px-2 py-2 text-xs font-semibold sm:flex-row sm:text-sm"
        >
          <Share2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{sharing ? '공유 중…' : '공유하기'}</span>
        </Button>

        <Button
          asChild
          variant="outline"
          className="min-h-14 flex-col gap-1.5 rounded-xl border-border bg-card px-2 py-2 text-xs font-semibold sm:flex-row sm:text-sm"
        >
          <a href={mailtoHref} target="_blank" rel="noopener noreferrer">
            <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>메일로 보내기</span>
          </a>
        </Button>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        소희는 네이버 블로그·당근에 대신 올리지 않아요. 복사하거나 저장해서 직접 올려 주세요.
      </p>
    </section>
  )
}
