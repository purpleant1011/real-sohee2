export type InterviewCategory =
  | 'MENU'
  | 'PRICE'
  | 'HOURS'
  | 'DIFFERENTIATOR'
  | 'FAQ'
  | 'PROHIBITED'

export interface InterviewQuestion {
  id: string
  category: InterviewCategory
  key: string
  prompt: string
  chips: string[]
  placeholder?: string
}

export interface ConfirmInterviewFactInput {
  workspaceId: string
  userId: string
  questionId: string
  category: InterviewCategory | string
  key?: string
  rawAnswer: string
  summarizedContent: string
}

export interface ConfirmInterviewFactResult {
  factId: string
  category: string
  content: string
}

export interface InterviewProgressResult {
  totalQuestions: number
  answeredQuestionIds: string[]
  nextQuestionId: string | null
  progressPercent: number
  isCompleted: boolean
}
