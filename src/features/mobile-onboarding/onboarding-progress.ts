// ANI-1781 (M03): 온보딩 단계 모델을 위저드(start-wizard)와 같은 4단계로 맞춘다.
//   가게 → 말투 → 계정 → 첫 글
// 단계는 서버가 확인한 값만으로 복원한다(브라우저 저장소·URL·입력 중인 폼 상태는 근거가 아니다).
// 확인되지 않은 값은 완료로 올리지 않는다(fail-closed).

export type OnboardingStep = 'shop' | 'tone' | 'channels' | 'preview' | 'error'

/** 준비 사실(readiness facts) 중 온보딩 단계 복원에 쓰는 값만. */
export type OnboardingFacts = {
  /** 글 쓰는 기준(말투)이 서버에 확정되어 있는가 — harness_rules(text_generation, active) */
  TEXT_HARNESS_CONFIRMED: boolean
  /** 인스타그램 계정 연결이 검증되었는가 */
  INSTAGRAM_VERIFIED: boolean
  /** 스레드 계정 연결이 검증되었는가 */
  THREADS_VERIFIED: boolean
}

export type OnboardingProgressInput =
  | { error: true }
  | {
      error?: false
      profile: { business_name?: string; industry?: string; summary?: string } | null
      /** 조회 응답에 없거나 형태가 다르면 미확인으로 본다. */
      facts?: Partial<OnboardingFacts> | null
    }

export type OnboardingProgress = {
  step: OnboardingStep
  /** 0 = 조회 실패, 1~4 = 단계. */
  index: 0 | 1 | 2 | 3 | 4
  total: 4
  /** 채널 연결은 첫 게시 차단 조건이 아니다(ANI-1524). 항상 false. */
  blockedByChannel?: false
}

function filled(value?: string): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * 위저드의 `shopValid` 와 같은 기준: 이름·업종·한 줄 소개가 모두 있어야 가게 단계가 끝난다.
 * 말투는 서버에 저장된 글 쓰기 기준으로, 계정은 채널 검증 사실로 판정한다.
 */
export function deriveOnboardingStep(input: OnboardingProgressInput): OnboardingProgress {
  if (input.error) return { step: 'error', index: 0, total: 4 }

  const profile = input.profile
  if (!filled(profile?.business_name) || !filled(profile?.industry) || !filled(profile?.summary)) {
    return { step: 'shop', index: 1, total: 4 }
  }
  if (input.facts?.TEXT_HARNESS_CONFIRMED !== true) return { step: 'tone', index: 2, total: 4 }
  if (input.facts?.INSTAGRAM_VERIFIED !== true && input.facts?.THREADS_VERIFIED !== true) {
    return { step: 'channels', index: 3, total: 4 }
  }
  return { step: 'preview', index: 4, total: 4, blockedByChannel: false }
}
