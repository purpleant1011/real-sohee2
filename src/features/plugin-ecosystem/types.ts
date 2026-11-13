/**
 * Plugin Ecosystem SSOT Types
 * 
 * ANI-805: Plugin Marketplace 3축 상태 모델
 * ANI-806: Plugin Install Wizard 계약
 * ANI-807: My Plugins 운영 상태
 * ANI-810: @Plugin Invocation
 * ANI-812: Missing Plugin UX 폐쇄 루프
 * ANI-861: Outcome-first Plugin Marketplace
 * ANI-862: Plugin Card Pre-install Contract
 * ANI-863: Plugin READY Count Same Truth
 * ANI-864: Plugin Needs Attention Inbox
 */

export type PluginTrustTier = 'VERIFIED_CORE' | 'COMMUNITY_PARTNER' | 'EXPERIMENTAL_LABS';

export type PluginLifecycleState =
  | 'NOT_INSTALLED'
  | 'INSTALLING'
  | 'INSTALLED_HEALTHY'
  | 'NEEDS_ATTENTION'
  | 'DISABLED';

export type PluginExternalVerificationStatus =
  | 'OFFICIAL_SANDBOX_VERIFIED'
  | 'EXTERNAL_VERIFIED'
  | 'UNVERIFIED';

/**
 * ANI-805: 3축 플러그인 상태 모델
 */
export interface TriaxialPluginState {
  trustTier: PluginTrustTier;
  lifecycleState: PluginLifecycleState;
  verificationStatus: PluginExternalVerificationStatus;
}

/**
 * ANI-862: 설치 전 사전 계약 (Pre-install Contract)
 */
export interface PluginPreInstallContract {
  pluginId: string;
  name: string;
  category: 'CONTENT' | 'CHANNELS' | 'CRM' | 'ANALYTICS' | 'ADS';
  outcomeTarget: string; // 예: "인스타그램 릴스 조회수 2배 증대"
  requiredPermissions: string[]; // 예: ['instagram_basic', 'instagram_content_publish']
  creditCostPerAction: number;
  dataAccessScope: string[];
  slaGuaranteeHours: number;
}

export interface PluginDefinition {
  pluginId: string;
  name: string;
  description: string;
  icon: string;
  packName?: string; // ANI-861 Pack 구조 (예: "매출 폭발 팩")
  invocationTag: string; // ANI-810 예: "@instagram"
  triaxialState: TriaxialPluginState;
  contract: PluginPreInstallContract;
  isReady: boolean; // ANI-863
  version: string;
  attentionReason?: 'TOKEN_EXPIRED' | 'RATE_LIMITED' | 'CREDIT_DEPLETED' | 'NEW_UPDATE_AVAILABLE';
  installedAt?: string;
  lastHealthCheckAt?: string;
}

/**
 * ANI-806: 5단계 설치 위저드 상태
 */
export type WizardStep =
  | 'CHECK_ENTITLEMENT'
  | 'CONFIRM_PERMISSIONS'
  | 'CONNECT_OAUTH'
  | 'HEALTH_CHECK_PING'
  | 'TEST_READ_WRITE'
  | 'READY_CONFIRMED';

export interface PluginInstallWizardSession {
  sessionId: string;
  pluginId: string;
  workspaceId: string;
  currentStep: WizardStep;
  stepResults: Record<string, boolean>;
  isCompleted: boolean;
  errorMessage?: string;
}

/**
 * ANI-812: Missing Plugin 요청 추적
 */
export interface MissingPluginPromptContext {
  originalPrompt: string;
  requiredPluginId: string;
  invocationTag: string;
  suspendedAt: string;
  resumeReady: boolean;
}
