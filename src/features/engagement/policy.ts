import type { AutoReplyDecision, DecideAutoReplyParams } from './types'

function isTimeInInterval(currentHhMm: string, startHhMm: string, endHhMm: string): boolean {
  if (startHhMm === endHhMm) return false
  if (startHhMm < endHhMm) {
    return currentHhMm >= startHhMm && currentHhMm < endHhMm
  }
  // Overnight range (e.g. 22:00 ~ 08:00)
  return currentHhMm >= startHhMm || currentHhMm < endHhMm
}

function getKstHhMm(date: Date): string {
  // Convert date to KST (UTC+9)
  const kstOffsetMs = 9 * 60 * 60 * 1000
  const kstDate = new Date(date.getTime() + kstOffsetMs)
  const hours = String(kstDate.getUTCHours()).padStart(2, '0')
  const minutes = String(kstDate.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function decideAutoReply(params: DecideAutoReplyParams): AutoReplyDecision {
  const {
    policy,
    comment,
    sentCountToday,
    now = new Date(),
    connectedAccountHandle,
    connectedAccountId,
  } = params

  // 1. Policy master toggle
  if (!policy.auto_reply_enabled) {
    return {
      shouldAutoReply: false,
      reason: '자동 답글 기능이 비활성화되어 있습니다.',
    }
  }

  // 1-1. Autonomy Level gate: L1_MANUAL requires explicit owner approval for every action
  if (policy.autonomy_level === 'L1_MANUAL') {
    return {
      shouldAutoReply: false,
      reason: '비서형(수동 승인) 모드에서는 모든 답글을 사장님이 직접 승인합니다.',
    }
  }

  // 2. Pause toggle
  if (policy.is_paused) {
    return {
      shouldAutoReply: false,
      reason: '자동 답글 기능이 일시 중지 상태입니다.',
    }
  }

  // 3. Classification safety gate
  if (!comment.classification) {
    return {
      shouldAutoReply: false,
      reason: '댓글 분류가 완료되지 않았습니다.',
    }
  }

  // Strictly prohibited classes - NEVER auto-replied regardless of policy configuration
  const strictlyBlocked = ['COMPLAINT', 'SENSITIVE', 'SPAM', 'NEEDS_HUMAN']
  if (strictlyBlocked.includes(comment.classification)) {
    return {
      shouldAutoReply: false,
      reason: '불만, 민감 문의, 스팸 또는 사람 확인 필요 항목은 자동 발송할 수 없습니다.',
    }
  }

  // QUESTION is only allowed if the owner explicitly included QUESTION in allowed_classes
  if (comment.classification === 'QUESTION' && !policy.allowed_classes.includes('QUESTION')) {
    return {
      shouldAutoReply: false,
      reason: '질문 항목은 사장님이 직접 확인하도록 설정되어 있습니다.',
    }
  }

  if (!policy.allowed_classes.includes(comment.classification)) {
    return {
      shouldAutoReply: false,
      reason: '허용된 자동 발송 분류에 포함되지 않았습니다.',
    }
  }

  // 4. Model classification confidence threshold
  const confidence = comment.confidence ?? 0
  if (confidence < policy.min_confidence) {
    return {
      shouldAutoReply: false,
      reason: `분류 신뢰도(${confidence})가 설정 기준(${policy.min_confidence}) 미만입니다.`,
    }
  }

  // 5. Daily safety quota cap per workspace + channel
  if (sentCountToday >= policy.daily_cap) {
    return {
      shouldAutoReply: false,
      reason: `일일 자동 답글 한도(${policy.daily_cap}건)에 도달했습니다.`,
    }
  }

  // 6. Quiet hours (KST 기준)
  if (
    policy.quiet_hours_enabled &&
    policy.quiet_hours_start &&
    policy.quiet_hours_end
  ) {
    const kstTime = getKstHhMm(now)
    if (isTimeInInterval(kstTime, policy.quiet_hours_start, policy.quiet_hours_end)) {
      return {
        shouldAutoReply: false,
        reason: '방해 금지 시간대에는 자동 답글을 발송하지 않습니다.',
      }
    }
  }

  // 7. Prevent auto-replying to owner/connected account's own comments
  if (
    (connectedAccountHandle && comment.author_handle.toLowerCase() === connectedAccountHandle.toLowerCase()) ||
    (connectedAccountId && comment.author_id && comment.author_id === connectedAccountId)
  ) {
    return {
      shouldAutoReply: false,
      reason: '자사 계정이 작성한 댓글에는 자동 답글을 발송하지 않습니다.',
    }
  }

  // 8. Comment age limit (default max 7 days)
  const commentCreatedAt = new Date(comment.comment_created_at)
  const commentAgeMs = now.getTime() - commentCreatedAt.getTime()
  const maxAgeDays = policy.max_comment_age_days ?? 7
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000

  if (commentAgeMs > maxAgeMs) {
    return {
      shouldAutoReply: false,
      reason: `작성된 지 ${maxAgeDays}일이 지난 댓글에는 자동 답글을 발송하지 않습니다.`,
    }
  }

  return {
    shouldAutoReply: true,
    reason: '자동 답글 발송 정책 기준을 모두 만족합니다.',
  }
}
