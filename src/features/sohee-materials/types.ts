export type MaterialStatus = 'received' | 'needs_review' | 'learned' | 'attention'
export type MaterialKind = 'file' | 'url'
export type MaterialSourceType = 'item' | 'source'

export interface ExtractedSuggestion {
  id: string
  category: 'MENU' | 'PRICE' | 'HOURS' | 'DIFFERENTIATOR' | 'FAQ' | 'PROHIBITED' | 'MANUAL' | string
  content: string
  confidence?: number
}

export interface MaterialItem {
  id: string
  source: MaterialSourceType
  name: string
  kind: MaterialKind
  status: MaterialStatus
  createdAt: string
  suggestions?: ExtractedSuggestion[]
  suggestionsCount?: number
}

export interface PromoteSuggestionsInput {
  workspaceId: string
  userId: string
  materialId: string
  materialName: string
  suggestions: Array<{ category: string; content: string }>
}

export interface WorkspaceMaterialsResult {
  items: MaterialItem[]
  learnedCount: number
}
