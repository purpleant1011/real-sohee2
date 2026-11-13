import { notFound } from 'next/navigation'
import { ConnectorHub } from '@/features/marketing-connectors/ui/connector-hub'
import type { ConnectorHubSnapshot } from '@/features/marketing-connectors/catalog'

const DEV_FIXTURE_SNAPSHOT: ConnectorHubSnapshot = {
  workspaceId: 'dev-fixture-workspace',
  connections: [
    {
      connectorId: 'instagram',
      status: 'connected',
      lastSyncAt: '2026-11-10T00:00:00.000Z',
      capabilities: ['feed_read'],
    },
    {
      connectorId: 'threads',
      status: 'reauth_required',
      lastSyncAt: '2026-11-09T00:00:00.000Z',
      capabilities: ['post_read'],
    },
  ],
  storageReady: true,
}

export default function DevMarketingConnectorsPage() {
  if (process.env.NODE_ENV === 'production' || process.env.SOHEE_LOCAL_E2E !== '1') {
    notFound()
  }

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="mb-4 max-w-4xl mx-auto px-4">
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          개발 픽스처 환경입니다 (SOHEE_LOCAL_E2E=1). 실제 공급자 데이터 및 인증 정보는 사용되지 않습니다.
        </div>
      </div>
      <ConnectorHub snapshot={DEV_FIXTURE_SNAPSHOT} />
    </div>
  )
}
