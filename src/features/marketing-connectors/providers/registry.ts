/**
 * 마케팅 커넥터 공급자 정적 계약 및 레지스트리 (F01)
 *
 * 공통 계약:
 * - 4개 공급자(Google, Microsoft, Meta, Apple)의 선언적 정의 및 불변(immutable) 레지스트리
 * - 브라우저와 서버 모두 안전하게 import 가능한 정적 계약 (환경변수 값 조회 없음)
 * - 모든 신규 OAuth 및 sourceRead 구현 플래그는 false 고정 (실제 구현 시 후속 티켓에서 활성화)
 * - Meta는 기존 관리 경로(/app/channels) 유지
 * - Google/Microsoft의 redirectPath 및 최소 필요 scope 고정
 */

import type { ConnectorId } from '../catalog';

export type ProviderId = 'google' | 'microsoft' | 'meta' | 'apple';

export type ProviderReadiness = {
  providerId: ProviderId;
  method: 'oauth' | 'existing' | 'import';
  canConnect: boolean;
  status:
    | 'not_implemented'
    | 'configuration_required'
    | 'review_required'
    | 'existing_management'
    | 'manual_import_unavailable';
  message: string;
  managementHref?: string;
};

export type ProviderDefinition = {
  id: ProviderId;
  method: ProviderReadiness['method'];
  connectorIds: readonly ConnectorId[];
  requiredEnv: readonly string[];
  redirectPath: string | null;
  requestedScopes: readonly string[];
  oauthImplemented: boolean;
  sourceReadImplemented: boolean;
  managementHref?: string;
};

const RAW_PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: 'google',
    method: 'oauth',
    connectorIds: [
      'google_calendar',
      'google_docs',
      'google_sheets',
      'gmail',
      'google_drive',
    ],
    requiredEnv: [
      'MARKETING_GOOGLE_CLIENT_ID',
      'MARKETING_GOOGLE_CLIENT_SECRET',
      'MARKETING_CONNECTOR_TOKEN_KEY',
      'NEXT_PUBLIC_APP_URL',
    ],
    redirectPath: '/api/marketing-connectors/google/callback',
    // Calendar events readonly 최소 권한만 선언 (Docs/Gmail은 후속 점진적 동의)
    requestedScopes: [
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
    oauthImplemented: true,
    sourceReadImplemented: true,
  },
  {
    id: 'microsoft',
    method: 'oauth',
    connectorIds: ['outlook_mail'],
    requiredEnv: [
      'MARKETING_MICROSOFT_CLIENT_ID',
      'MARKETING_MICROSOFT_CLIENT_SECRET',
      'MARKETING_MICROSOFT_TENANT_ID',
      'MARKETING_CONNECTOR_TOKEN_KEY',
      'NEXT_PUBLIC_APP_URL',
    ],
    redirectPath: '/api/marketing-connectors/microsoft/callback',
    // Mail.ReadBasic 등 최소 초기 계약 (본문 읽기는 후속 명시 동의)
    requestedScopes: ['openid', 'offline_access', 'Mail.ReadBasic'],
    oauthImplemented: true,
    sourceReadImplemented: true,
  },
  {
    id: 'meta',
    method: 'existing',
    connectorIds: ['threads', 'instagram', 'instagram_messages'],
    requiredEnv: [],
    redirectPath: null,
    requestedScopes: [],
    oauthImplemented: false,
    sourceReadImplemented: false,
    managementHref: '/app/channels',
  },
  {
    id: 'apple',
    method: 'import',
    connectorIds: ['apple_calendar', 'apple_reminders'],
    requiredEnv: [],
    redirectPath: null,
    requestedScopes: [],
    oauthImplemented: false,
    sourceReadImplemented: true,
  },
];

/**
 * 딥 프리즈(deep freeze)된 불변(immutable) 공급자 레지스트리
 */
export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] =
  Object.freeze(
    RAW_PROVIDER_DEFINITIONS.map((def) =>
      Object.freeze({
        ...def,
        connectorIds: Object.freeze([...def.connectorIds]),
        requiredEnv: Object.freeze([...def.requiredEnv]),
        requestedScopes: Object.freeze([...def.requestedScopes]),
      })
    )
  );

const PROVIDER_MAP = new Map<ProviderId, ProviderDefinition>(
  PROVIDER_DEFINITIONS.map((def) => [def.id, def])
);

/**
 * 유효한 ProviderId 판별을 위한 타입 가드
 */
export function isKnownProviderId(value: unknown): value is ProviderId {
  if (typeof value !== 'string') {
    return false;
  }
  return PROVIDER_MAP.has(value as ProviderId);
}

/**
 * 공급자 정의 조회 (런타임 fail-closed)
 */
export function getProviderDefinition(
  input: string
): ProviderDefinition | undefined {
  if (typeof input !== 'string' || !input) {
    return undefined;
  }
  return PROVIDER_MAP.get(input as ProviderId);
}
