'use client'

import React, { useState } from 'react'
import { loadKakaoSdk } from './load-kakao-sdk'

export interface KakaoChatButtonProps {
  /**
   * The KakaoTalk Channel Public ID (e.g. '_rqKxeX' or '_xabc123').
   * Must not be empty.
   */
  readonly channelPublicId: string

  /**
   * Optional Kakao JavaScript key.
   * If omitted, falls back to process.env.NEXT_PUBLIC_KAKAO_JS_KEY.
   */
  readonly jsKey?: string

  /**
   * Optional custom class name.
   */
  readonly className?: string

  /**
   * Optional children for custom button label.
   */
  readonly children?: React.ReactNode
}

/**
 * KakaoTalk Icon SVG (Kakao symbol)
 */
function KakaoChatIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className ?? 'size-5 shrink-0'}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3C6.477 3 2 6.477 2 10.767c0 2.766 1.87 5.187 4.707 6.551-.207.765-.75 2.77-1.077 4.02-.132.505.184.502.388.367.16-.107 2.217-1.505 3.125-2.124.606.089 1.228.136 1.857.136 5.523 0 10-3.477 10-7.767C22 6.477 17.523 3 12 3z" />
    </svg>
  )
}

/**
 * KakaoTalk 1:1 Chat Consultation Button (ANI-2085 / ANI-2111)
 *
 * Requirements:
 * - 'use client'
 * - Invokes Kakao.Channel.chat strictly on user click (never automatically)
 * - Falls back to https://pf.kakao.com/${channelPublicId}/chat when SDK fails or is unsupported
 * - Mobile touch target >= 44px
 * - Accessible aria-label="카카오톡 1:1 상담 문의"
 * - Clear Korean guidance on popup block
 */
export function KakaoChatButton({
  channelPublicId,
  jsKey,
  className = '',
  children,
}: KakaoChatButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const trimmedChannelId = channelPublicId?.trim()
  const resolvedJsKey =
    jsKey?.trim() ||
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim()
      : undefined)

  if (!trimmedChannelId) {
    return null
  }

  const openFallbackUrl = () => {
    try {
      const fallbackUrl = `https://pf.kakao.com/${trimmedChannelId}/chat`
      const openedWindow = window.open(
        fallbackUrl,
        '_blank',
        'noopener,noreferrer',
      )
      if (!openedWindow) {
        setErrorMessage(
          '팝업이 차단되었습니다. 브라우저 팝업 설정을 확인해주세요.',
        )
      }
    } catch {
      setErrorMessage(
        '팝업이 차단되었습니다. 브라우저 팝업 설정을 확인해주세요.',
      )
    }
  }

  const handleClick = async () => {
    if (isLoading) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const sdkResult = await loadKakaoSdk({ jsKey: resolvedJsKey })
      if (!sdkResult.ok) {
        openFallbackUrl()
        return
      }

      const kakao = sdkResult.kakao
      if (!kakao.Channel?.chat || typeof kakao.Channel.chat !== 'function') {
        openFallbackUrl()
        return
      }

      kakao.Channel.chat({
        channelPublicId: trimmedChannelId,
      })
    } catch {
      openFallbackUrl()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label="카카오톡 1:1 상담 문의"
        aria-busy={isLoading}
        className={`min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-lg bg-[#3A1D1D] hover:bg-[#2A1515] active:bg-[#1D0E0E] text-[#FEE500] font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3A1D1D] focus-visible:ring-offset-2 ${className}`}
      >
        <KakaoChatIcon />
        <span>{children ?? '카카오톡 1:1 상담'}</span>
      </button>

      {errorMessage && (
        <p
          role="alert"
          className="text-xs text-destructive font-normal leading-relaxed mt-0.5"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
