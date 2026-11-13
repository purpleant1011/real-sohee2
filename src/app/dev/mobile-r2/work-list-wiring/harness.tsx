'use client'

import { MobileHubView } from '@/features/mobile-hub/hub-view'
import { useWorkItems } from '@/features/mobile-hub/use-work-items'

// Reserved fixture identity. Browser tests intercept this GET with local fixture responses.
const workspaceId = '00000000-0000-4000-8000-000000000000'

export function WorkListWiringHarness() {
  const source = useWorkItems(workspaceId)
  return <MobileHubView workspaceId={workspaceId} source={source} />
}
