type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function date(value: unknown): string | null {
  const valueText = text(value)
  return valueText && Number.isFinite(Date.parse(valueText)) ? valueText : null
}

export interface ConfirmedPublishAttemptProof {
  evidenceId: string
  providerReference: string
  observedAt: string
  channel: string
  permalink: string
  source: 'publish_attempts.permalink_readback'
}

export interface ParseConfirmedPublishAttemptInput {
  attempt: Row
  tracking?: Row | null
  workspaceId: string
  scheduleId: string
  channel: string
}

/**
 * 채널별 정본 퍼머링크 도메인 및 실제 게시물 경로 검증.
 * - 반드시 https 이어야 하며, username/password/비표준 port 등 위장 URL 을 차단한다.
 * - 단순 프로필 URL(/username 등)을 엄격히 거부하고, 실제 게시물 식별 경로만 인정한다.
 */
function isValidChannelPermalink(urlText: string, channel: string): boolean {
  try {
    const parsed = new URL(urlText)
    if (parsed.protocol !== 'https:') return false
    // 위장 인증정보 또는 비표준 포트 차단
    if (parsed.username || parsed.password) return false
    if (parsed.port && parsed.port !== '443') return false

    const host = parsed.hostname.toLowerCase()
    const normChannel = channel.toLowerCase()
    const pathname = parsed.pathname

    if (normChannel === 'instagram') {
      const isHostValid = host === 'instagram.com' || host === 'www.instagram.com'
      if (!isHostValid) return false
      // 실제 게시물 또는 릴스 경로여야 한다 (/p/:shortcode 또는 /reel/:shortcode). 단순 프로필 경로는 거부한다.
      return /^\/(p|reel)\/[A-Za-z0-9_-]+(?:\/.*)?$/u.test(pathname)
    }

    if (normChannel === 'threads') {
      const isHostValid =
        host === 'threads.net' || host === 'www.threads.net' || host === 'threads.com' || host === 'www.threads.com'
      if (!isHostValid) return false
      // Threads 실제 포스트 경로여야 한다 (/@user/post/:id). 단순 프로필 경로는 거부한다.
      return /^\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+(?:\/.*)?$/u.test(pathname)
    }

    // 네이버 블로그 등 타 채널은 Meta 독립 GET 프로버 대상이 아니므로 거부한다 (정책 위반 방지)
    return false
  } catch {
    return false
  }
}

/**
 * publish_attempts + social_post_tracking 기반 게시 확인 순수 판정 함수.
 *
 * 엄격한 정본 규칙:
 * 1. raw status 만을 절대 신뢰하지 않는다.
 * 2. status === 'succeeded' AND error_code === null (필드 누락/undefined 금지)
 * 3. workspace_id, schedule_id 가 일치해야 한다.
 * 4. provider_request_id 유효 (요청 증거 존재)
 * 5. provider_reference 유효 (게시물 식별자 존재)
 * 6. finished_at 파싱 가능한 ISO 날짜
 * 7. tracking 이 연결되어야 하며 tracking.publish_attempt_id === attempt.id
 * 8. tracking.destination_url 이 Instagram/Threads 공식 https 게시물 경로여야 한다.
 */
export function parseConfirmedPublishAttempt(
  input: ParseConfirmedPublishAttemptInput,
): ConfirmedPublishAttemptProof | null {
  const { attempt, tracking, workspaceId, scheduleId, channel } = input
  if (!attempt || !workspaceId || !scheduleId || !channel) return null

  // 1. 테넌트 및 스케줄 격리
  if (text(attempt.workspace_id) !== workspaceId) return null
  if (text(attempt.schedule_id) !== scheduleId) return null

  // 2. 실행 성공 및 오류 없음 검증 (SQL 8필드 실측: error_code 가 반드시 null 이어야 함, 누락/undefined 거부)
  if (text(attempt.status) !== 'succeeded') return null
  if (attempt.error_code !== null) return null
  if (attempt.error_message !== undefined && attempt.error_message !== null && text(attempt.error_message) !== null) {
    return null
  }

  // 3. 공급자 요청 ID 및 게시물 참조 ID 검증
  const providerRequestId = text(attempt.provider_request_id)
  const providerReference = text(attempt.provider_reference)
  if (!providerRequestId || !providerReference) return null

  // 4. 완료 시각 검증
  const observedAt = date(attempt.finished_at)
  if (!observedAt) return null

  const attemptId = text(attempt.id)
  if (!attemptId) return null

  // 5. 트래킹 레코드 검증 (GET permalink 가 저장된 레코드)
  if (!tracking) return null
  if (text(tracking.workspace_id) !== workspaceId) return null
  if (text(tracking.publish_attempt_id) !== attemptId) return null

  const permalink = text(tracking.destination_url)
  if (!permalink) return null
  if (!isValidChannelPermalink(permalink, channel)) return null

  return {
    evidenceId: attemptId,
    providerReference,
    observedAt,
    channel: channel.toLowerCase(),
    permalink,
    source: 'publish_attempts.permalink_readback',
  }
}
