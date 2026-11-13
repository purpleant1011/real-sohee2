'use client'

import React, { useState } from 'react'
import { Link2, Check, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface CopyBookingRequestLinkButtonProps {
  workspaceId: string
  label?: string
  className?: string
  variant?: 'default' | 'outline' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}

export function CopyBookingRequestLinkButton({
  workspaceId,
  label = '예약 신청 링크 복사',
  className,
  size = 'sm',
}: Readonly<CopyBookingRequestLinkButtonProps>) {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  const handleCopy = async () => {
    if (loading) return
    setLoading(true)

    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/booking-request/link`)
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok || !data?.url) {
        toast.error(data?.error || '예약 신청 링크를 가져오지 못했어요.')
        return
      }

      const url: string = data.url

      let success = false
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url)
          success = true
        } catch {
          success = false
        }
      }

      if (success) {
        setCopied(true)
        toast.success('예약 신청 링크를 복사했어요')
        setTimeout(() => setCopied(false), 2000)
      } else {
        // 클립보드 복사 실패 시 입력창 모달로 표시
        setFallbackUrl(url)
      }
    } catch {
      toast.error('네트워크 오류가 발생했습니다. 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        disabled={loading}
        aria-label={label}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors cursor-pointer border border-input bg-background hover:bg-muted text-foreground shadow-2xs',
          size === 'sm' ? 'px-3 py-1.5 text-xs min-h-9' : 'px-3.5 py-2 text-sm min-h-11',
          loading && 'opacity-60 cursor-not-allowed',
          className
        )}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-state-ok shrink-0" />
        ) : (
          <Link2 className="w-3.5 h-3.5 text-primary shrink-0" />
        )}
        <span>{copied ? '복사됨' : loading ? '생성 중...' : label}</span>
      </button>

      {/* 클립보드 복사 실패 시 Fallback 입력창 모달 */}
      {fallbackUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fallback-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-sm rounded-2xl bg-card border border-border p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 id="fallback-dialog-title" className="text-sm font-bold text-foreground">
                예약 신청 링크
              </h3>
              <button
                type="button"
                onClick={() => setFallbackUrl(null)}
                aria-label="닫기"
                className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              아래 링크를 복사하여 고객에게 전달해 주세요.
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={fallbackUrl}
                onFocus={(e) => e.target.select()}
                className="w-full rounded-xl border border-input bg-background p-2.5 text-base text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(fallbackUrl)
                    toast.success('링크를 복사했어요')
                  } catch {
                    // Ignore
                  }
                }}
                className="p-2.5 rounded-xl border border-input bg-muted hover:bg-accent text-foreground cursor-pointer shrink-0"
                aria-label="링크 복사"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setFallbackUrl(null)}
                className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
