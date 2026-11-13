export interface RivalInsight {
  id: string
  rivalName: string
  locationDistance: string
  observedTrend: string
  customerPainPoint: string
  counterAngle: string
}

export interface CounterCampaignProposal {
  id: string
  topic: string
  headline: string
  targetPainPoint: string
  caption: string
  hashtags: string[]
  recommendedChannels: ('instagram' | 'threads' | 'naver_blog')[]
  expectedAdvantage: string
  createdAt: string
}
