/**
 * Sohee V0.9 5th Update · Wave 5 UX QA
 * Responsive · Accessibility · Figma Semantic Visual Regression Verifier
 * 
 * Traceability: ANI-934
 */

export interface ViewportContract {
  width: number;
  height: number;
  name: 'MOBILE_375' | 'TABLET_768' | 'DESKTOP_1440';
  maxContentWidthPx: number;
  allowsHorizontalScroll: boolean;
}

export const CANONICAL_VIEWPORTS: Record<string, ViewportContract> = {
  MOBILE_375: {
    width: 375,
    height: 812,
    name: 'MOBILE_375',
    maxContentWidthPx: 375,
    allowsHorizontalScroll: false,
  },
  TABLET_768: {
    width: 768,
    height: 1024,
    name: 'TABLET_768',
    maxContentWidthPx: 768,
    allowsHorizontalScroll: false,
  },
  DESKTOP_1440: {
    width: 1440,
    height: 900,
    name: 'DESKTOP_1440',
    maxContentWidthPx: 1440,
    allowsHorizontalScroll: false,
  },
};

export type SemanticBadgeState =
  | 'VERIFIED'
  | 'BLOCKED'
  | 'RESULT_UNKNOWN'
  | 'APPROVAL_REQUIRED'
  | 'UNKNOWN'
  | 'STALE'
  | 'DEGRADED'
  | 'INCIDENT';

export interface SemanticBadgeDefinition {
  state: SemanticBadgeState;
  colorClass: string;
  ariaLabel: string;
  requiresEvidenceOrReason: boolean;
  isValidInActualMode: boolean;
}

export const CANONICAL_BADGE_REGISTRY: Record<SemanticBadgeState, SemanticBadgeDefinition> = {
  VERIFIED: {
    state: 'VERIFIED',
    colorClass: 'emerald',
    ariaLabel: '외부 독립 재조회 검증 완료',
    requiresEvidenceOrReason: true,
    isValidInActualMode: true,
  },
  BLOCKED: {
    state: 'BLOCKED',
    colorClass: 'rose',
    ariaLabel: '가드레일 또는 사전조건 미충족으로 차단됨',
    requiresEvidenceOrReason: true,
    isValidInActualMode: true,
  },
  RESULT_UNKNOWN: {
    state: 'RESULT_UNKNOWN',
    colorClass: 'amber',
    ariaLabel: '외부 결과 미확정으로 대사 큐 이관됨',
    requiresEvidenceOrReason: true,
    isValidInActualMode: true,
  },
  APPROVAL_REQUIRED: {
    state: 'APPROVAL_REQUIRED',
    colorClass: 'amber',
    ariaLabel: '원장님 결재 및 승인 대기 중',
    requiresEvidenceOrReason: true,
    isValidInActualMode: true,
  },
  UNKNOWN: {
    state: 'UNKNOWN',
    colorClass: 'zinc',
    ariaLabel: '초기 데이터 수집 대기 중',
    requiresEvidenceOrReason: false,
    isValidInActualMode: true,
  },
  STALE: {
    state: 'STALE',
    colorClass: 'zinc',
    ariaLabel: '데이터 신선도 만료됨',
    requiresEvidenceOrReason: false,
    isValidInActualMode: true,
  },
  DEGRADED: {
    state: 'DEGRADED',
    colorClass: 'amber',
    ariaLabel: '서비스 레이턴시 지연 또는 부분 장애',
    requiresEvidenceOrReason: true,
    isValidInActualMode: true,
  },
  INCIDENT: {
    state: 'INCIDENT',
    colorClass: 'rose',
    ariaLabel: '운영자 긴급 대응 장애 진행 중',
    requiresEvidenceOrReason: true,
    isValidInActualMode: true,
  },
};

export class UxQASemanticVerifier {
  /**
   * 1. 텍스트 클리핑 및 가로 오버플로 검증
   * Acceptance: horizontal overflow 0, Korean long-copy clipping 0
   */
  public verifyResponsiveLayout(params: {
    viewport: ViewportContract;
    renderedElementWidthPx: number;
    koreanText: string;
    hasTextWrap: boolean;
  }): { isValid: boolean; violation?: string } {
    if (params.renderedElementWidthPx > params.viewport.maxContentWidthPx && !params.viewport.allowsHorizontalScroll) {
      return {
        isValid: false,
        violation: `가로 오버플로 감지: 렌더링 너비(${params.renderedElementWidthPx}px)가 뷰포트 너비(${params.viewport.maxContentWidthPx}px)를 초과합니다.`,
      };
    }

    if (!params.hasTextWrap && params.koreanText.length > 30) {
      return {
        isValid: false,
        violation: `한국어 장문 클리핑 위험: text-wrap 속성 없이 30자 이상의 텍스트(${params.koreanText.slice(0, 15)}...)가 배치되었습니다.`,
      };
    }

    return { isValid: true };
  }

  /**
   * 2. 접근성(A11y) 대비율 및 스크린리더 지원 검증
   * Acceptance: WCAG AA contrast, keyboard/focus-visible, status live-region
   */
  public verifyAccessibility(params: {
    contrastRatio: number; // e.g. 4.6 (4.6:1)
    isLargeText: boolean;
    hasLiveRegionForStatus: boolean;
    hasFocusVisibleStyle: boolean;
  }): { isValid: boolean; violation?: string } {
    const minContrast = params.isLargeText ? 3.0 : 4.5;
    if (params.contrastRatio < minContrast) {
      return {
        isValid: false,
        violation: `WCAG AA 명도 대비율 위반: 측정치(${params.contrastRatio}:1)가 최소 기준(${minContrast}:1)에 미달합니다.`,
      };
    }

    if (!params.hasLiveRegionForStatus) {
      return {
        isValid: false,
        violation: '상태 변화 알림 누락: 동적 상태 배지에 aria-live="polite" 등의 라이브 리전이 적용되지 않았습니다.',
      };
    }

    if (!params.hasFocusVisibleStyle) {
      return {
        isValid: false,
        violation: '키보드 접근성 누락: 인터랙티브 요소에 focus-visible 아웃라인 스타일이 지정되지 않았습니다.',
      };
    }

    return { isValid: true };
  }

  /**
   * 3. 프로덕션 라벨 오염 및 내부 디버그 라벨 노출 차단
   * Acceptance: Figma/node/test/sample 내부 라벨 Production 노출 0건
   */
  public scanForForbiddenInternalLabels(htmlString: string): {
    hasViolations: boolean;
    detectedViolations: string[];
  } {
    const forbiddenPatterns = [
      /node-id=\d+-\d+/i,
      /figma\.com/i,
      /sample_user/i,
      /test_token/i,
      /dummy_key/i,
      /placeholder_image/i,
      /32일|33일|34일/i, // 잘못된 날짜
    ];

    const violations: string[] = [];
    for (const pattern of forbiddenPatterns) {
      const match = htmlString.match(pattern);
      if (match) {
        violations.push(`금지된 내부/테스트 라벨 발견: "${match[0]}"`);
      }
    }

    return {
      hasViolations: violations.length > 0,
      detectedViolations: violations,
    };
  }

  /**
   * 4. State Badge 시맨틱 유효성 검증
   * Acceptance: state badge 의미가 canonical runtime semantics와 일치
   */
  public verifyBadgeSemantics(params: {
    state: SemanticBadgeState;
    evidenceId?: string;
    reason?: string;
  }): { isValid: boolean; violation?: string } {
    const def = CANONICAL_BADGE_REGISTRY[params.state];
    if (!def) {
      return { isValid: false, violation: `알 수 없는 상태 배지: ${params.state}` };
    }

    if (def.requiresEvidenceOrReason) {
      if (params.state === 'VERIFIED' && !params.evidenceId) {
        return {
          isValid: false,
          violation: 'False-Green 위반: VERIFIED 배지 표기 시 암호학적 evidenceId가 필수입니다.',
        };
      }
      if ((params.state === 'BLOCKED' || params.state === 'INCIDENT') && !params.reason) {
        return {
          isValid: false,
          violation: `${params.state} 배지 표기 시 차단/장애 사유(reason)가 필수입니다.`,
        };
      }
    }

    return { isValid: true };
  }
}
