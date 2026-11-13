import crypto from 'node:crypto'

export interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove'
  type: string
  data: {
    id: string
    identifier: string
    title: string
    state?: {
      id: string
      name: string
      type: string // 'completed', 'started', 'unstarted', 'backlog', 'canceled'
    }
    archivedAt?: string | null
    [key: string]: unknown
  }
  updatedFrom?: {
    stateId?: string
    state?: {
      id: string
      name: string
      type: string
    }
    [key: string]: unknown
  }
  createdAt: string
  url?: string
}

export const LINEAR_ARCHIVE_GRACE_PERIOD_SECONDS = 900 // 15분

/**
 * Linear Webhook HMAC-SHA256 서명 검증
 */
export function verifyLinearWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (!signature || !secret) return false

  try {
    const hmac = crypto.createHmac('sha256', secret)
    const digest = hmac.update(rawBody).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}

/**
 * 완료(Done/completed) 상태로의 신규 전환 여부 확인
 */
export function shouldEnqueueDelayedArchive(payload: LinearWebhookPayload): boolean {
  if (payload.type !== 'Issue' || payload.action !== 'update') {
    return false
  }

  const currentState = payload.data.state
  if (!currentState || currentState.type !== 'completed') {
    return false
  }

  // 이전 상태가 completed가 아니었을 때만 (신규 완료 전이)
  const previousState = payload.updatedFrom?.state
  if (previousState && previousState.type === 'completed') {
    return false
  }

  return true
}

export interface LinearApiClient {
  getIssue: (id: string) => Promise<{ id: string; state: { type: string }; archivedAt: string | null } | null>
  archiveIssue: (id: string) => Promise<{ success: boolean }>
}

export type ArchiveProcessResult =
  | { status: 'ARCHIVED'; issueId: string }
  | { status: 'SKIPPED_REOPENED'; issueId: string; currentState: string }
  | { status: 'SKIPPED_ALREADY_ARCHIVED'; issueId: string }
  | { status: 'NOT_FOUND'; issueId: string }

/**
 * 15분 경과 후 지연 아카이브 실행기
 */
export async function processDelayedArchiveJob(
  issueId: string,
  client: LinearApiClient
): Promise<ArchiveProcessResult> {
  const issue = await client.getIssue(issueId)
  if (!issue) {
    return { status: 'NOT_FOUND', issueId }
  }

  // 이미 아카이브된 경우
  if (issue.archivedAt) {
    return { status: 'SKIPPED_ALREADY_ARCHIVED', issueId }
  }

  // 중간에 재오픈된 경우 (completed가 아님)
  if (issue.state.type !== 'completed') {
    return { status: 'SKIPPED_REOPENED', issueId, currentState: issue.state.type }
  }

  // 여전히 완료 상태이면 GraphQL issueArchive 실행
  const res = await client.archiveIssue(issueId)
  if (!res.success) {
    throw new Error(`Failed to archive Linear issue: ${issueId}`)
  }

  return { status: 'ARCHIVED', issueId }
}
