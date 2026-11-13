export type HarnessRule = Readonly<{
  id: string
  workspaceId: string
  ruleKey: string
  ruleType: string
  title: string
  description: string | null
  structuredRule: Readonly<Record<string, unknown>>
  appliesToChannels: readonly ('instagram' | 'threads' | 'naver_blog' | 'naver_place')[]
  status: 'active'
  version: number
  approvedByUserId: string
  approvedAt: string
}>

export type KnowledgeFact = Readonly<{
  id: string
  workspaceId: string
  category: string
  content: string
  status: 'active'
  sourceCandidateId: string
  approvedAt: string
  validFrom: string
  validUntil: string | null
}>
