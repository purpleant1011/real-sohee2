export type FirstPostErrorCategory =
  | 'TRANSIENT'
  | 'INSUFFICIENT_CREDITS'
  | 'TRIAL_LIMIT'
  | 'DAILY_LIMIT'
  | 'REVISION_LIMIT'
  | 'CHANNELS_DISCONNECTED'
  | 'TIMEOUT'
  | 'PUBLISH_NOT_ENABLED'
  | 'WORKSPACE_NOT_IN_LIVE_ROLLOUT'
  | 'UNKNOWN'

export type FirstPostErrorAction = {
  label: string
  href?: string
  actionType: 'retry' | 'navigate' | 'vault'
  variant?: 'default' | 'outline' | 'secondary'
}

export type FirstPostErrorGuidance = {
  category: FirstPostErrorCategory
  title: string
  description: string
  primaryAction: FirstPostErrorAction
  secondaryAction?: FirstPostErrorAction
}

export function resolveFirstPostErrorGuidance(params: {
  code?: string | null
  message?: string | null
  status?: number | null
  channel?: string | null
}): FirstPostErrorGuidance {
  const code = (params.code ?? '').toUpperCase()
  const message = params.message ?? ''
  const status = params.status

  // 1. 크레딧/포인트 부족
  if (
    code === 'INSUFFICIENT_CREDITS' ||
    status === 402 ||
    message.includes('크레딧이 부족') ||
    message.includes('포인트가 부족')
  ) {
    return {
      category: 'INSUFFICIENT_CREDITS',
      title: '첫 포스팅에 쓸 포인트가 없어요',
      description: '인스타그램이나 스레드를 연결하면 포인트를 드려요. 사업자 인증이 승인되면 모든 기능을 쓸 수 있어요.',
      primaryAction: {
        label: '채널 연결하기',
        href: '/start?step=channels',
        actionType: 'navigate',
        variant: 'default',
      },
      secondaryAction: {
        label: '사업자 인증하기',
        href: '/onboarding/business',
        actionType: 'navigate',
        variant: 'outline',
      },
    }
  }

  // 2. 체험 한도 (첫 포스팅 2건)
  if (
    code === 'TRIAL_FIRST_POST_LIMIT_REACHED' ||
    (status === 403 && message.includes('첫 포스팅 2건')) ||
    message.includes('첫 포스팅 2건을 모두 사용')
  ) {
    return {
      category: 'TRIAL_LIMIT',
      title: '첫 포스팅 2건을 모두 사용했어요',
      description: '첫 포스팅 2건을 모두 사용하셨어요. 사업자 인증이 승인되면 계속 쓸 수 있어요.',
      primaryAction: {
        label: '사업자 인증하기',
        href: '/onboarding/business',
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }

  // 3. 일일 한도
  if (
    code === 'DAILY_LIMIT_REACHED' ||
    message.includes('일일') ||
    message.includes('하루에')
  ) {
    return {
      category: 'DAILY_LIMIT',
      title: '오늘 작성 한도에 도달했어요',
      description: '하루에 만들 수 있는 게시물 한도를 모두 사용했어요. 내일 다시 시도해 주세요.',
      primaryAction: {
        label: '다시 시도',
        actionType: 'retry',
        variant: 'outline',
      },
    }
  }

  // 4. 수정 한도
  if (
    code === 'REVISION_LIMIT_REACHED' ||
    code === 'TOTAL_REVISION_LIMIT_REACHED' ||
    message.includes('수정 요청은 게시물당') ||
    message.includes('수정 횟수')
  ) {
    return {
      category: 'REVISION_LIMIT',
      title: '게시물 수정 한도에 도달했어요',
      description: '이 게시물에서 요청할 수 있는 수정 횟수를 모두 사용했어요. 직접 수정하거나 새 글을 만들어 주세요.',
      primaryAction: {
        label: '새 글 만들기',
        href: '/start',
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }

  // 5. 서비스 준비 중 (발행 기능 준비 / Meta 앱 심사 준비)
  if (
    code === 'PUBLISH_NOT_ENABLED' ||
    message.includes('게시 기능을 준비') ||
    message.includes('Meta 앱 심사')
  ) {
    return {
      category: 'PUBLISH_NOT_ENABLED',
      title: '게시 기능을 준비하고 있어요',
      description: '소희가 글을 대신 올리는 기능을 마무리하고 있어요. 작성하신 글은 보관함에 안전하게 담아 둘게요.',
      primaryAction: {
        label: '보관함에 담기',
        actionType: 'vault',
        variant: 'default',
      },
      secondaryAction: {
        label: '채널 다시 확인하기',
        href: '/start?step=channels',
        actionType: 'navigate',
        variant: 'outline',
      },
    }
  }

  // 5.1. 단계적 개방 준비 중 (WORKSPACE_NOT_IN_LIVE_ROLLOUT)
  if (
    code === 'WORKSPACE_NOT_IN_LIVE_ROLLOUT' ||
    message.includes('실제 게시를 열지 않았어요')
  ) {
    return {
      category: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      title: '실제 게시는 아직 준비 중이에요',
      description: message || '실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.',
      primaryAction: {
        label: '보관함에 담기',
        actionType: 'vault',
        variant: 'default',
      },
      secondaryAction: {
        label: '소희 작업실로 이동',
        href: '/app',
        actionType: 'navigate',
        variant: 'outline',
      },
    }
  }

  // 5.5. 다른 곳에서 연결되어 계정 ID 유실 (CONNECTION_IDENTITY_MISSING)
  if (
    code === 'CONNECTION_IDENTITY_MISSING' ||
    message.includes('다른 곳에서 다시 연결되어 확인이 필요')
  ) {
    const targetChannel = params.channel || 'instagram'
    return {
      category: 'CHANNELS_DISCONNECTED',
      title: '채널 다시 연결이 필요해요',
      description: '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.',
      primaryAction: {
        label: '다시 연결하기',
        href: `/api/channels/${targetChannel}/connect?returnPath=/start/preview`,
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }

  // 6. 채널 토큰 만료
  if (
    code === 'TOKEN_EXPIRED' ||
    code === 'CREDENTIAL_EXPIRED' ||
    code === 'READY_DEGRADED' ||
    message.includes('만료')
  ) {
    return {
      category: 'CHANNELS_DISCONNECTED',
      title: '채널 연결이 만료되었어요',
      description: '안전한 게시를 위해 SNS 계정을 다시 연결해 주세요.',
      primaryAction: {
        label: '다시 연결하기',
        href: '/start?step=channels',
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }

  // 7. 채널 확인 필요
  if (
    code === 'CHANNEL_NOT_VERIFIED' ||
    message.includes('채널 확인') ||
    message.includes('채널 상태')
  ) {
    return {
      category: 'CHANNELS_DISCONNECTED',
      title: '채널 확인이 필요해요',
      description: '연결된 채널의 상태나 권한을 다시 확인해 주세요.',
      primaryAction: {
        label: '채널 다시 확인하기',
        href: '/start?step=channels',
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }

  // 7.5. 준비 미완료 (ANI-1599): CREATE 게이트는 4대 퀵팩만 요구한다.
  // 채널이 없는 것은 이 차단의 원인이 아니므로 채널 연결로 안내하면 막다른 길이 된다.
  if (code === 'PREPARATION_INCOMPLETE') {
    return {
      category: 'CHANNELS_DISCONNECTED',
      title: '가게 정보를 먼저 확인해 주세요',
      description: '가게 정보·말투·사진 기준을 확인하면 첫 초안을 만들 수 있어요. 채널 연결은 나중에 해도 되고, 연결 없이도 초안을 보관하거나 복사할 수 있어요.',
      primaryAction: {
        label: '가게 정보 확인하기',
        href: '/start',
        actionType: 'navigate',
        variant: 'default',
      },
      secondaryAction: {
        label: '채널 연결하기',
        href: '/start?step=channels',
        actionType: 'navigate',
        variant: 'outline',
      },
    }
  }

  // 8. 채널 미연결 / 준비 상태 차단
  if (
    code === 'CHANNEL_NOT_CONNECTED' ||
    code === 'CHANNELS_NOT_CONNECTED' ||
    code === 'READINESS_BLOCKED' ||
    message.includes('채널이') ||
    message.includes('SNS') ||
    message.includes('채널을 먼저')
  ) {
    return {
      category: 'CHANNELS_DISCONNECTED',
      title: '연결된 채널이 없어요',
      description: '글을 올릴 SNS 채널이 아직 연결되지 않았어요. 인스타그램이나 스레드를 연결해 주세요.',
      primaryAction: {
        label: '채널 연결하기',
        href: '/start?step=channels',
        actionType: 'navigate',
        variant: 'default',
      },
    }
  }

  // 9. 타임아웃
  if (code === 'TIMEOUT') {
    return {
      category: 'TIMEOUT',
      title: '조금 오래 걸리고 있어요',
      description: '첫 글을 준비하는 데 평소보다 시간이 더 걸리고 있어요. 다시 시도해 보실 수 있어요.',
      primaryAction: {
        label: '다시 시도',
        actionType: 'retry',
        variant: 'default',
      },
    }
  }

  // 10. 일시 오류 (CREDIT_RESERVE_FAILED, 503, 500, 기타 알 수 없는 오류 기본 fallback)
  return {
    category: 'TRANSIENT',
    title: '잠시 문제가 생겼어요',
    description: '작성하신 내용은 그대로예요. 잠시 후 다시 시도해 주세요.',
    primaryAction: {
      label: '다시 시도',
      actionType: 'retry',
      variant: 'default',
    },
  }
}
