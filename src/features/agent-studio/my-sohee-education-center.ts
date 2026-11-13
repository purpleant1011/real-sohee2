/**
 * My Sohee Employee Education & Delegation Center (ANI-1264)
 *
 * Integrates store knowledge, operating rules, delegation envelope, channel links,
 * and learned memories into a unified employee education center.
 * Enforces fact state separation: CONFIRMED_FACT vs INFERRED_CANDIDATE vs OUTDATED_FACT.
 */

export type FactCertaintyLevel = 'CONFIRMED_FACT' | 'INFERRED_CANDIDATE' | 'OUTDATED_FACT';

export type DelegationPolicyLevel = 'AUTO' | 'CONDITIONAL_AUTO' | 'ALWAYS_APPROVE' | 'FORBIDDEN';

export interface StoreServiceKnowledge {
  serviceId: string;
  serviceName: string;
  priceKrw: number;
  durationMinutes: number;
  description: string;
  certainty: FactCertaintyLevel;
}

export interface OperatingRuleItem {
  ruleId: string;
  ruleCategory: 'VOICE_TONE' | 'FORBIDDEN_WORDS' | 'LEGAL_COMPLIANCE' | 'CUSTOMER_RESPONSE';
  title: string;
  content: string;
  certainty: FactCertaintyLevel;
  isActive: boolean;
  version: number;
  updatedAt: string;
}

export interface ChannelLinkState {
  channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN';
  accountHandle: string;
  isConnected: boolean;
  tokenStatus: 'VALID' | 'EXPIRED' | 'UNLINKED';
  permissions: string[];
}

export interface LearnedMemoryEntry {
  memoryId: string;
  topic: string;
  content: string;
  sourceEvidenceRef: string;
  certainty: FactCertaintyLevel;
  learnedAt: string;
  confirmedByOwner: boolean;
}

export interface MySoheeEducationProfile {
  workspaceId: string;
  storeName: string;
  brandTone: string;
  targetCustomerProfile: string;
  operatingHours: string;
  services: StoreServiceKnowledge[];
  rules: OperatingRuleItem[];
  delegationPolicies: Record<string, DelegationPolicyLevel>;
  channelLinks: ChannelLinkState[];
  learnedMemories: LearnedMemoryEntry[];
  knowledgeVersion: number;
  policyVersion: number;
  updatedAt: string;
}

export class MySoheeEducationManager {
  /**
   * 기본 직원 프로필 초기화
   */
  createDefaultProfile(workspaceId: string, storeName = '우리 매장'): MySoheeEducationProfile {
    const now = new Date().toISOString();
    return {
      workspaceId,
      storeName,
      brandTone: '단정하고 신뢰감 있는 친근한 전문가 어조',
      targetCustomerProfile: '인근 직장인 및 거주 20~40대 고객층',
      operatingHours: '월~토 10:00 - 20:00 (일요일 휴무)',
      services: [],
      rules: [
        {
          ruleId: 'rule_forbidden_medical',
          ruleCategory: 'LEGAL_COMPLIANCE',
          title: '의료법 및 과장 광고 금지',
          content: '치료, 완치, 부작용 0% 등의 절대적 과장 표현을 일절 사용하지 않습니다.',
          certainty: 'CONFIRMED_FACT',
          isActive: true,
          version: 1,
          updatedAt: now,
        },
        {
          ruleId: 'rule_gentle_tone',
          ruleCategory: 'VOICE_TONE',
          title: '부드러운 존댓말 원칙',
          content: '고객에게 항상 따뜻하고 배려 깊은 존댓말을 사용합니다.',
          certainty: 'CONFIRMED_FACT',
          isActive: true,
          version: 1,
          updatedAt: now,
        },
      ],
      delegationPolicies: {
        DRAFT_CREATION: 'AUTO',
        SAFE_AUTO_REPLY: 'CONDITIONAL_AUTO',
        PUBLIC_PUBLISH: 'ALWAYS_APPROVE',
        AD_SPEND: 'ALWAYS_APPROVE',
        MEDICAL_LEGAL_DIAGNOSIS: 'FORBIDDEN',
      },
      channelLinks: [
        { channel: 'INSTAGRAM', accountHandle: '', isConnected: false, tokenStatus: 'UNLINKED', permissions: [] },
        { channel: 'THREADS', accountHandle: '', isConnected: false, tokenStatus: 'UNLINKED', permissions: [] },
      ],
      learnedMemories: [],
      knowledgeVersion: 1,
      policyVersion: 1,
      updatedAt: now,
    };
  }

  /**
   * 사장님의 지식/규칙 추가 또는 수정
   */
  updateOperatingRule(
    profile: MySoheeEducationProfile,
    rule: Omit<OperatingRuleItem, 'version' | 'updatedAt'>
  ): MySoheeEducationProfile {
    const now = new Date().toISOString();
    const existingIdx = profile.rules.findIndex((r) => r.ruleId === rule.ruleId);
    let updatedRules = [...profile.rules];

    if (existingIdx >= 0) {
      const prev = profile.rules[existingIdx];
      updatedRules[existingIdx] = {
        ...rule,
        version: prev.version + 1,
        updatedAt: now,
      };
    } else {
      updatedRules.push({
        ...rule,
        version: 1,
        updatedAt: now,
      });
    }

    return {
      ...profile,
      rules: updatedRules,
      policyVersion: profile.policyVersion + 1,
      updatedAt: now,
    };
  }

  /**
   * 학습된 가설(INFERRED_CANDIDATE)을 사장님이 확정 사실(CONFIRMED_FACT)로 승인
   */
  confirmLearnedMemory(
    profile: MySoheeEducationProfile,
    memoryId: string
  ): MySoheeEducationProfile {
    const now = new Date().toISOString();
    const updatedMemories = profile.learnedMemories.map((m) => {
      if (m.memoryId === memoryId) {
        return {
          ...m,
          certainty: 'CONFIRMED_FACT' as FactCertaintyLevel,
          confirmedByOwner: true,
        };
      }
      return m;
    });

    return {
      ...profile,
      learnedMemories: updatedMemories,
      knowledgeVersion: profile.knowledgeVersion + 1,
      updatedAt: now,
    };
  }

  /**
   * 새 학습 지식 등록 (반드시 검증된 증거 sourceEvidenceRef 필수)
   */
  registerLearnedMemory(
    profile: MySoheeEducationProfile,
    params: {
      topic: string;
      content: string;
      sourceEvidenceRef: string;
      certainty?: FactCertaintyLevel;
    }
  ): MySoheeEducationProfile {
    if (!params.sourceEvidenceRef) {
      throw new Error('검증된 증거(sourceEvidenceRef) 없이 학습 지식을 등록할 수 없습니다.');
    }

    const now = new Date().toISOString();
    const newEntry: LearnedMemoryEntry = {
      memoryId: `mem_${profile.workspaceId}_${Date.now()}`,
      topic: params.topic,
      content: params.content,
      sourceEvidenceRef: params.sourceEvidenceRef,
      certainty: params.certainty || 'INFERRED_CANDIDATE',
      learnedAt: now,
      confirmedByOwner: false,
    };

    return {
      ...profile,
      learnedMemories: [newEntry, ...profile.learnedMemories],
      updatedAt: now,
    };
  }
}
