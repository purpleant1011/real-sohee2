import type {
  OnboardingActionType,
  ForbiddenEducationAction,
  ParsedOnboardingAction,
  StructuredLineage,
  HumanTranslation,
} from './types'
import { FORBIDDEN_EDUCATION_ACTIONS } from './types'

export function isForbiddenEducationAction(
  action: OnboardingActionType | ForbiddenEducationAction
): action is ForbiddenEducationAction {
  return (FORBIDDEN_EDUCATION_ACTIONS as readonly string[]).includes(action)
}

function redactSensitiveData(utterance: string): {
  cleanedText: string
  hasRedacted: boolean
} {
  // Regex to detect password-like strings or explicit password patterns
  const passwordPatterns = [
    /(?:비밀번호|패스워드|password|pw)(?:\s*(?:는|은|:|\s))\s*([^\s,.]+)/gi,
  ]

  let cleaned = utterance
  let hasRedacted = false

  for (const pattern of passwordPatterns) {
    cleaned = cleaned.replace(pattern, (match, p1) => {
      hasRedacted = true
      return match.replace(p1, '[REDACTED_SECRET]')
    })
  }

  return { cleanedText: cleaned, hasRedacted }
}

export function parseOnboardingUtterance(rawUtterance: string): ParsedOnboardingAction {
  const { cleanedText, hasRedacted } = redactSensitiveData(rawUtterance)
  const trimmed = cleanedText.trim()
  const lower = trimmed.toLowerCase()

  // 1. Forbidden check: Publishing in Education Mode
  if (
    lower.includes('올려줘') ||
    lower.includes('게시해줘') ||
    lower.includes('발행해줘') ||
    lower.includes('업로드해줘') ||
    lower.includes('피드에 올려')
  ) {
    return {
      actionType: 'publish_post',
      isForbidden: true,
      forbiddenReason: '소희 준비 단계(Education Mode)에서는 사전 승인 없는 외부 자동 발행이 엄격히 차단되어 있습니다.',
      extractedCandidate: {},
      humanTranslation: {
        humanSummaryPreview: '게시물 발행 요청이 감지되었습니다.',
        editPath: '/start',
        reassurance: '소희는 7대 필수 준비가 완료되고 사장님의 명시적 승인이 있기 전까지는 절대 임의로 발행하지 않아요.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: {},
        confidence: 1.0,
        validationResult: 'INVALID',
      },
    }
  }

  // 2. Forbidden check: Confirming readiness facts via conversation alone
  if (
    lower.includes('확정해줘') ||
    lower.includes('완료 처리해줘') ||
    lower.includes('다 됐다고 해줘') ||
    lower.includes('컨펌해줘')
  ) {
    return {
      actionType: 'confirm_readiness_fact',
      isForbidden: true,
      forbiddenReason: '불변 사실 확정은 대화만으로 자동 처리되지 않으며 사장님의 화면 직접 확인 및 승인이 필요합니다.',
      extractedCandidate: {},
      humanTranslation: {
        humanSummaryPreview: '준비 항목 자동 확정 요청이 감지되었습니다.',
        editPath: '/start',
        reassurance: '안전을 위해 각 단계의 확정 버튼을 직접 눌러주셔야 최종 승인됩니다.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: {},
        confidence: 0.95,
        validationResult: 'INVALID',
      },
    }
  }

  // 3. Forbidden check: Paid advertising or costs
  if (lower.includes('결제') || lower.includes('광고비 집행') || lower.includes('유료 광고')) {
    return {
      actionType: 'execute_paid_cost',
      isForbidden: true,
      forbiddenReason: '온보딩 학습 단계에서는 일체의 유료 과금이나 예산 집행이 불가합니다.',
      extractedCandidate: {},
      humanTranslation: {
        humanSummaryPreview: '유료 예산 집행 요청이 감지되었습니다.',
        editPath: '/start',
        reassurance: '온보딩 과정은 100% 무료이며 임의의 결제는 일절 발생하지 않습니다.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: {},
        confidence: 0.95,
        validationResult: 'INVALID',
      },
    }
  }

  // 4. Allowed: direct navigation
  if (
    lower.includes('페이지로 데려가') ||
    lower.includes('화면 열어줘') ||
    lower.includes('이동해줘') ||
    lower.includes('화면으로 가줘')
  ) {
    let targetHref = '/start'
    if (lower.includes('채널') || lower.includes('인스타') || lower.includes('스레드')) {
      targetHref = '/start?step=channels'
    } else if (lower.includes('사업자') || lower.includes('사업')) {
      targetHref = '/start'
    } else if (lower.includes('지식') || lower.includes('매장')) {
      targetHref = '/app/sohee?tab=training'
    } else if (lower.includes('글') || lower.includes('문구') || lower.includes('텍스트')) {
      targetHref = '/app/sohee?tab=training'
    } else if (lower.includes('사진') || lower.includes('이미지')) {
      targetHref = '/app/sohee?tab=training'
    } else if (lower.includes('정책') || lower.includes('규정')) {
      targetHref = '/app/sohee?tab=command'
    }

    return {
      actionType: 'navigate_to_required_step',
      isForbidden: false,
      extractedCandidate: { targetHref },
      humanTranslation: {
        humanSummaryPreview: `제가 이렇게 이해했어요: ${targetHref} 화면으로 안내해 드릴게요.`,
        editPath: targetHref,
        reassurance: '언제든 준비센터와 홈 화면을 자유롭게 오갈 수 있어요.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: { targetHref },
        confidence: 0.9,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 5. Allowed: start provider oauth
  if (
    lower.includes('공식 로그인') ||
    lower.includes('oauth') ||
    lower.includes('로그인 연결') ||
    lower.includes('로그인 창')
  ) {
    return {
      actionType: 'start_provider_oauth',
      isForbidden: false,
      extractedCandidate: { provider: 'instagram' },
      humanTranslation: {
        humanSummaryPreview: '제가 이렇게 이해했어요: Meta 공식 OAuth 로그인 창을 열어 연동을 진행합니다.',
        editPath: '/start?step=channels',
        reassurance: '비밀번호는 소희에게 절대 전달되지 않고 Meta 공식 창에서만 안전하게 처리돼요.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: { provider: 'instagram' },
        confidence: 0.9,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 6. Allowed: channel intent
  if (
    lower.includes('@') ||
    (lower.includes('인스타') && (lower.includes('아이디') || lower.includes('계정'))) ||
    lower.includes('스레드도 같이') ||
    lower.includes('스레드 연동')
  ) {
    const handleMatch = trimmed.match(/@([a-zA-Z0-9._]+)/)
    const igHandle = handleMatch ? handleMatch[1] : undefined
    const wantsThreads = lower.includes('스레드')

    const candidate: Record<string, any> = {}
    if (igHandle) candidate.instagramHandle = igHandle
    if (wantsThreads) candidate.wantsThreads = true

    return {
      actionType: 'save_channel_intent',
      isForbidden: false,
      extractedCandidate: candidate,
      humanTranslation: {
        humanSummaryPreview: `제가 이렇게 이해했어요: 인스타그램 계정(@${igHandle || '입력필요'})${wantsThreads ? ' 및 스레드 듀얼 채널' : ''} 연동 의사를 기록했습니다.`,
        editPath: '/start?step=channels',
        reassurance: '채널 연동 화면에서 공식 Meta 로그인을 완료하시면 안전하게 검증됩니다.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: candidate,
        confidence: 0.9,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 7. Allowed: generate text harness test
  if (
    lower.includes('예시 문구') ||
    lower.includes('글 하나 써봐') ||
    lower.includes('피드용 글') ||
    lower.includes('샘플 문구')
  ) {
    return {
      actionType: 'generate_text_harness_test',
      isForbidden: false,
      extractedCandidate: { testChannel: 'instagram_feed' },
      humanTranslation: {
        humanSummaryPreview: '제가 이렇게 이해했어요: 설정하신 브랜드 보이스 톤에 맞춰 테스트 문구 샘플을 생성합니다.',
        editPath: '/app/sohee?tab=training',
        reassurance: '테스트 생성은 사장님 확인용이며 외부에 발행되지 않습니다.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: { testChannel: 'instagram_feed' },
        confidence: 0.9,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 8. Allowed: save text harness draft
  if (
    lower.includes('말투') ||
    lower.includes('톤') ||
    lower.includes('친절') ||
    lower.includes('다정') ||
    lower.includes('발랄') ||
    lower.includes('본문에 꼭') ||
    lower.includes('문구 스타일')
  ) {
    const candidate: Record<string, any> = {}
    if (lower.includes('친절') || lower.includes('다정')) candidate.tone = '친절하고 다정한'
    else if (lower.includes('발랄') || lower.includes('활기찬')) candidate.tone = '발랄하고 활기찬'
    else candidate.tone = '정중하고 전문적인'

    if (lower.includes('가격')) candidate.requirePrice = true
    if (lower.includes('위치')) candidate.requireLocation = true

    return {
      actionType: 'save_text_harness_draft',
      isForbidden: false,
      extractedCandidate: candidate,
      humanTranslation: {
        humanSummaryPreview: `제가 이렇게 이해했어요: 브랜드 보이스는 '${candidate.tone}' 톤으로, 필수 요소는 ${candidate.requirePrice ? '가격 ' : ''}${candidate.requireLocation ? '위치' : ''}를 포함하는 초안을 메모했습니다.`,
        editPath: '/app/sohee?tab=training',
        reassurance: '텍스트 하네스 화면에서 예시 글을 보며 세부 조율하실 수 있어요.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: candidate,
        confidence: 0.88,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 9. Allowed: generate image harness test
  if (
    lower.includes('테스트 이미지') ||
    lower.includes('사진 하나 만들어') ||
    lower.includes('이미지 생성해봐')
  ) {
    return {
      actionType: 'generate_image_harness_test',
      isForbidden: false,
      extractedCandidate: { testAspect: '1:1' },
      humanTranslation: {
        humanSummaryPreview: '제가 이렇게 이해했어요: 시각 이미지 하네스 규칙에 따라 테스트 이미지를 생성합니다.',
        editPath: '/app/sohee?tab=training',
        reassurance: '테스트 이미지는 내부 확인용이며 외부 계정에 발행되지 않아요.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: { testAspect: '1:1' },
        confidence: 0.9,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 10. Allowed: save image rule draft
  if (
    lower.includes('사진') ||
    lower.includes('이미지') ||
    lower.includes('자연광') ||
    lower.includes('감성') ||
    lower.includes('조명') ||
    lower.includes('얼굴')
  ) {
    const candidate: Record<string, any> = {}
    if (lower.includes('자연광')) candidate.lighting = '자연광'
    if (lower.includes('따뜻한') || lower.includes('감성')) candidate.mood = '따뜻한 감성'
    if (lower.includes('얼굴') && (lower.includes('가려') || lower.includes('모자이크') || lower.includes('초상권'))) {
      candidate.facePrivacy = true
    }

    return {
      actionType: 'save_image_rule_draft',
      isForbidden: false,
      extractedCandidate: candidate,
      humanTranslation: {
        humanSummaryPreview: `제가 이렇게 이해했어요: 조명은 '${candidate.lighting || '자연스러운'}', 분위기는 '${candidate.mood || '깔끔한'}', 인물 보호: ${candidate.facePrivacy ? '적용' : '미적용'} 규칙을 초안으로 설정했습니다.`,
        editPath: '/app/sohee?tab=training',
        reassurance: '이미지 하네스 화면에서 골든 이미지 샘플과 함께 확정하실 수 있습니다.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: candidate,
        confidence: 0.88,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 11. Allowed: save operating policy draft
  if (
    lower.includes('승인') ||
    lower.includes('하루에') ||
    lower.includes('발행 한도') ||
    lower.includes('규정') ||
    lower.includes('정책')
  ) {
    const candidate: Record<string, any> = {}
    if (lower.includes('승인')) candidate.requireOwnerApproval = true
    const postMatch = trimmed.match(/하루에\s*([0-9]+)개/)
    if (postMatch) {
      candidate.maxDailyPosts = parseInt(postMatch[1], 10)
    } else if (lower.includes('1개')) {
      candidate.maxDailyPosts = 1
    }

    return {
      actionType: 'save_operating_policy_draft',
      isForbidden: false,
      extractedCandidate: candidate,
      humanTranslation: {
        humanSummaryPreview: `제가 이렇게 이해했어요: 사전 승인 필수(${candidate.requireOwnerApproval ? '예' : '아니오'}), 일일 최대 발행 수(${candidate.maxDailyPosts || 1}개) 운영 정책을 초안으로 반영했습니다.`,
        editPath: '/app/sohee?tab=command',
        reassurance: '사장님의 최종 확인 없이는 단 한 건의 글도 나가지 않도록 안전하게 보호됩니다.',
      },
      lineage: {
        sourceUtterance: cleanedText,
        extractedCandidate: candidate,
        confidence: 0.9,
        validationResult: hasRedacted ? 'WARNING' : 'VALID',
      },
    }
  }

  // 12. Allowed: save business fact draft (location, reservation, operating hours, category, price)
  const businessCandidate: Record<string, any> = {}
  const locMatch = trimmed.match(/(청라|강남|서초|홍대|송도|역삼|분당|일산|신촌|마포)/)
  if (locMatch) businessCandidate.location = locMatch[1]

  if (lower.includes('예약제') || lower.includes('예약')) {
    businessCandidate.reservationPolicy = '예약제'
  }

  const catMatch = trimmed.match(/(헤어샵|미용실|네일샵|피부과|에스테틱|카페|식당|베이커리)/)
  if (catMatch) businessCandidate.category = catMatch[1]

  const hoursMatch = trimmed.match(/(?:오전\s*([0-9]+)시.*?(?:오후|밤)\s*([0-9]+)시|[0-9]{1,2}:[0-9]{2}\s*-\s*[0-9]{1,2}:[0-9]{2})/)
  if (hoursMatch) {
    if (hoursMatch[1] && hoursMatch[2]) {
      const openHour = hoursMatch[1].padStart(2, '0')
      const closeHour = (parseInt(hoursMatch[2], 10) + 12).toString().padStart(2, '0')
      businessCandidate.operatingHours = `${openHour}:00 - ${closeHour}:00`
    } else {
      businessCandidate.operatingHours = hoursMatch[0]
    }
  }

  const priceMatch = trimmed.match(/([0-9,]+원)/)
  if (priceMatch) {
    businessCandidate.priceInfo = priceMatch[1]
  }

  const summaryParts: string[] = []
  if (businessCandidate.location) summaryParts.push(`위치: '${businessCandidate.location}'`)
  if (businessCandidate.reservationPolicy) summaryParts.push(`예약 방식: '${businessCandidate.reservationPolicy}'`)
  if (businessCandidate.category) summaryParts.push(`업종: '${businessCandidate.category}'`)
  if (businessCandidate.operatingHours) summaryParts.push(`영업시간: '${businessCandidate.operatingHours}'`)
  if (businessCandidate.priceInfo) summaryParts.push(`가격: '${businessCandidate.priceInfo}'`)

  const summaryText = summaryParts.length > 0
    ? summaryParts.join(', ')
    : trimmed

  return {
    actionType: 'save_business_fact_draft',
    isForbidden: false,
    extractedCandidate: businessCandidate,
    humanTranslation: {
      humanSummaryPreview: `제가 이렇게 이해했어요: ${summaryText} 정보를 초안으로 정리했습니다.`,
      editPath: '/start',
      reassurance: '사업자 검증 및 지식베이스 화면에서 언제든 직접 수정하고 확정하실 수 있어요.',
    },
    lineage: {
      sourceUtterance: cleanedText,
      extractedCandidate: businessCandidate,
      confidence: 0.85,
      validationResult: hasRedacted ? 'WARNING' : 'VALID',
    },
  }
}
