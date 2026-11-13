'use client'

import React, { type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Store,
  Palette,
  Sparkles,
  BookOpen,
  Share2,
  FileText,
  Smartphone,
  CreditCard,
  Bot,
  Bell,
  Users,
  User,
  HelpCircle,
  FileCheck,
  ShieldCheck,
  Link2,
  ChevronLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type SettingsGroupId = 'store' | 'channels' | 'billing' | 'account' | 'help'

export interface SettingsMenuItem {
  id: string
  label: string
  href: string
  icon: React.ElementType
}

export interface SettingsGroup {
  id: SettingsGroupId
  label: string
  items: SettingsMenuItem[]
}

export const SETTINGS_GROUPS: ReadonlyArray<SettingsGroup> = [
  {
    id: 'store',
    label: '우리 가게',
    items: [
      { id: 'business', label: '가게 기본 정보', href: '/app/settings/business', icon: Store },
      { id: 'brand', label: '사진/말투 기준', href: '/app/settings/brand', icon: Palette },
      { id: 'image-style', label: '이미지 스타일', href: '/app/settings/image-style', icon: Sparkles },
      { id: 'services', label: '서비스 카탈로그', href: '/app/settings/services', icon: BookOpen },
    ],
  },
  {
    id: 'channels',
    label: '연결',
    items: [
      { id: 'channels-hub', label: '채널 연결', href: '/app/channels', icon: Share2 },
      { id: 'connectors', label: '업무 도구 연결', href: '/app/connectors', icon: Link2 },
      { id: 'naver', label: '네이버 블로그 안내', href: '/app/settings/channels/naver', icon: FileText },
      { id: 'daangn', label: '당근 비즈프로필', href: '/app/settings/channels/daangn', icon: Smartphone },
    ],
  },
  {
    id: 'billing',
    label: '요금·결제',
    items: [
      { id: 'billing', label: '요금제 및 결제', href: '/app/account/billing', icon: CreditCard },
    ],
  },
  {
    id: 'account',
    label: '알림·계정',
    items: [
      { id: 'automation', label: '자동 업무 설정', href: '/app/settings/automation', icon: Bot },
      { id: 'notifications', label: '알림 설정', href: '/app/notifications', icon: Bell },
      { id: 'members', label: '구성원 및 권한', href: '/app/settings/members', icon: Users },
      { id: 'account-profile', label: '내 계정', href: '/app/account', icon: User },
    ],
  },
  {
    id: 'help',
    label: '도움',
    items: [
      { id: 'help-center', label: '도움말', href: '/app/help', icon: HelpCircle },
      { id: 'terms', label: '이용약관', href: '/terms', icon: FileCheck },
      { id: 'privacy', label: '개인정보처리방침', href: '/privacy', icon: ShieldCheck },
    ],
  },
]

export interface SettingsMasterLayoutProps {
  children: ReactNode
  className?: string
  showBackLink?: boolean
}

/**
 * PC 설정 상세 레이아웃 (Task 2)
 *
 * 기존 360px 세로 메뉴(중복 사이드바)를 제거하고 전체폭 본문과 명확한 '설정 홈' 복귀 링크를 제공합니다.
 * forceMobile 환경에서도 PC 설정 사이드바가 노출되지 않습니다.
 * landmark 중복을 피하기 위해 부모 main과 겹치지 않도록 section(aria-label="설정 상세 내용")을 사용합니다.
 */
export function SettingsMasterLayout({ children, className, showBackLink }: SettingsMasterLayoutProps) {
  const pathname = usePathname() ?? ''
  const shouldShowBackLink = showBackLink ?? (pathname !== '/app/system')

  return (
    <div className={cn('w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 min-w-0', className)}>
      {shouldShowBackLink && (
        <nav aria-label="설정 탐색" className="mb-4">
          <Link
            href="/app/system"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="설정 홈으로 이동"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
            <span>설정 홈</span>
          </Link>
        </nav>
      )}
      <section aria-label="설정 상세 내용" className="min-w-0 w-full">{children}</section>
    </div>
  )
}
