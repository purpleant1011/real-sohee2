import type { QuickPostItem } from '@/components/quick-post/types'
import type { ReadinessView } from '@/features/readiness'
import type { VaultSummaryDto } from '@/features/vault/query/types'

export type TodayCardState =
  | 'PAUSED'
  | 'INQUIRY_RECEIVED'
  | 'READY_POST'
  | 'AUTONOMOUS_POST_DUE'
  | 'NEEDS_REAPPROVAL'
  | 'CONNECT_CHANNEL'
  | 'NO_POST_YET'

export interface TodayCardData {
  state: TodayCardState
  title: string
  description: string
  ctaLabel: string
  ctaHref: string
  badgeLabel: string
  postId?: string
  postTopic?: string
  postImageUrl?: string | null
}

export interface VaultSummaryLineData {
  storedCount: number | null
  externalActionCount: number | null
  thisWeekCount: number | null
  hasError: boolean
  lineText: string
}

export interface HomeMetricItem {
  key: 'posts' | 'inquiries' | 'reservations'
  label: string
  value: number | null
  emptyLabel: string
  actionLabel: string
  actionHref: string
}

export interface HomeMetricsData {
  posts: HomeMetricItem
  inquiries: HomeMetricItem
  reservations: HomeMetricItem
}

export interface AutonomousScheduleInfo {
  scheduledToday: boolean
  slotTime?: string
  topic?: string
}

export interface EvaluateTodayCardInput {
  readiness: ReadinessView | null
  vaultSummary: VaultSummaryDto | null
  posts: QuickPostItem[] | null
  channelsConnected?: boolean | null
  inquiryCount?: number | null
  upcomingPlannedTheme?: string | null
  autonomousSchedule?: AutonomousScheduleInfo | null
}
