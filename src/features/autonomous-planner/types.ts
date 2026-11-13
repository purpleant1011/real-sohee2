export type PlannerThemeKey = 'story' | 'tip' | 'consultation' | 'community'

export interface PlannedContentItem {
  themeKey: PlannerThemeKey
  themeTitle: string
  instagramCaption: string
  threadsText: string
  scheduledSlot: string // ISO string
  hashtags: string[]
  suggestedImageUrl?: string | null
}

export interface PlannerConfig {
  workspaceId: string
  frequencyPerWeek: number
  targetDaysOfWeek: number[] // 2: 화, 4: 목, 6: 토
  targetHour: number // 19 (저녁 7시)
  channels: ('instagram' | 'threads')[]
  defaultTone: 'witty' | 'polite' | 'friendly'
}
