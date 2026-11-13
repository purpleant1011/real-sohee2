'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2KakaoHistory } from '@/features/mobile-kakao/r2-kakao'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

const KakaoView = dynamic(
  () => import('./kakao-view').then((mod) => mod.KakaoView),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6 animate-pulse p-6">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-zinc-100 dark:bg-zinc-900 rounded-2xl" />
          ))}
        </div>
      </div>
    ),
  }
)

export function KakaoEntry() {
  const workspaceId = useWorkspaceId()
  return useMobileR2Active() ? (
    <R2KakaoHistory workspaceId={workspaceId} />
  ) : (
    <KakaoView workspaceId={workspaceId} />
  )
}
