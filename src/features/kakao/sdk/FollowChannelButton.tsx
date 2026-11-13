'use client'

import React, { useState } from 'react'
import { loadKakaoSdk } from './load-kakao-sdk'

export interface FollowChannelButtonProps {
  /**
   * The KakaoTalk Channel Public ID (e.g. '_xabc123' or 'your-channel-name').
   * Must not be empty. Hardcoding a default value is strictly prohibited.
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
 * KakaoTalk Channel Follow Button (KAPI-19 / KAPI-41)
 *
 * Requirements:
 * - 'use client'
 * - Returns null when environment is unconfigured (missing channelPublicId or jsKey)
 * - Invokes Kakao.Channel.addChannel strictly on user click (never automatically)
 * - Mobile touch target >= 44px
 * - Accessible aria-label
 * - Clear Korean error guidance on failure or popup block
 */
export function FollowChannelButton({
  channelPublicId,
  jsKey,
  className = '',
  children,
}: FollowChannelButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const trimmedChannelId = channelPublicId?.trim()
  const resolvedJsKey =
    jsKey?.trim() ||
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim()
      : undefined)

  // Guard: if channelPublicId or jsKey is missing, do not render (environment unconfigured)
  if (!trimmedChannelId || !resolvedJsKey) {
    return null
  }

  const handleClick = async () => {
    if (isLoading) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const sdkResult = await loadKakaoSdk({ jsKey: resolvedJsKey })
      if (!sdkResult.ok) {
        setErrorMessage(
          '카카오톡 채널을 연결할 수 없습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해주세요.',
        )
        return
      }

      const kakao = sdkResult.kakao
      if (!kakao.Channel?.addChannel) {
        setErrorMessage(
          '카카오톡 채널 추가 기능을 지원하지 않는 환경입니다. 브라우저를 확인해주세요.',
        )
        return
      }

      kakao.Channel.addChannel({
        channelPublicId: trimmedChannelId,
      })
    } catch {
      setErrorMessage(
        '팝업이 차단되었거나 채널 연결에 실패했습니다. 브라우저 설정을 확인해주세요.',
      )
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
        aria-label="카카오톡 채널 추가"
        aria-busy={isLoading}
        className={`min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-lg bg-[#FEE500] hover:bg-[#FDD800] active:bg-[#ECC900] text-[#191919] font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FEE500] focus-visible:ring-offset-2 ${className}`}
      >
        <KakaoChatIcon />
        <span>{children ?? '카카오톡 채널 추가'}</span>
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
