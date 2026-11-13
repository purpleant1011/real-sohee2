export const dynamic = 'force-dynamic'
export const revalidate = 0

import React from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminMissionTraceProjection } from '@/features/admin/mission-trace-projection'
import { Customer360CanonicalService } from '@/features/admin/customer-360-canonical-service'
import { MissionTraceExplorerView } from '@/features/operator-missions/mission-trace-explorer-view'
import { LoadErrorNotice, PageHeader } from '@/components/admin-ui/data-state'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

interface MissionPageProps {
  params: Promise<{
    missionId: string
  }>
}

export default async function AdminMissionTracePage({ params }: MissionPageProps) {
  await requireOperator('publish.read')
  const { missionId } = await params

  const adminClient = createAdminSupabaseClient()

  // 1. 미션 레코드 조회하여 workspace_id 확인 (RLS 우회를 위해 createAdminSupabaseClient 사용)
  const { data: mission, error } = await (adminClient as any)
    .from('marketing_missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle()

  if (error) {
    return (
      <div className="w-full space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild className="h-8 min-h-8 gap-1 text-xs">
            <Link href="/admin/missions">
              <ArrowLeft className="size-3.5" />
              미션 목록으로 돌아가기
            </Link>
          </Button>
        </div>
        <PageHeader title="미션 상세 관측" description="마케팅 미션의 실행 과정 및 관측 기록을 확인합니다." />
        <LoadErrorNotice what="미션 상세 정보" retryHref={`/admin/missions/${missionId}`} />
      </div>
    )
  }

  if (!mission) {
    notFound()
    return null
  }

  const workspaceId = mission.workspace_id

  // 2. 8단계 타임라인 프로젝션 및 테넌트 식별 바 조회 (JSX는 try/catch 밖에서 만든다)
  let loaded: { trace: Awaited<ReturnType<AdminMissionTraceProjection['projectMissionTrace']>>; identity: Awaited<ReturnType<Customer360CanonicalService['buildTenantIdentityBar']>> } | null = null
  try {
    const projection = new AdminMissionTraceProjection(adminClient as any)
    const trace = await projection.projectMissionTrace(workspaceId, missionId)
    const customer360Service = new Customer360CanonicalService(adminClient as any)
    const identity = await customer360Service.buildTenantIdentityBar(workspaceId)
    loaded = { trace, identity }
  } catch {
    loaded = null
  }

  if (loaded) return <MissionTraceExplorerView trace={loaded.trace} identity={loaded.identity} />
  return (
    <div className="w-full space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild className="h-8 min-h-8 gap-1 text-xs">
          <Link href="/admin/missions">
            <ArrowLeft className="size-3.5" />
            미션 목록으로 돌아가기
          </Link>
        </Button>
      </div>
      <PageHeader title="미션 상세 관측" description="마케팅 미션의 실행 과정 및 관측 기록을 확인합니다." />
      <LoadErrorNotice what="미션 트레이스 타임라인" retryHref={`/admin/missions/${missionId}`} />
    </div>
  )
}
