export type FactCategory =
  | 'MENU'
  | 'PRICE'
  | 'HOURS'
  | 'DIFFERENTIATOR'
  | 'FAQ'
  | 'PROHIBITED'
  | 'MANUAL'

export type FactSource = 'interview' | 'file' | 'manual'

export interface FactItem {
  id: string
  category: FactCategory | string
  content: string
  createdAt: string
  source: FactSource
}

export interface CreateFactInput {
  workspaceId: string
  userId: string
  category: string
  content: string
}

export interface UpdateFactInput {
  workspaceId: string
  userId: string
  factId: string
  content: string
}

export interface ExpireFactInput {
  workspaceId: string
  userId: string
  factId: string
}

export interface InquiryQuestion {
  id: string
  category: string
  question: string
  reason: string
  placeholder: string
  suggestedChips: string[]
}

export interface SeasonTrigger {
  id: string
  seasonName: string
  title: string
  description: string
  actionPrompt: string
  targetCategory: string
}

export interface CompetitiveInsight {
  id: string
  strengthHighlight: string
  recommendation: string
  targetKeyword?: string
}

export interface KnowledgeIntelligenceResult {
  inquiry: InquiryQuestion | null
  seasonTrigger: SeasonTrigger | null
  competitiveInsight: CompetitiveInsight | null
  lastAnalyzedAt: string
}

