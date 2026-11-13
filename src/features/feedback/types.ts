import { z } from 'zod'

export const FEEDBACK_KINDS = ['GENERAL', 'PREVIEW_MISMATCH', 'PROBLEM', 'IDEA'] as const
export const FEEDBACK_TAGS = ['PREVIEW_MISMATCH', 'SPEC', 'CONNECTION', 'SPEED', 'OTHER'] as const
export const FEEDBACK_STATUSES = ['NEW', 'REVIEWING', 'APPLIED', 'ON_HOLD'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number]
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const KIND_LABEL: Record<FeedbackKind, string> = {
  GENERAL: '의견',
  PREVIEW_MISMATCH: '이 화면이 실제 앱과 달라 보여요',
  PROBLEM: '문제가 있어요',
  IDEA: '이런 기능이 있으면 좋겠어요',
}
export const TAG_LABEL: Record<FeedbackTag, string> = {
  PREVIEW_MISMATCH: '미리보기 불일치',
  SPEC: '규격',
  CONNECTION: '연결',
  SPEED: '속도',
  OTHER: '기타',
}
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  NEW: '새 의견',
  REVIEWING: '확인 중',
  APPLIED: '반영',
  ON_HOLD: '보류',
}

export const submitFeedbackSchema = z.object({
  screen: z.string().trim().min(1, '어느 화면인지 확인할 수 없어요.').max(200),
  kind: z.enum(FEEDBACK_KINDS).default('GENERAL'),
  rating: z.number().int().min(1, '평점은 1~5점으로 남겨 주세요.').max(5, '평점은 1~5점으로 남겨 주세요.').nullable().optional(),
  message: z.string().trim().min(1, '의견을 한 글자 이상 적어 주세요.').max(2000, '의견은 2000자까지 적을 수 있어요.'),
}).strict()
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>

export const triageSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  tags: z.array(z.enum(FEEDBACK_TAGS)).max(5).optional(),
  contentId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  adminNote: z.string().max(2000).nullable().optional(),
}).strict()
export type TriageInput = z.infer<typeof triageSchema>

export interface FeedbackRow {
  id: string
  workspace_id: string
  screen: string
  kind: FeedbackKind
  rating: number | null
  message: string
  tags: FeedbackTag[]
  status: FeedbackStatus
  content_id: string | null
  run_id: string | null
  admin_note: string | null
  created_by: string
  created_at: string
  deleted_at: string | null
}

/** ERROR와 EMPTY를 분리한다: 조회 실패는 절대 빈 목록이 아니다. */
export type FeedbackListResult =
  | { status: 'ERROR' }
  | { status: 'OK'; items: FeedbackRow[] }
