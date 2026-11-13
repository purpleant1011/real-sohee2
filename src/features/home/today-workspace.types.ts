export type AgentAutonomyMode = 'suggest' | 'approve' | 'auto'
export type AgentStatus = 'running' | 'paused' | 'attention'

export type TodayOpportunity = Readonly<{
  id: string
  channel: 'instagram' | 'naver' | 'content' | 'general'
  channelLabel: string
  occurredAt?: string
  timeAgo: string
  title: string
  customerName?: string
  content: string
  recommendation: string
  probabilityLabel?: string
  ctaText: string
  ctaHref: string
}>

export type TodayGoal = Readonly<{
  id: string
  label: string
  current: number
  target: number
  unit: string
  periodLabel?: string
}>

export type TodayScheduleItem = Readonly<{
  id: string
  at: string
  time: string
  title: string
  description?: string
  href?: string
}>

export type TodayInsight = Readonly<{
  id: string
  text: string
  evidenceLabel?: string
  metric?: string
}>

export type TodayWorkspaceModel = Readonly<{
  generatedAt: string

  agent: Readonly<{
    status: AgentStatus
    autonomyMode: AgentAutonomyMode
    currentGoal: string | null
    currentMission: string | null
    currentWork: string | null
    nextAction: string | null
  }>

  growthFlow: Readonly<{
    signals: number
    draftsReady: number
    bookings: number
  }>

  opportunities: readonly TodayOpportunity[]
  goals: readonly TodayGoal[]
  schedule: readonly TodayScheduleItem[]
  insights: readonly TodayInsight[]
}>
