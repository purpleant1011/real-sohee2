'use client'

import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { VaultBoard } from '@/features/vault/ui/board/vault-board'

export function VaultBoardPage() {
  const workspace = useOptionalWorkspaceContext()
  return <V088AppShell workspaceId={workspace?.workspaceId}>
    <VaultBoard workspaceId={workspace?.workspaceId} />
  </V088AppShell>
}
