'use client'

import dynamic from 'next/dynamic'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Customers } from '@/features/mobile-customers/r2-customers'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

const CustomersView = dynamic(
  () => import('./customers-view'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6 animate-pulse p-6">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
        </div>
      </div>
    ),
  }
)

/** 플래그 OFF(기본)·넓은 화면은 기존 화면 그대로(ANI-1771). */
export function CustomersEntry() {
  const workspaceId = useWorkspaceId()
  return useMobileR2Active() ? <R2Customers workspaceId={workspaceId} /> : <CustomersView />
}
