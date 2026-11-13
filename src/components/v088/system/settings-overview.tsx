'use client'

import React from 'react'
import Link from 'next/link'
import {
  ShieldCheck,
  ChevronRight,
} from 'lucide-react'
import { SETTINGS_GROUPS } from './settings-master-layout'
import { cn } from '@/lib/utils'

export interface SettingsOverviewProps {
  className?: string
}

/**
 * PC 설정 홈 화면 (Task 2)
 *
 * 이중 사이드바 없이 모든 설정 그룹(우리 가게, 연결, 요금·결제, 알림·계정, 도움)에
 * 접근할 수 있는 조용하고 세련된 그룹형 목록을 제공합니다.
 * 중복 없는 단일 결제 진입점(/app/account/billing)과 중립적인 운영 현황/보안 진입점을 제공합니다.
 */
export function SettingsOverview({ className }: SettingsOverviewProps) {
  return (
    <div className={cn('w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 min-w-0', className)}>
      {/* 헤더 */}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground break-words">설정</h1>
        <p className="text-sm text-muted-foreground mt-1.5 break-words">
          매장 정보, 채널 연동, 요금제 및 계정을 관리합니다.
        </p>
      </div>

      {/* 소희 활동과 안전 설정 진입 카드 (중립적 링크, 서버 근거 없는 가짜 배지 배제) */}
      <section
        aria-label="소희 활동과 안전 설정"
        className="p-5 sm:p-6 rounded-2xl bg-card border border-border/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0"
      >
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="p-2.5 rounded-xl bg-muted text-foreground shrink-0 mt-0.5">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-foreground break-words">
              소희 활동과 안전 설정
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed break-words">
              소희의 실시간 업무 활동 내역, 안전 관리 기록 및 사업자 정보 확인
            </p>
          </div>
        </div>
        <Link
          href="/app/system?section=status"
          className="inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-ring"
        >
          운영 현황 보기
        </Link>
      </section>

      {/* 5대 설정 그룹 그리드/목록 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.id} aria-label={group.label} className="space-y-2.5 min-w-0">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground break-words">
              {group.label}
            </h2>
            <div className="rounded-2xl border border-border/70 bg-card p-1.5 shadow-2xs divide-y divide-border/40 min-w-0">
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-2 focus-visible:outline-ring group min-w-0"
                  >
                    <div className="flex items-center gap-3 min-w-0 truncate">
                      <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" aria-hidden="true" />
                      <span className="truncate break-words">{item.label}</span>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" aria-hidden="true" />
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
