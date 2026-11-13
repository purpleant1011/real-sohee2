export type NaverFailureAction = 'retry' | 'retry_new' | 'charge' | 'reauth' | 'none'

export type NaverFailureCopy = Readonly<{
  message: string
  action: NaverFailureAction
}>

export const DEFAULT_FAILURE_MESSAGE = '올리지 못했어요. 잠시 후 다시 시도해 주세요.'

function isValidCustomMessage(message?: string | null): boolean {
  if (!message || message.trim().length === 0) return false
  const trimmed = message.trim()
  // Must contain Hangul
  if (!/[가-힣]/.test(trimmed)) return false
  // Must NOT contain internal code-like tokens (e.g., ALL_CAPS_WITH_UNDERSCORES)
  if (/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/.test(trimmed)) return false
  return true
}

const CANONICAL_COPY_MAP: Readonly<Record<string, NaverFailureCopy>> = {
  IN_PROGRESS: {
    message: '이미 글을 만들고 있어요. 잠시만 기다려 주세요.',
    action: 'none',
  },
  CLAIMS_NEED_REVIEW: {
    message: '확인이 필요한 표현이 남아 한 번 더 다듬어야 해요. 같은 주제로 다시 만들어 볼까요?',
    action: 'retry_new',
  },
  DRAFT_FAILED: {
    message: '초안 글을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    action: 'retry_new',
  },
  IMAGES_INCOMPLETE: {
    message: '이미지를 모두 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    action: 'retry',
  },
  CREDIT_INSUFFICIENT: {
    message: '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
    action: 'charge',
  },
  VALIDATION_FAILED: {
    message: '주제와 요청 정보를 확인해 주세요.',
    action: 'none',
  },
  AUTH_REQUIRED: {
    message: '로그인이 필요해요.',
    action: 'reauth',
  },
  WORKSPACE_FORBIDDEN: {
    message: '이 매장에 접근할 수 없어요.',
    action: 'none',
  },
  SERVICE_UNAVAILABLE: {
    message: '네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.',
    action: 'retry',
  },
  REAUTH_REQUIRED: {
    message: '네이버 로그인이 필요해요. 크롬에서 네이버에 로그인한 뒤 다시 시도해 주세요.',
    action: 'reauth',
  },
  CATEGORY_NOT_FOUND: {
    message: '선택한 카테고리를 네이버에서 찾지 못했어요. 카테고리 목록을 새로 가져와 주세요.',
    action: 'retry',
  },
  CATEGORY_INVALID: {
    message: '선택한 카테고리를 찾을 수 없어요. 카테고리 목록을 새로 불러와 주세요.',
    action: 'none',
  },
  DRAFT_RECOVERY_PENDING: {
    message: '네이버 글쓰기 화면에 작성 중인 글이 있어요. 그 글을 저장하거나 지운 뒤 다시 시도해 주세요.',
    action: 'none',
  },
  DEVICE_OFFLINE: {
    message: '소희 연결 브라우저가 꺼져 있어요. 브라우저를 켠 뒤 다시 시도해 주세요.',
    action: 'none',
  },
  UNKNOWN_RESULT: {
    message: '게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.',
    action: 'none',
  },
  READBACK_UNKNOWN: {
    message: '게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.',
    action: 'none',
  },
  UNKNOWN: {
    message: '게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.',
    action: 'none',
  },
  UNKNOWN_AFTER_SUBMIT: {
    message: '게시 결과를 확인하지 못했어요. 중복 게시를 막기 위해 자동으로 다시 올리지 않아요. 네이버에서 직접 확인해 주세요.',
    action: 'none',
  },
  UI_DRIFT: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  },
  CONTENT_MISMATCH: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  },
  TARGET_MISMATCH: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  },
  MEDIA_UPLOAD_FAILED: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  },
  MEDIA_DOWNLOAD_FAILED: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  },
  DEADLINE_EXPIRED: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  },
  POLICY_RESTRICTION: {
    message: DEFAULT_FAILURE_MESSAGE,
    action: 'none',
  },
}

export function getNaverFailureCopy(
  code?: string | null,
  customMessage?: string | null,
): NaverFailureCopy {
  const normalizedKey = typeof code === 'string' ? code.trim().toUpperCase() : ''
  const canonical = CANONICAL_COPY_MAP[normalizedKey]
  const shouldUseCustom = isValidCustomMessage(customMessage)

  if (canonical) {
    return {
      message: shouldUseCustom ? customMessage!.trim() : canonical.message,
      action: canonical.action,
    }
  }

  // Fallback for any unknown error code
  return {
    message: shouldUseCustom ? customMessage!.trim() : DEFAULT_FAILURE_MESSAGE,
    action: 'retry',
  }
}
