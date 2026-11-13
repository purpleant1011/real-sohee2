import type { ActionRiskTier, AgentEnergyPlanTier } from './autonomous-outcome-os';

export type PluginTrustTier =
  | 'SOHEE_CORE'
  | 'VERIFIED_FIRST_PARTY'
  | 'VERIFIED_PARTNER'
  | 'COMMUNITY_REVIEWED'
  | 'PRIVATE_WORKSPACE'
  | 'EXPERIMENTAL'
  | 'BLOCKED';

export type PluginInstallationState =
  | 'AVAILABLE'
  | 'PLAN_LOCKED'
  | 'INSTALLING'
  | 'AUTH_REQUIRED'
  | 'CONFIG_REQUIRED'
  | 'HEALTH_CHECKING'
  | 'READY'
  | 'DEGRADED'
  | 'REAUTH_REQUIRED'
  | 'UPDATE_REQUIRED'
  | 'BLOCKED'
  | 'DISABLED'
  | 'UNINSTALLED';

export type PluginApprovalDefault =
  | 'ALWAYS_ASK'
  | 'ASK_ON_CHANGE'
  | 'IMPORTANT_ONLY'
  | 'GUARDED_AUTO';

export interface PluginCapabilityDefinition {
  capabilityId: string;
  name: string;
  description: string;
  actionRiskTier: ActionRiskTier;
  riskClass: 'READ' | 'DRAFT' | 'WRITE' | 'SPEND' | 'DELETE' | 'PRIVILEGED';
  requiredScopes: string[];
  creditCostWeight: number; // multiplier against base credits
  supportsIdempotency: boolean;
  requiresExternalVerification: boolean;
}

export interface SoheePluginManifest {
  pluginId: string;
  slug: string;
  displayName: string;
  version: string;
  publisherId: string;
  publisherType: 'SOHEE' | 'VERIFIED_PARTNER' | 'COMMUNITY';
  summary: string;
  categories: string[];
  outcomeTags: string[]; // e.g. ["예약 늘리기", "인스타그램 성장", "카카오 상담"]
  icon: string;
  trustTier: PluginTrustTier;
  minPlanTier: AgentEnergyPlanTier;
  entitlementKey: string;
  capabilities: PluginCapabilityDefinition[];
  requiredPlugins?: string[];
  requiredScopes: string[];
  approvalDefault: PluginApprovalDefault;
  creditMeteringPolicyId: string;
  isExternalSubscriptionRequired?: boolean;
  externalPassThroughCostNote?: string;
  verificationMethod?: string;
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
}

export interface WorkspaceInstalledPlugin {
  installationId: string;
  workspaceId: string;
  pluginId: string;
  manifestVersion: string;
  state: PluginInstallationState;
  installedAt: string;
  connectedAccountId?: string;
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  lastHealthCheckedAt: string;
  approvalMode: PluginApprovalDefault;
  isCircuitBreakerOpen: boolean;
  customConfig?: Record<string, any>;
}

export interface ChatToolbeltItem {
  pluginId: string;
  displayName: string;
  icon: string;
  state: PluginInstallationState;
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  isReadyToCall: boolean;
  capabilities: string[];
  riskTierBadge: ActionRiskTier;
  approvalMode: PluginApprovalDefault;
  estimatedCreditImpact: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ChatToolbeltSnapshot {
  workspaceId: string;
  generatedAt: string;
  readyItems: ChatToolbeltItem[];
  actionRequiredItems: ChatToolbeltItem[];
  planLockedItems: ChatToolbeltItem[];
  totalAvailableToolsCount: number;
}

export interface PluginRoutingDecision {
  allowed: boolean;
  pluginId?: string;
  capabilityId?: string;
  provider?: string;
  reason?: string;
  missingPluginCandidate?: SoheePluginManifest;
  requiresUpgrade?: boolean;
}

export type PluginLifecycleStage =
  | 'PUBLISHED'
  | 'ELIGIBLE'
  | 'INSTALLED'
  | 'CONNECTED'
  | 'READY'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'RECONSENT_REQUIRED';

export interface PluginArtifactMetadata {
  pluginId: string;
  version: string;
  byteLength: number;
  sha256: string;
  signatureStatus: 'VERIFIED' | 'SIGNED' | 'UNSIGNED' | 'INVALID_EMPTY_ARTIFACT';
  verificationMethod: string;
  evaluatedAt: string;
  error?: string;
}

export interface PluginOccupancy {
  pluginId: string;
  eligibleWorkspacesCount: number;
  activeInstalledWorkspacesCount: number;
  occupancyRate: number;
  freshness: string;
}

export interface PluginSbomComponent {
  name: string;
  version: string;
  license: string;
  purl?: string;
  sha256?: string;
}

export interface PluginSbomReport {
  pluginId: string;
  version: string;
  format: 'CycloneDX_1.5';
  components: PluginSbomComponent[];
  artifactHash: string;
  verifiedAt: string;
}
