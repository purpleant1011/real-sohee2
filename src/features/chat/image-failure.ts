const imageFailures: Readonly<Record<string, string>> = {
  CHAT_IMAGE_HARNESS_UNAVAILABLE: '가게의 이미지 제작 규칙을 확인하지 못해 생성을 멈췄어요. 연결을 확인한 뒤 다시 시도해 주세요.',
  IMAGE_AUTH_REQUIRED: '이미지 서비스 인증을 확인하지 못했어요. 관리자에게 이미지 API 키 설정 확인을 요청해 주세요.',
  IMAGE_QUOTA_EXHAUSTED: '이미지 서비스의 사용 한도나 결제 상태 때문에 생성하지 못했어요. 관리자 확인이 필요해요.',
  IMAGE_RATE_LIMITED: '이미지 서비스의 요청 한도에 도달했어요. 잠시 후 이미지 생성만 다시 시도해 주세요.',
  IMAGE_MODEL_UNAVAILABLE: '설정된 이미지 모델에 접근하지 못했어요. 관리자에게 모델 권한과 설정 확인을 요청해 주세요.',
  IMAGE_PROMPT_INVALID: '이미지 생성 요청 형식을 처리하지 못했어요. 이미지 설명을 바꿔 다시 요청해 주세요.',
  IMAGE_POLICY_REJECTED: '이미지 서비스의 안전 기준으로 생성을 진행하지 못했어요. 이미지 설명을 바꿔 주세요.',
  IMAGE_PROVIDER_UNAVAILABLE: '이미지 서비스의 결과를 확인하지 못했어요. 중복 생성을 피하려면 현재 작업 상태부터 확인해 주세요.',
  CHAT_IMAGE_STORE_FAILED: '생성된 이미지를 안전하게 저장하지 못했어요. 중복 생성 전에 현재 작업 상태를 확인해 주세요.',
  CHAT_IMAGE_CONFIRM_FAILED: '이미지 저장 확인을 마치지 못했어요. 중복 생성 전에 현재 작업 상태를 확인해 주세요.',
}

export function imageFailureForUser(error: unknown): { code: string; message: string } | null {
  const values = error instanceof Error ? [error.message, 'code' in error ? error.code : null] : []
  const code = values.find((value): value is string => typeof value === 'string' && Object.hasOwn(imageFailures, value))
  return code ? { code, message: imageFailures[code] } : null
}
