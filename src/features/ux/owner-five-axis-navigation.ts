/**
 * Owner 5-Axis Canonical Navigation & Legacy Deep Link Router (ANI-1266)
 *
 * Establishes the 5 canonical destinations for business owners:
 * 1. Today (오늘) · /app
 * 2. Content (콘텐츠) · /app/content
 * 3. Customers (고객) · /app/customers
 * 4. Results (성과) · /app/results
 * 5. My Sohee (나의 소희) · /app/sohee
 *
 * Maps and safely redirects legacy deep links to canonical destinations.
 */

export interface CanonicalNavAxis {
  axisKey: 'today' | 'content' | 'customers' | 'results' | 'my-sohee';
  href: string;
  label: string;
  mobileLabel: string;
  iconName: string;
  description: string;
  exactMatch?: boolean;
}

export const OWNER_FIVE_AXIS_NAVIGATION: readonly CanonicalNavAxis[] = Object.freeze([
  {
    axisKey: 'today',
    href: '/app',
    label: '오늘',
    mobileLabel: '오늘',
    iconName: 'Sparkles',
    description: '오늘의 목표, 소희의 업무, 사장님 결정, 기회 브리핑',
    exactMatch: true,
  },
  {
    axisKey: 'content',
    href: '/app/content',
    label: '콘텐츠',
    mobileLabel: '콘텐츠',
    iconName: 'FileText',
    description: '기획부터 검토, 발행, 반응 관측까지의 7단 파이프라인',
  },
  {
    axisKey: 'customers',
    href: '/app/customers',
    label: '고객',
    mobileLabel: '고객',
    iconName: 'Users',
    description: '지금 답할 고객, 예약 가능성, 확정 예약, 사람 인계 대화',
  },
  {
    axisKey: 'results',
    href: '/app/results',
    label: '성과',
    mobileLabel: '성과',
    iconName: 'BarChart3',
    description: '게시→반응→예약 인과 스토리라인과 검증된 지표',
  },
  {
    axisKey: 'my-sohee',
    href: '/app/sohee',
    label: '나의 소희',
    mobileLabel: '나의 소희',
    iconName: 'Sliders',
    description: '매장 지식, 업무 규칙, 4단 위임 범위, 채널 연동 센터',
  },
]);

export interface LegacyRedirectRule {
  pattern: RegExp;
  targetCanonicalPath: string;
  reason: string;
}

export const LEGACY_DEEP_LINK_RULES: readonly LegacyRedirectRule[] = Object.freeze([
  {
    pattern: /^\/app\/work(\/.*)?$/,
    targetCanonicalPath: '/app/content',
    reason: '레거시 작업 목록을 7단 콘텐츠 업무 파이프라인으로 통합',
  },
  {
    pattern: /^\/app\/channels(\/.*)?$/,
    targetCanonicalPath: '/app/sohee?tab=channels',
    reason: '채널 연동을 나의 소희 채널 연결 섹션으로 통합',
  },
  {
    pattern: /^\/app\/reports(\/.*)?$/,
    targetCanonicalPath: '/app/results',
    reason: '레거시 리포트를 검증된 성과 스토리라인으로 승격',
  },
  {
    pattern: /^\/app\/settings\/business(\/.*)?$/,
    targetCanonicalPath: '/app/sohee?tab=knowledge',
    reason: '사업장 설정을 나의 소희 매장 이해 센터로 통합',
  },
  {
    pattern: /^\/app\/settings(\/.*)?$/,
    targetCanonicalPath: '/app/sohee',
    reason: '설정 허브를 나의 소희 교육 센터로 통합',
  },
  {
    pattern: /^\/app\/inbox(\/.*)?$/,
    targetCanonicalPath: '/app/customers',
    reason: '인박스를 4대 고객 업무 큐로 통합',
  },
  {
    pattern: /^\/app\/content-hub(\/.*)?$/,
    targetCanonicalPath: '/app/content',
    reason: '콘텐츠 허브를 정본 콘텐츠 파이프라인으로 일원화',
  },
]);

export class OwnerNavigationRouter {
  /**
   * 경로가 5대 축 중 어디에 속하는지 판정
   */
  resolveActiveAxis(pathname: string): CanonicalNavAxis['axisKey'] {
    if (pathname === '/app' || pathname === '/app/') {
      return 'today';
    }
    if (pathname.startsWith('/app/content')) {
      return 'content';
    }
    if (pathname.startsWith('/app/customers') || pathname.startsWith('/app/crm')) {
      return 'customers';
    }
    if (pathname.startsWith('/app/results') || pathname.startsWith('/app/reports')) {
      return 'results';
    }
    if (pathname.startsWith('/app/sohee') || pathname.startsWith('/app/settings')) {
      return 'my-sohee';
    }
    return 'today';
  }

  /**
   * 레거시 딥링크 요청을 정본 5축 경로로 리다이렉트
   */
  resolveLegacyRedirect(pathname: string): { shouldRedirect: boolean; targetPath?: string; reason?: string } {
    for (const rule of LEGACY_DEEP_LINK_RULES) {
      if (rule.pattern.test(pathname)) {
        return {
          shouldRedirect: true,
          targetPath: rule.targetCanonicalPath,
          reason: rule.reason,
        };
      }
    }
    return { shouldRedirect: false };
  }
}
