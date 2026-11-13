import 'server-only';

import {
  getProviderDefinition,
  PROVIDER_DEFINITIONS,
  type ProviderId,
  type ProviderReadiness,
} from './registry';

/**
 * OAuth 콜백 앱 Origin 검증 (보안 게이트)
 * - 프로덕션: HTTPS origin만 허용 (HTTP 거부)
 * - 개발(비프로덕션): HTTPS 또는 HTTP localhost만 허용 (점접미사, IPv6, 숫자 IP 모두 거부)
 * - userinfo(@), query(?), hash(#), 백슬래시(\), non-root 경로(/api 등) 원문 및 정규화 차단
 * - 대문자 호스트(A.COM 등)는 정규화 비교로 안전하게 허용
 * - 비밀값이나 세부 오류를 외부로 노출하지 않는 순수 boolean 판정
 */
export function validateCallbackOrigin(
  appUrl: unknown,
  isProduction: boolean
): boolean {
  if (typeof appUrl !== 'string') {
    return false;
  }

  const raw = appUrl.trim();
  if (!raw) {
    return false;
  }

  // 1. 원문 문자열 기준 방어: query(?), hash(#), userinfo(@), 파서 혼동 백슬래시(\) 즉시 거부
  if (
    raw.includes('?') ||
    raw.includes('#') ||
    raw.includes('@') ||
    raw.includes('\\')
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  // 2. URL 객체 차원의 userinfo, search, hash 방어
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return false;
  }

  // 3. 정규화 비교: 대문자 호스트 허용하되, origin 또는 origin+'/'만 일치해야 함 (경로 '/' 하나만 허용)
  const lowerRaw = raw.toLowerCase();
  const origin = parsed.origin.toLowerCase();
  if (lowerRaw !== origin && lowerRaw !== origin + '/') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return false;
  }

  // 4. 프로덕션 환경: HTTPS만 허용
  if (isProduction) {
    return parsed.protocol === 'https:';
  }

  // 5. 개발/비프로덕션 환경: HTTPS 허용 또는 HTTP인 경우 정확한 localhost 또는 127.0.0.1만 허용
  if (parsed.protocol === 'https:') {
    return true;
  }

  if (parsed.protocol === 'http:') {
    // 계약(plan 35행): 개발 환경에서 http는 localhost 또는 정확히 127.0.0.1만 허용
    // 그 외 숫자 IP(10.0.0.1, 127.0.0.2 등), 점접미사(localhost.), IPv6([::1])는 http 거부
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  return false;
}

/**
 * 공급자별 필수 환경설정 충족 여부 검증
 * - 정의된 requiredEnv의 모든 키가 env에 존재하고 공백이 아니어야 함
 * - NEXT_PUBLIC_APP_URL이 포함된 경우 콜백 origin 검증 통과 필수
 * - 누락된 환경변수명이나 비밀값을 반환하지 않는 안전한 boolean 판정
 */
export function hasRequiredProviderConfig(
  providerId: ProviderId,
  env: Readonly<Record<string, string | undefined>>,
  isProduction: boolean
): boolean {
  const def = getProviderDefinition(providerId);
  if (!def) {
    return false;
  }

  for (const envKey of def.requiredEnv) {
    const value = env[envKey];
    if (typeof value !== 'string' || !value.trim()) {
      return false;
    }
  }

  if (def.requiredEnv.includes('NEXT_PUBLIC_APP_URL')) {
    const appUrl = env.NEXT_PUBLIC_APP_URL;
    if (!validateCallbackOrigin(appUrl, isProduction)) {
      return false;
    }
  }

  return true;
}

/**
 * 단일 공급자의 서버 런타임 readiness 판정
 *
 * 상태 우선순위:
 * 1. Meta: existing_management (기존 채널 관리 이동 안내, canConnect=false)
 * 2. Apple: manual_import_unavailable (수동 가져오기 미지원 안내, canConnect=false)
 * 3. Google/Microsoft 등 OAuth 공급자:
 *    - def.oauthImplemented === false이면 환경변수나 승인 여부와 무관하게 not_implemented / canConnect=false 고정
 *    - (실제 구현 true 전환 시 후속): configuration_required → review_required 순으로 평가
 *
 * 보안 원칙:
 * - 반환 메시지는 고정 한국어 문구이며 비밀값·scope 원문·환경변수 이름을 절대 포함하지 않음
 * - canConnect는 모든 미구현 공급자에 대해 엄격히 false로 fail-closed
 */
export function resolveProviderReadiness(
  providerId: ProviderId,
  env: Readonly<Record<string, string | undefined>>,
  runtime: {
    isProduction: boolean;
    approvedProviders: readonly ProviderId[];
  }
): ProviderReadiness {
  const def = getProviderDefinition(providerId);
  if (!def) {
    return Object.freeze({
      providerId,
      method: 'oauth',
      canConnect: false,
      status: 'not_implemented',
      message: '지원하지 않는 공급자입니다.',
    });
  }

  // 1. Meta: 기존 SNS 채널 관리 화면 재사용
  if (def.id === 'meta') {
    return Object.freeze({
      providerId: def.id,
      method: def.method,
      canConnect: false,
      status: 'existing_management',
      message: '기존 채널 관리 화면에서 연동을 확인하고 관리할 수 있습니다.',
      managementHref: def.managementHref ?? '/app/channels',
    });
  }

  // 2. Apple: 수동 캘린더 파일 가져오기 미지원 상태
  if (def.id === 'apple') {
    return Object.freeze({
      providerId: def.id,
      method: def.method,
      canConnect: false,
      status: 'manual_import_unavailable',
      message: '수동 일정 파일 가져오기 기능은 현재 준비 중입니다.',
    });
  }

  // 3. Google / Microsoft 등 OAuth 공급자
  // 1순위: oauthImplemented가 false이면 환경키가 전부 존재하고 승인 목록에 있어도 not_implemented 고정
  if (!def.oauthImplemented) {
    return Object.freeze({
      providerId: def.id,
      method: def.method,
      canConnect: false,
      status: 'not_implemented',
      message: '해당 공급자 연동 기능은 현재 준비 중입니다.',
    });
  }

  // 2순위 (실제 구현 플래그 활성화 후): 필수 환경 설정 충족 여부
  if (!hasRequiredProviderConfig(def.id, env, runtime.isProduction)) {
    return Object.freeze({
      providerId: def.id,
      method: def.method,
      canConnect: false,
      status: 'configuration_required',
      message: '서버 연동을 위한 환경 설정이 필요합니다.',
    });
  }

  // 3순위 (환경 설정 완료 후): 앱 검토 및 승인 여부
  if (!runtime.approvedProviders.includes(def.id)) {
    return Object.freeze({
      providerId: def.id,
      method: def.method,
      canConnect: false,
      status: 'review_required',
      message: '공급자 서비스 검토 및 승인이 필요합니다.',
    });
  }

  // 모든 가드가 통과하더라도 현 F01 계약 상 fail-closed
  return Object.freeze({
    providerId: def.id,
    method: def.method,
    canConnect: false,
    status: 'not_implemented',
    message: '해당 공급자 연동 기능은 현재 준비 중입니다.',
  });
}

/**
 * 4대 전체 공급자의 서버 런타임 readiness 목록 조회 (불변 freeze)
 */
export function listProviderReadiness(
  env: Readonly<Record<string, string | undefined>>,
  runtime: {
    isProduction: boolean;
    approvedProviders: readonly ProviderId[];
  }
): readonly ProviderReadiness[] {
  const results = PROVIDER_DEFINITIONS.map((def) =>
    resolveProviderReadiness(def.id, env, runtime)
  );
  return Object.freeze(results);
}
