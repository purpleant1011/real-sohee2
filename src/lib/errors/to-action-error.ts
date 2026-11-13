import { AppError, type AppErrorCode } from './app-error'
import type { ActionError } from './result'

const actionMessages: Record<AppErrorCode, string> = {
  BAD_REQUEST: '입력 내용을 확인해 주세요.',
  UNAUTHENTICATED: '로그인이 필요합니다.',
  FORBIDDEN: '이 작업을 수행할 권한이 없습니다.',
  NOT_FOUND: '요청한 정보를 찾을 수 없습니다.',
  CONFLICT: '이미 처리된 요청입니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL: '요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
}

function toSafeRequestId(requestId: string): string {
  return /^[A-Za-z0-9_-]{1,128}$/.test(requestId) ? requestId : 'unknown'
}

export function toActionError(error: unknown, requestId: string): ActionError {
  const code = error instanceof AppError ? error.code : 'INTERNAL'

  return {
    message: actionMessages[code],
    requestId: toSafeRequestId(requestId),
  }
}
