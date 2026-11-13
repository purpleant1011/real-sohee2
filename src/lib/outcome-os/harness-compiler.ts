import { createHash } from 'crypto';
import type {
  WorkspaceKnowledgeHarness,
  BusinessIdentityFact,
  OfferingItem,
} from '@/types/autonomous-outcome-os';

export interface HarnessCompilationInput {
  workspaceId: string;
  businessName: string;
  brandSummary?: string;
  locationDistrict?: string;
  operatingHours?: string;
  contactChannels?: string[];
  offerings?: OfferingItem[];
  primaryTarget?: string;
  targetRegions?: string[];
  restrictedDemographics?: string[];
  brandTone?: 'WARM_POLITE' | 'CALM_PROFESSIONAL' | 'VIBRANT_PLAYFUL';
  prohibitedKeywords?: string[];
  mandatoryDisclaimers?: string[];
  channelSpecificExpressions?: Record<string, string>;
  maxDiscountPercent?: number;
  allowDirectMessaging?: boolean;
  dmRequiresApproval?: boolean;
  maxPostsPerDay?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  channelTruth?: Record<string, {
    connected: boolean;
    tenantId: string;
    verifiedHandle: string;
    supportedCapabilities: string[];
  }>;
}

export function createDefaultHarnessInput(
  workspaceId: string,
  overrides?: Partial<HarnessCompilationInput>
): HarnessCompilationInput {
  return {
    workspaceId,
    businessName: overrides?.businessName || '기본 비즈니스',
    brandSummary: overrides?.brandSummary || '소상공인 전문 프리미엄 살롱',
    locationDistrict: overrides?.locationDistrict || '서울시 강남구',
    operatingHours: overrides?.operatingHours || '10:00 - 20:00',
    contactChannels: overrides?.contactChannels || ['instagram', 'phone'],
    offerings: overrides?.offerings || [
      {
        id: 'offering_default',
        title: '시그니처 케어 코스',
        price: 80000,
        discountCapPercent: 10,
        reservationRequired: true,
        inventoryState: 'IN_STOCK',
        promotionalPriority: 1,
      },
    ],
    primaryTarget: overrides?.primaryTarget || '20-40대 직장인 및 인근 거주자',
    targetRegions: overrides?.targetRegions || ['강남구', '서초구'],
    restrictedDemographics: overrides?.restrictedDemographics || [],
    brandTone: overrides?.brandTone || 'WARM_POLITE',
    prohibitedKeywords: overrides?.prohibitedKeywords || ['무조건', '최저가', '공짜'],
    mandatoryDisclaimers: overrides?.mandatoryDisclaimers || ['사전 예약 필수', '노쇼 시 환불 불가'],
    channelSpecificExpressions: overrides?.channelSpecificExpressions || {
      instagram: '✨ 프로필 링크에서 간편 예약 가능합니다!',
      threads: '💬 편하게 댓글 남겨주시면 DM 드릴게요!',
    },
    maxDiscountPercent: overrides?.maxDiscountPercent ?? 10,
    allowDirectMessaging: overrides?.allowDirectMessaging ?? true,
    dmRequiresApproval: overrides?.dmRequiresApproval ?? true,
    maxPostsPerDay: overrides?.maxPostsPerDay ?? 2,
    quietHoursStart: overrides?.quietHoursStart || '22:00',
    quietHoursEnd: overrides?.quietHoursEnd || '08:00',
    channelTruth: overrides?.channelTruth || {
      instagram: {
        connected: true,
        tenantId: 'meta_act_123',
        verifiedHandle: '@sohee_salon_official',
        supportedCapabilities: ['FEED_POST', 'STORY_POST', 'COMMENT_REPLY', 'DM_REPLY'],
      },
    },
  };
}

export function compileWorkspaceHarness(
  input: HarnessCompilationInput,
  versionNo = 1
): WorkspaceKnowledgeHarness {
  const normalizedFacts: Record<string, BusinessIdentityFact> = {
    businessName: {
      factKey: 'businessName',
      factValue: input.businessName,
      lifecycle: 'CANONICAL',
      provenance: {
        sourceId: 'owner_onboarding_form',
        sourceType: 'USER_INPUT',
        extractedAt: new Date().toISOString(),
        confidenceScore: 1.0,
      },
      lastConfirmedAt: new Date().toISOString(),
    },
    operatingHours: {
      factKey: 'operatingHours',
      factValue: input.operatingHours || '10:00 - 20:00',
      lifecycle: 'CANONICAL',
      provenance: {
        sourceId: 'owner_onboarding_form',
        sourceType: 'USER_INPUT',
        extractedAt: new Date().toISOString(),
        confidenceScore: 1.0,
      },
      lastConfirmedAt: new Date().toISOString(),
    },
  };

  const payloadToHash = JSON.stringify({
    workspaceId: input.workspaceId,
    versionNo,
    businessName: input.businessName,
    operatingHours: input.operatingHours,
    tone: input.brandTone,
    maxDiscountPercent: input.maxDiscountPercent,
    maxPostsPerDay: input.maxPostsPerDay,
    quietHoursStart: input.quietHoursStart,
  });

  const hashSnippet = createHash('sha256')
    .update(payloadToHash)
    .digest('hex')
    .slice(0, 8);

  const harnessVersionId = `harness_v${versionNo}_${hashSnippet}`;

  const harness: WorkspaceKnowledgeHarness = {
    harnessVersionId,
    workspaceId: input.workspaceId,
    versionNo,
    compiledAt: new Date().toISOString(),
    isActive: true,
    businessIdentity: {
      businessName: input.businessName,
      brandSummary: input.brandSummary || '',
      locationDistrict: input.locationDistrict || '',
      operatingHours: input.operatingHours || '10:00 - 20:00',
      contactChannels: input.contactChannels || [],
      facts: normalizedFacts,
    },
    offerings: input.offerings || [],
    audience: {
      primaryTarget: input.primaryTarget || '',
      targetRegions: input.targetRegions || [],
      restrictedDemographics: input.restrictedDemographics || [],
    },
    brandVoice: {
      tone: input.brandTone || 'WARM_POLITE',
      prohibitedKeywords: input.prohibitedKeywords || [],
      mandatoryDisclaimers: input.mandatoryDisclaimers || [],
      channelSpecificExpressions: input.channelSpecificExpressions || {},
    },
    policies: {
      maxDiscountPercent: input.maxDiscountPercent ?? 10,
      allowDirectMessaging: input.allowDirectMessaging ?? true,
      dmRequiresApproval: input.dmRequiresApproval ?? true,
      maxPostsPerDay: input.maxPostsPerDay ?? 2,
      quietHoursStart: input.quietHoursStart || '22:00',
      quietHoursEnd: input.quietHoursEnd || '08:00',
    },
    channelTruth: input.channelTruth || {},
  };

  return Object.freeze(harness);
}
