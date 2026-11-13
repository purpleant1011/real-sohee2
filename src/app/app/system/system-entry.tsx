'use client'

import React, { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2More } from '@/features/mobile-settings/r2-more'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

const SystemView = dynamic(
  () => import('./system-view'),
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

/** 플래그 OFF(기본)·넓은 화면은 PC 설정 홈(Task 2). 모바일 R2Active 시 기존 R2More 유지. */
export function SystemEntry() {
  const workspaceId = useWorkspaceId()
  return useMobileR2Active() ? (
    <R2More workspaceId={workspaceId} />
  ) : (
    <Suspense
      fallback={
        <div className="space-y-6 animate-pulse p-6">
          <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
            <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          </div>
        </div>
      }
    >
      <SystemView />
    </Suspense>
  )
}
