export type SupportedChannel = 'instagram' | 'threads'

export type NormalizationErrorCode =
  | 'EMPTY_INPUT'
  | 'WRONG_PROVIDER'
  | 'UNSUPPORTED_DOMAIN'
  | 'INVALID_HANDLE_FORMAT'
  | 'PASSWORD_LIKE_INPUT'

export type NormalizationSuccess = Readonly<{
  isValid: true
  channel: SupportedChannel
  handle: string
  displayHandle: string
  canonicalUrl: string
}>

export type NormalizationFailure = Readonly<{
  isValid: false
  errorCode: NormalizationErrorCode
  errorMessage: string
  recoveryHint: string
}>

export type NormalizationResult = NormalizationSuccess | NormalizationFailure

export type PasswordCheckResult = Readonly<{
  isPasswordLike: boolean
  warningMessage?: string
}>

export type OAuthExplainabilityDetails = Readonly<{
  channel: SupportedChannel
  channelDisplayName: string
  officialProviderName: string
  reasons: ReadonlyArray<{
    title: string
    description: string
    scopeKey?: string
  }>
  securityGuarantees: ReadonlyArray<string>
}>

const FORBIDDEN_DOMAINS = [
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'facebook.com',
  'naver.com',
  'daangn.com',
  'linkedin.com',
]

/**
 * Detects if the user is mistakenly attempting to paste a password or sensitive secret
 * into the handle input field (Zero-Password Invariant).
 */
export function detectPasswordLikeInput(rawInput: string): PasswordCheckResult {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return { isPasswordLike: false }
  }

  const lower = trimmed.toLowerCase()

  // 1. Explicit keyword triggers
  if (
    lower.includes('password') ||
    lower.includes('p@ss') ||
    lower.includes('secret')
  ) {
    return {
      isPasswordLike: true,
      warningMessage:
        '비밀번호를 입력하지 마세요. 소희는 비밀번호를 절대 요구하거나 저장하지 않습니다. 공식 OAuth 로그인을 이용해 주세요.',
    }
  }

  // 2. Complex character combination typical of passwords (letters + digits + forbidden special symbols)
  // Handles only allow [a-zA-Z0-9._] (and leading @).
  // If it has symbols like !#$%^&*()+=/|~, and is at least 8 chars with mixed classes:
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  const hasSpecialPasswordChar = /[!#$%^&*()+=[\]{}|\\:;"'<>,/?~]/.test(withoutAt)
  const hasLetter = /[a-zA-Z]/.test(withoutAt)
  const hasDigit = /[0-9]/.test(withoutAt)

  if (withoutAt.length >= 8 && hasSpecialPasswordChar && hasLetter && hasDigit) {
    return {
      isPasswordLike: true,
      warningMessage:
        '비밀번호와 유사한 문자열이 감지되었습니다. 소희는 비밀번호를 요구하지 않으며 공식 Meta OAuth를 통해 안전하게 인증합니다.',
    }
  }

  return { isPasswordLike: false }
}

/**
 * Normalizes user input (@handle or profile URL) to a canonical handle and canonical URL.
 * Fails closed on wrong providers, unsupported domains, invalid characters, or empty input.
 */
export function normalizeChannelInput(
  channel: SupportedChannel,
  rawInput: string
): NormalizationResult {
  const trimmed = (rawInput || '').trim()

  // 1. Empty Check
  if (!trimmed) {
    return {
      isValid: false,
      errorCode: 'EMPTY_INPUT',
      errorMessage: '계정 아이디(@아이디) 또는 프로필 주소를 입력해 주세요.',
      recoveryHint:
        channel === 'instagram'
          ? '예: @sohee.ai 또는 https://www.instagram.com/sohee.ai'
          : '예: @sohee.ai 또는 https://www.threads.com/@sohee.ai',
    }
  }

  const lower = trimmed.toLowerCase()

  // 2. Domain & Cross-Provider Check
  // Check wrong provider domain
  if (channel === 'instagram' && (lower.includes('threads.com') || lower.includes('threads.net'))) {
    return {
      isValid: false,
      errorCode: 'WRONG_PROVIDER',
      errorMessage: '스레드 주소는 스레드 연동 항목에 입력해 주세요.',
      recoveryHint: '인스타그램 프로필 주소(instagram.com/아이디) 또는 @아이디를 입력해 주세요.',
    }
  }

  if (channel === 'threads' && lower.includes('instagram.com')) {
    return {
      isValid: false,
      errorCode: 'WRONG_PROVIDER',
      errorMessage: '인스타그램 주소는 인스타그램 연동 항목에 입력해 주세요.',
      recoveryHint: '스레드 프로필 주소(threads.com/@아이디) 또는 @아이디를 입력해 주세요.',
    }
  }

  // Check forbidden/unsupported domains
  for (const domain of FORBIDDEN_DOMAINS) {
    if (lower.includes(domain)) {
      return {
        isValid: false,
        errorCode: 'UNSUPPORTED_DOMAIN',
        errorMessage: `지원되지 않는 SNS 도메인(${domain})입니다.`,
        recoveryHint: `${channel === 'instagram' ? '인스타그램' : '스레드'} 프로필 주소 또는 @아이디를 입력해 주세요.`,
      }
    }
  }

  // Check app-scheme URLs (e.g. instagram://, threads://)
  if (/^(instagram|threads):\/\//i.test(trimmed)) {
    return {
      isValid: false,
      errorCode: 'INVALID_HANDLE_FORMAT',
      errorMessage: '앱 전용 링크는 지원되지 않습니다.',
      recoveryHint: '웹 프로필 주소(https://...) 또는 @아이디 형식으로 입력해 주세요.',
    }
  }

  // 3. Extract handle candidate
  let clean = trimmed
  const isUrl = /^https?:\/\//i.test(clean) || /^(www\.)?(instagram\.com|threads\.(com|net))\//i.test(clean)

  if (isUrl) {
    // Remove protocol and www
    clean = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '')

    // Remove domain prefix
    if (channel === 'instagram') {
      clean = clean.replace(/^instagram\.com\//i, '')
    } else if (channel === 'threads') {
      clean = clean.replace(/^threads\.(com|net)\//i, '')
    }

    // Strip URL query string and hash
    const queryIndex = clean.indexOf('?')
    if (queryIndex !== -1) {
      clean = clean.substring(0, queryIndex)
    }
    const hashIndex = clean.indexOf('#')
    if (hashIndex !== -1) {
      clean = clean.substring(0, hashIndex)
    }

    // Strip trailing slashes
    clean = clean.replace(/\/+$/, '')
  }

  // Strip leading @
  if (clean.startsWith('@')) {
    clean = clean.substring(1)
  }

  // 4. Password-like Check on extracted candidate
  const pwdCheck = detectPasswordLikeInput(clean)
  if (pwdCheck.isPasswordLike) {
    return {
      isValid: false,
      errorCode: 'PASSWORD_LIKE_INPUT',
      errorMessage:
        pwdCheck.warningMessage ||
        '비밀번호를 입력하지 마세요. 소희는 비밀번호를 요구하거나 저장하지 않습니다.',
      recoveryHint: '인증은 아래 [공식 계정 연동] 버튼을 통해 안전하게 진행됩니다.',
    }
  }

  // Lowercase for canonical handle
  const handle = clean.toLowerCase()

  // 5. Validate Handle Format
  // Handles in IG & Threads must only contain lowercase alphanumeric, dots, underscores
  const validHandlePattern = /^[a-z0-9._]+$/

  if (!handle || !validHandlePattern.test(handle)) {
    return {
      isValid: false,
      errorCode: 'INVALID_HANDLE_FORMAT',
      errorMessage:
        '인스타그램/스레드 아이디는 영문, 숫자, 밑줄(_), 마침표(.)만 사용 가능합니다.',
      recoveryHint: '정확한 영문 사용자 이름(예: @sohee.ai)을 입력해 주세요.',
    }
  }

  // Length limits (standard Instagram handle length is 1-30 characters)
  if (handle.length > 30) {
    return {
      isValid: false,
      errorCode: 'INVALID_HANDLE_FORMAT',
      errorMessage: '사용자 이름은 최대 30자까지 가능합니다.',
      recoveryHint: '아이디를 확인하고 다시 입력해 주세요.',
    }
  }

  // 6. Canonical URLs
  const canonicalUrl =
    channel === 'instagram'
      ? `https://www.instagram.com/${handle}/`
      : `https://www.threads.com/@${handle}`

  return {
    isValid: true,
    channel,
    handle,
    displayHandle: `@${handle}`,
    canonicalUrl,
  }
}

/**
 * Returns user-facing explainability details in plain Korean for why specific
 * Meta OAuth permissions are required, along with safety guarantees.
 */
export function getOAuthExplainabilityDetails(
  channel: SupportedChannel
): OAuthExplainabilityDetails {
  if (channel === 'instagram') {
    return {
      channel: 'instagram',
      channelDisplayName: '인스타그램 비즈니스',
      officialProviderName: 'Meta Graph API',
      reasons: [
        {
          title: '피드 및 릴스 콘텐츠 자동 게시',
          description:
            '소희가 사장님의 최종 승인을 받은 마케팅 사진, 카드뉴스, 본문 텍스트를 인스타그램에 대신 게시합니다.',
          scopeKey: 'instagram_content_publish',
        },
        {
          title: '비즈니스 계정 프로필 식별',
          description:
            '연결할 인스타그램 비즈니스/크리에이터 계정의 공식 프로필과 사용자명을 안전하게 확인합니다.',
          scopeKey: 'instagram_basic',
        },
        {
          title: '게시물 도달 및 반응률 분석',
          description:
            '게시된 피드의 좋아요, 댓글 수, 도달 범위를 주기적으로 확인하여 다음 마케팅 성과 개선에 활용합니다.',
          scopeKey: 'instagram_manage_insights',
        },
        {
          title: '고객 댓글 및 DM 수신 모니터링',
          description:
            '인스타그램 댓글과 문의를 실시간으로 감지하여 소희 대시보드에서 알림을 제공합니다.',
          scopeKey: 'instagram_manage_comments',
        },
      ],
      securityGuarantees: [
        '계정 비밀번호를 절대 요구하거나 소희 서버에 저장하지 않습니다.',
        '모든 연동은 Meta 공식 보안 인가(OAuth 2.0) 창을 통해 안전하게 처리됩니다.',
        '사장님의 명시적 승인 없이 임의로 게시물을 발행하지 않는 엄격한 승인 지문 원칙을 준수합니다.',
        '설정 메뉴에서 언제든지 즉시 1클릭으로 연동을 해제할 수 있습니다.',
      ],
    }
  }

  return {
    channel: 'threads',
    channelDisplayName: '스레드 (Threads)',
    officialProviderName: 'Meta Threads API',
    reasons: [
      {
        title: '스레드 텍스트 및 미디어 발행',
        description:
          '소희가 승인된 트렌드 소식, 매장 소식 및 후기, 짧은 마케팅 단문을 스레드에 자동으로 발행합니다.',
        scopeKey: 'threads_content_publish',
      },
      {
        title: '스레드 프로필 기본 정보 조회',
        description:
          '스레드 공식 계정(@아이디)의 프로필 정보와 연결 상태를 확인합니다.',
        scopeKey: 'threads_basic',
      },
      {
        title: '답글 및 멘션 실시간 조회',
        description:
          '게시물에 달린 고객 반응과 답글을 모니터링하여 소통 기회를 놓치지 않도록 돕습니다.',
        scopeKey: 'threads_manage_replies',
      },
      {
        title: '스레드 조회수 및 성과 분석',
        description:
          '스레드 게시물의 조회수와 인게이지먼트를 측정하여 최적의 업로드 시간대를 제안합니다.',
        scopeKey: 'threads_manage_insights',
      },
    ],
    securityGuarantees: [
      '스레드 비밀번호는 요구되지 않으며 Meta의 공식 Threads API 토큰만 사용합니다.',
      '발행된 모든 액션은 고유 영수증(Receipt)으로 투명하게 기록됩니다.',
      '사장님의 사전 승인 없는 자율 게시를 원천 차단합니다.',
      '원하실 때 언제든 즉시 연동 해제 및 데이터 파기가 가능합니다.',
    ],
  }
}
