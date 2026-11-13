export interface HumanTranslatedError {
  whatHappened: string
  whatSoheeDid: string
  ownerAction: string
}

export function translateInternalErrorToHuman(
  rawError: unknown
): HumanTranslatedError {
  const errorString =
    typeof rawError === 'string'
      ? rawError
      : rawError instanceof Error
      ? rawError.message
      : JSON.stringify(rawError || '')

  // 1. Cross-tenant access denial
  if (
    errorString.includes('CROSS_TENANT_ACCESS_DENIED') ||
    errorString.includes('tenant mismatch') ||
    errorString.includes('unauthorized workspace')
  ) {
    return {
      whatHappened: '매장 계정의 접근 권한을 확인하지 못했습니다.',
      whatSoheeDid: '안전을 위해 다른 매장의 정보가 섞이지 않도록 차단했습니다.',
      ownerAction: '현재 로그인한 계정으로 다시 접속해 주세요.',
    }
  }

  // 2. Database & SQL constraint errors
  if (
    errorString.includes('PostgresError') ||
    errorString.includes('unique constraint') ||
    errorString.includes('duplicate key') ||
    errorString.includes('foreign key') ||
    errorString.includes('syntax error') ||
    errorString.includes('database error')
  ) {
    return {
      whatHappened: '일시적인 저장 충돌이 발생했습니다.',
      whatSoheeDid: '데이터 무결성을 보호하기 위해 안전 모드로 전환했습니다.',
      ownerAction: '잠시 후 다시 저장해 주세요.',
    }
  }

  // 3. OAuth & SNS Channel errors
  if (
    errorString.includes('OAUTH_ACCESS_DENIED_BY_USER') ||
    errorString.includes('access_denied') ||
    errorString.includes('user_cancelled')
  ) {
    return {
      whatHappened: 'SNS 채널 연동 승인이 취소되었습니다.',
      whatSoheeDid: '연동 대기 상태를 안전하게 해제하고 준비센터로 복귀했습니다.',
      ownerAction: '채널 연동 화면에서 다시 공식 로그인을 진행해 주세요.',
    }
  }

  if (
    errorString.includes('token_expired') ||
    errorString.includes('invalid_token') ||
    errorString.includes('Session expired')
  ) {
    return {
      whatHappened: 'SNS 로그인 인증 세션이 만료되었습니다.',
      whatSoheeDid: '사장님의 안전한 계정 관리를 위해 이전 토큰을 정리했습니다.',
      ownerAction: '채널 연동 화면에서 다시 공식 로그인을 진행해 주세요.',
    }
  }

  if (errorString.includes('rate_limit') || errorString.includes('Too many requests')) {
    return {
      whatHappened: 'SNS 서비스 요청 한도에 도달했습니다.',
      whatSoheeDid: '계정 보호를 위해 추가 요청을 일시 정지했습니다.',
      ownerAction: '약 5분 후 다시 시도해 주세요.',
    }
  }

  // 4. Storage & Image Generation errors
  if (
    errorString.includes('row-level security') ||
    errorString.includes('Storage upload failed') ||
    errorString.includes('storage') ||
    errorString.includes('content-media')
  ) {
    return {
      whatHappened: '이미지 저장소 보안 권한 처리 중 일시적인 지연이 발생했습니다.',
      whatSoheeDid: '사장님의 안전을 위해 비인가 접근을 차단하고 작업 상태를 보존했습니다.',
      ownerAction: '잠시 후 다시 시도해 주시면 정상 처리됩니다.',
    }
  }

  if (
    errorString.includes('이미지 생성') ||
    errorString.includes('gpt-image') ||
    errorString.includes('GenerationOrchestrator') ||
    errorString.includes('OpenAI')
  ) {
    return {
      whatHappened: 'AI 이미지 생성 모델 응답이 일시적으로 지연되었습니다.',
      whatSoheeDid: '불필요한 비용이 청구되지 않도록 생성 요청을 안전하게 중단했습니다.',
      ownerAction: '스타일 키워드를 간단히 확인하시고 다시 생성해 주세요.',
    }
  }

  // 5. Default safe fallback
  return {
    whatHappened: '일시적인 네트워크 또는 시스템 지연이 발생했습니다.',
    whatSoheeDid: '진행 중이던 작업 내용을 안전하게 임시 보존했습니다.',
    ownerAction: '화면을 새로고침하거나 잠시 후 다시 시도해 주세요.',
  }
}
