'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { SoheeLiveWorkboard } from '@/components/agent-os/sohee-live-workboard'
import { SystemTrustTabs } from '@/components/v088/system/system-trust-tabs'
import { SettingsMasterLayout } from '@/components/v088/system/settings-master-layout'
import { SettingsOverview } from '@/components/v088/system/settings-overview'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'
import { useMobileUi } from '@/features/mobile-decision/mobile-ui-provider'
import { systemDomainFromSection } from '@/features/mobile-decision/navigation'
import { useMediaQuery } from '@/hooks/use-media-query'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import type { SystemTrustDomain } from '@/types/system-trust'

function resolveInitialDomain(section: string | null): SystemTrustDomain {
  if (!section) return 'account'
  if (section === 'status') return 'health'
  if (section === 'plans') return 'plan_credits'
  return systemDomainFromSection(section) ?? 'account'
}

export default function SystemSettingsPage() {
  const workspaceId = useWorkspaceId()
  const mobileRollout = useMobileUi().enabled
  const isMobile = useMediaQuery('(max-width: 767px)')

  const searchParams = useSearchParams()
  const mobileSection = searchParams?.get('mobileSection') ?? null
  const section = searchParams?.get('section') || mobileSection || searchParams?.get('view') || null

  const mobileDomain = mobileRollout && isMobile && mobileSection
    ? systemDomainFromSection(mobileSection)
    : null

  const [isTestAccount, setIsTestAccount] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  React.useEffect(() => {
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then((res: any) => {
        if (res.data?.user?.email) {
          setUserEmail(res.data.user.email)
        }
        if (res.data?.user?.email === 'test@example.com') {
          setIsTestAccount(true)
        }
      })
    } catch {}
  }, [])

  // 모바일 전용 단순 도메인 열람 화면 (기존 계약 유지)
  if (mobileDomain) {
    return (
      <V088AppShell workspaceId={workspaceId}>
        <div className="mx-auto max-w-2xl space-y-5 pb-6">
          <Link href="/app/system" className="inline-flex min-h-11 items-center text-sm text-primary">
            더보기로 돌아가기
          </Link>
          <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            기존 설정 내용을 확인하는 화면이에요. 모바일에서 권한 변경과 데이터 내보내기는 아직 실행하지 않아요.
          </p>
          <SystemTrustTabs
            key={mobileDomain}
            workspaceId={workspaceId}
            isTestAccount={isTestAccount}
            adminEmail={userEmail}
            initialDomain={mobileDomain}
            readOnly
          />
        </div>
      </V088AppShell>
    )
  }

  // section 쿼리가 있는 경우: 소희 활동과 안전 설정 상세 화면 (전체폭 + 복귀 링크)
  if (section) {
    const initialDomain = resolveInitialDomain(section)

    return (
      <V088AppShell workspaceId={workspaceId}>
        <SettingsMasterLayout showBackLink={true}>
          <div className="space-y-6 max-w-5xl">
            <SettingsSectionHeader
              title="소희 활동과 안전 설정"
              description="소희의 실시간 업무 활동 내역, 안전 관리 기록 및 이용 요금제를 확인하고 관리합니다."
            />

            {/* Sohee Live Workboard (실시간 가동 현황) */}
            <SoheeLiveWorkboard workspaceId={workspaceId} />

            {/* Account & Trust Center 6 Core Domains (동일 URL 내 section query 변경 시 탭 stale 방지를 위해 key 동기화) */}
            <SystemTrustTabs
              key={initialDomain}
              workspaceId={workspaceId}
              isTestAccount={isTestAccount}
              adminEmail={userEmail}
              initialDomain={initialDomain}
            />

            {/* 요금제 및 결제 안내 섹션 */}
            <div className="p-6 rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-extrabold text-zinc-950 dark:text-zinc-50">
                  요금제 및 결제 안내
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  서비스 이용권을 담은 요금제와 결제 준비 현황을 확인하실 수 있어요.
                </p>
              </div>
              <Link
                href="/app/account/billing"
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition-all shadow-xs shrink-0"
              >
                요금제와 결제 보기
              </Link>
            </div>
          </div>
        </SettingsMasterLayout>
      </V088AppShell>
    )
  }

  // 기본 PC 설정 홈 (SettingsOverview)
  return (
    <V088AppShell workspaceId={workspaceId}>
      <SettingsOverview />
    </V088AppShell>
  )
}
