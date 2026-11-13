export type PublishFailureCode =
  | 'PUBLISH_RETRYABLE'
  | 'PUBLISH_RECONNECT_REQUIRED'
  | 'PUBLISH_REAPPROVAL_REQUIRED'
  | 'PUBLISH_RECONCILE_REQUIRED'
  | 'PUBLISH_PERMANENT_FAILURE'

export type PublishFailureAction =
  | '다시 시도'
  | '채널 다시 연결'
  | '다시 승인'
  | '외부 채널 확인'
  | '고객 지원 문의'

export type PublishFailureClassification = Readonly<{
  code: PublishFailureCode
  retryable: boolean
  action: PublishFailureAction
}>

function classification(
  code: PublishFailureCode,
  retryable: boolean,
  action: PublishFailureAction,
): PublishFailureClassification {
  return Object.freeze({ code, retryable, action })
}

export function classifyPublishFailure(code: unknown): PublishFailureClassification {
  switch (code) {
    case 'TEMPORARY_NETWORK':
    case 'RATE_LIMITED':
    case 'RECONCILED_NO_POST':
      return classification('PUBLISH_RETRYABLE', true, '다시 시도')
    case 'TOKEN_EXPIRED':
      return classification('PUBLISH_RECONNECT_REQUIRED', false, '채널 다시 연결')
    case 'APPROVAL_STALE':
      return classification('PUBLISH_REAPPROVAL_REQUIRED', false, '다시 승인')
    case 'RESULT_UNKNOWN':
    case 'LEASE_EXPIRED':
      return classification('PUBLISH_RECONCILE_REQUIRED', false, '외부 채널 확인')
    case 'PROVIDER_REJECTED':
      return classification('PUBLISH_PERMANENT_FAILURE', false, '고객 지원 문의')
    default:
      return classification('PUBLISH_PERMANENT_FAILURE', false, '고객 지원 문의')
  }
}
