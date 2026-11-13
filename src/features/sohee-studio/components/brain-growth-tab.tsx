'use client'

import React from 'react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LevelLadder } from '@/features/sohee-menu/components/level-ladder'
import { JobUnlockStrip } from '@/features/sohee-menu/components/job-unlock-strip'
import { GrowthCard } from '@/features/sohee-menu/components/growth-card'
import { StatusLine } from '@/features/sohee-menu/components/status-line'
import { useGrowthSnapshot } from '@/features/sohee-menu/use-growth-snapshot'
import type { SoheeTab } from '@/features/sohee-menu/legacy-tab-map'

interface BrainGrowthTabProps {
  workspaceId: string
  onGoToLegacyTab?: (tab: SoheeTab) => void
}

export function BrainGrowthTab({ workspaceId, onGoToLegacyTab }: BrainGrowthTabProps) {
  const { snapshot, loading, error, refresh } = useGrowthSnapshot(workspaceId)

  if (loading && !snapshot) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <Card className="p-6 text-center text-xs text-muted-foreground">
        성장 지표를 불러올 수 없습니다.
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <GrowthCard snapshot={snapshot} onGoToTab={onGoToLegacyTab || (() => {})}>
        <StatusLine workspaceId={workspaceId} />
      </GrowthCard>

      <JobUnlockStrip jobs={snapshot.jobs} onGoToTab={onGoToLegacyTab || (() => {})} />

      <LevelLadder ladder={snapshot.level.ladder} />
    </div>
  )
}
