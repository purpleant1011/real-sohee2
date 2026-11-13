import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  CatalogUnavailableError,
  listCatalogServices,
  type CatalogServiceView,
} from '@/features/service-catalog/catalog-service'
import { createSupabaseCatalogGateway } from '@/features/service-catalog/supabase-gateway'
import { CatalogEditor } from '@/features/service-catalog/catalog-editor'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'

export const dynamic = 'force-dynamic'

const DESCRIPTION = '예약 확정에 쓰이는 가격·소요시간·담당자·취소 규칙을 관리합니다. 정확한 고객 안내를 위해 사장님이 직접 확인하고 설정해요.'

type Load =
  | { state: 'READY'; services: CatalogServiceView[] }
  | { state: 'FAILED'; message: string }

async function loadCatalog(workspaceId: string): Promise<Load> {
  try {
    const supabase = await createServerSupabaseClient()
    const services = await listCatalogServices(createSupabaseCatalogGateway(supabase), workspaceId)
    return { state: 'READY', services }
  } catch (error) {
    return {
      state: 'FAILED',
      message: error instanceof CatalogUnavailableError
        ? error.message
        : '서비스 카탈로그를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.',
    }
  }
}

export default async function ServiceCatalogPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader title="서비스 카탈로그" description={DESCRIPTION} />
        <p role="alert" className="text-sm text-destructive">매장 정보를 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요.</p>
      </div>
    )
  }

  const load = await loadCatalog(workspace.workspaceId)
  const canEdit = workspace.role === 'owner' || workspace.role === 'manager'

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsSectionHeader title="서비스 카탈로그" description={DESCRIPTION} />
      {load.state === 'FAILED' ? (
        <p role="alert" className="text-sm text-destructive">{load.message}</p>
      ) : (
        <CatalogEditor
          workspaceId={workspace.workspaceId}
          canEdit={canEdit}
          initialServices={load.services}
        />
      )}
    </div>
  )
}
