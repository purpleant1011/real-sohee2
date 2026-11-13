'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  Menu,
  X,
  Sparkles,
  Settings,
  Coins,
  ShieldCheck,
  Activity,
  LogOut,
  ChevronRight,
  MessageSquareText,
  Globe,
} from 'lucide-react'

interface MobileMoreMenuSheetProps {
  workspaceName: string
  userName?: string
  userEmail?: string
  userAvatar?: string
  onOpenActivityLog: () => void
  onOpenGuide: () => void
  onLogout: () => void
  isLoggingOut: boolean
}

export function MobileMoreMenuSheet({
  workspaceName,
  userName,
  userEmail,
  userAvatar,
  onOpenActivityLog,
  onOpenGuide,
  onLogout,
  isLoggingOut,
}: MobileMoreMenuSheetProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="더보기 메뉴 열기"
        aria-expanded={isOpen}
        className="p-2 sm:p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-bold flex items-center shadow-xs cursor-pointer min-h-11 min-w-10 sm:min-w-11 justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Menu className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in duration-200">
          <div
            className="w-full max-w-xs h-full bg-background border-l border-border flex flex-col justify-between shadow-2xl p-5 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="더보기 메뉴"
          >
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/70 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-state-ok" />
                  <span className="font-bold text-sm text-foreground truncate max-w-[180px]">
                    {workspaceName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                  aria-label="메뉴 닫기"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* PC 동일 기능 모바일 확장 탐색 */}
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block px-2 mb-1.5">
                  도구 및 센터
                </span>

                <Link
                  href="/app/channels"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-primary" />
                    <span>채널 연결</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>

                <Link
                  href="/app/ads"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span>광고 센터</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>

                <Link
                  href="/app/kakao"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <MessageSquareText className="w-4 h-4 text-state-warn" />
                    <span>카카오 안내 내역</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>

                <Link
                  href="/app/system"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Settings className="w-4 h-4 text-zinc-500" />
                    <span>설정 & 연결</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false)
                    onOpenActivityLog()
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Activity className="w-4 h-4 text-state-ok" />
                    <span>24시간 소희 업무 기록</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false)
                    onOpenGuide()
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-state-warn" />
                    <span>소희 AI 가이드 (튜토리얼)</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* 보호 규칙 및 크레딧 */}
              <div className="space-y-1 pt-3 border-t border-border/70">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block px-2 mb-1.5">
                  안전 및 크레딧
                </span>

                <Link
                  href="/app/sohee"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4 text-state-danger" />
                    <span>안전 보호 규칙</span>
                  </div>
                  <span className="text-[11px] font-bold text-state-danger">준수 중</span>
                </Link>

                <Link
                  href="/app/sohee"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/70 text-sm font-semibold text-foreground transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Coins className="w-4 h-4 text-primary" />
                    <span>소희 크레딧 충전/관리</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              </div>
            </div>

            {/* User & Logout */}
            <div className="pt-4 border-t border-border/70 space-y-3">
              {(userName || userEmail) && (
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-state-wait text-white font-bold flex items-center justify-center shrink-0 text-xs overflow-hidden">
                    {userAvatar ? (
                      <img src={userAvatar} alt={userName} className="w-full h-full object-cover" />
                    ) : (
                      userName ? userName.slice(0, 1).toUpperCase() : 'G'
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-foreground truncate">
                      {userName || '사용자'}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {userEmail}
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  onLogout()
                }}
                disabled={isLoggingOut}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-state-danger-soft text-state-danger font-bold text-xs hover:bg-state-danger-soft transition-colors cursor-pointer min-h-[44px]"
              >
                <LogOut className="w-4 h-4" />
                <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃 (EXIT)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
