'use client'

import { WeeklyTruthSummary } from '@/features/reporting/weekly-truth-summary'

export interface CeoMondayReportCardProps {
  workspaceId?: string
  /** Unverified legacy inputs are intentionally not used. */
  confirmedBookings?: number
  postsPublished?: number
}

export function CeoMondayReportCard({ workspaceId }: CeoMondayReportCardProps) {
  if (!workspaceId) return <p role="status" className="text-sm text-muted-foreground">성과 집계에 필요한 사업장을 확인해 주세요.</p>
  return <WeeklyTruthSummary workspaceId={workspaceId} />
}
