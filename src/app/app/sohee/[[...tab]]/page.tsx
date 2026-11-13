'use client'

import Link from 'next/link'
import { MessageCircle, Sparkles, SlidersHorizontal, Wrench, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSurfaceContext } from '@/features/agent-dock/surface-context'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { resolveSoheeTab, type SoheeTab, type WorkSection } from '@/features/sohee-menu/legacy-tab-map'
import { useGrowthSnapshot } from '@/features/sohee-menu/use-growth-snapshot'
import { useWorkspaceProfileForm } from '@/features/sohee-menu/use-workspace-profile-form'
import { SoheeStudioView } from '@/features/sohee-studio/components/sohee-studio-view'
import { TeachTab } from '@/features/sohee-menu/components/teach-tab'
import { ToolsTab } from '@/features/sohee-menu/components/tools-tab'
import { WorkTab } from '@/features/sohee-menu/components/work-tab'

export default function MySoheePage() {
  const workspaceId = useWorkspaceId()
  const { setContextDetails } = useSurfaceContext()
  const { snapshot, refresh } = useGrowthSnapshot(workspaceId)
  const form = useWorkspaceProfileForm(workspaceId, { onSaved: refresh })

  const [tab, setTab] = useState<SoheeTab>('studio')
  const [section, setSection] = useState<WorkSection | undefined>()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const resolved = resolveSoheeTab(params.get('tab'), params.get('section'))
    setTab(resolved.tab)
    setSection(resolved.section)
  }, [])

  useEffect(() => {
    setContextDetails({ tab: `${tab}${section ? `:${section}` : ''}`, entityType: 'setting' })
  }, [tab, section, setContextDetails])

  const goToTab = useCallback((next: SoheeTab) => {
    setTab(next)
    setSection(undefined)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      url.searchParams.delete('section')
      window.history.replaceState(null, '', url)
    }
  }, [])

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="space-y-5">
        {/* 상단 액션 바: 소희 메뉴 타이틀 & 소통함 바로가기 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles className="size-4" />
              </div>
              <h1 className="text-lg font-black text-foreground tracking-tight">소희 스튜디오</h1>
            </div>
            <p className="text-xs text-muted-foreground">
              소희를 가르치고, 소희가 이해한 것을 살펴보고, 원하는 목표를 달성하도록 함께 호흡하는 공간
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/app/engagement"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 text-xs font-bold text-primary hover:bg-primary/10 transition-colors shadow-2xs"
            >
              <MessageCircle className="size-4" aria-hidden />
              <span>소통함</span>
            </Link>
          </div>
        </div>

        {/* 메인 탭 네비게이션: 스튜디오(메인) / 일하는 방식 / 능력 확장 / 매장 정보 */}
        <Tabs value={tab} onValueChange={(value) => goToTab(value as SoheeTab)}>
          <TabsList aria-label="소희 관리 네비게이션" className="h-11 bg-muted/60 p-1 rounded-2xl w-full max-w-full justify-start overflow-x-auto">
            <TabsTrigger
              value="studio"
              className="text-xs font-bold flex items-center gap-1.5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-xs px-4 shrink-0"
            >
              <Sparkles className="size-3.5 text-primary" />
              <span>소희 스튜디오</span>
            </TabsTrigger>
            <TabsTrigger
              value="work"
              className="text-xs font-bold flex items-center gap-1.5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-xs px-4 shrink-0"
            >
              <SlidersHorizontal className="size-3.5" />
              <span>일하는 방식 & 정책</span>
            </TabsTrigger>
            <TabsTrigger
              value="tools"
              className="text-xs font-bold flex items-center gap-1.5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-xs px-4 shrink-0"
            >
              <Wrench className="size-3.5" />
              <span>능력 확장</span>
            </TabsTrigger>
            <TabsTrigger
              value="teach"
              className="text-xs font-bold flex items-center gap-1.5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-xs px-4 shrink-0"
            >
              <Settings className="size-3.5" />
              <span>매장 기본 정보</span>
            </TabsTrigger>
          </TabsList>

          {/* 1. 소희 스튜디오 (혁신 2-Pane 대화 & 두뇌 관제) */}
          <TabsContent value="studio" className="mt-4">
            <SoheeStudioView key={workspaceId} workspaceId={workspaceId} onGoToLegacyTab={goToTab} />
          </TabsContent>

          {/* 2. 일하는 방식 & 정책 */}
          <TabsContent value="work" className="mt-4">
            <WorkTab workspaceId={workspaceId} form={form} openSection={section} />
          </TabsContent>

          {/* 3. 능력 확장 */}
          <TabsContent value="tools" className="mt-4">
            <ToolsTab
              workspaceId={workspaceId}
              industry={form.values.industry}
              businessName={form.values.businessName}
            />
          </TabsContent>

          {/* 4. 매장 기본 정보 폼 */}
          <TabsContent value="teach" className="mt-4">
            <TeachTab
              snapshot={snapshot}
              form={form}
              workspaceId={workspaceId}
              onRefresh={() => void refresh()}
            />
          </TabsContent>
        </Tabs>
      </div>
    </V088AppShell>
  )
}
