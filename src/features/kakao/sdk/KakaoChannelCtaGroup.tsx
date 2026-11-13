'use client'

import React from 'react'
import { FollowChannelButton } from './FollowChannelButton'
import { KakaoChatButton } from './KakaoChatButton'

export interface KakaoChannelCtaGroupProps {
  /**
   * KakaoTalk Channel Public ID.
   * If omitted, falls back to process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID or default '_rqKxeX'.
   */
  readonly channelPublicId?: string

  /**
   * Optional Kakao JavaScript key.
   */
  readonly jsKey?: string

  /**
   * Layout direction for the buttons.
   * - 'responsive': vertical on small screens, horizontal on larger screens (default)
   * - 'vertical': always vertical column
   * - 'horizontal': always horizontal row
   */
  readonly layout?: 'responsive' | 'vertical' | 'horizontal'

  /**
   * Whether to display the guide text above the buttons.
   * @default true
   */
  readonly showGuideText?: boolean

  /**
   * Custom guide text.
   * @default "궁금한 점이 있으신가요? 카카오톡으로 편하게 문의하세요"
   */
  readonly guideText?: string

  /**
   * Optional custom container class name.
   */
  readonly className?: string

  /**
   * Custom label for the follow button.
   * Note: strictly avoid fake-done labels (e.g. "추가 완료").
   */
  readonly followButtonText?: string

  /**
   * Custom label for the 1:1 chat button.
   * Note: strictly avoid fake-done labels (e.g. "상담 접수 완료").
   */
  readonly chatButtonText?: string
}

const DEFAULT_CHANNEL_PUBLIC_ID = '_rqKxeX'
const DEFAULT_GUIDE_TEXT = '궁금한 점이 있으신가요? 카카오톡으로 편하게 문의하세요'

/**
 * KakaoTalk Integrated Channel CTA Group (ANI-2085 / ANI-2111)
 *
 * Combines Channel Follow and 1:1 Chat Consultation into a cohesive responsive CTA section.
 * Protects against fake-done claims by using explicit action-oriented button copy.
 */
export function KakaoChannelCtaGroup({
  channelPublicId,
  jsKey,
  layout = 'responsive',
  showGuideText = true,
  guideText = DEFAULT_GUIDE_TEXT,
  className = '',
  followButtonText,
  chatButtonText,
}: KakaoChannelCtaGroupProps) {
  const resolvedChannelId =
    channelPublicId?.trim() ||
    (typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID?.trim()) ||
    DEFAULT_CHANNEL_PUBLIC_ID

  const layoutClasses =
    layout === 'vertical'
      ? 'flex flex-col gap-2.5 w-full sm:w-auto'
      : layout === 'horizontal'
        ? 'flex flex-row flex-wrap items-center gap-2.5'
        : 'flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto'

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {showGuideText && (
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {guideText}
        </p>
      )}

      <div data-cta-buttons className={layoutClasses}>
        <FollowChannelButton
          channelPublicId={resolvedChannelId}
          jsKey={jsKey}
        >
          {followButtonText}
        </FollowChannelButton>

        <KakaoChatButton
          channelPublicId={resolvedChannelId}
          jsKey={jsKey}
        >
          {chatButtonText}
        </KakaoChatButton>
      </div>
    </div>
  )
}
