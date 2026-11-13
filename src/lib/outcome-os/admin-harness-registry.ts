import type {
  WorkspaceKnowledgeHarness,
  AutomationDefinition,
} from '@/types/autonomous-outcome-os';

export interface HarnessDiffResult {
  hasChanges: boolean;
  fromVersionId: string;
  toVersionId: string;
  changedPolicyKeys: string[];
  changedVoiceKeys: string[];
  changedOfferingCount: number;
  summaryText: string;
}

export interface ImpactedAutomationItem {
  automationId: string;
  title: string;
  currentState: string;
  impactReason: string;
  recommendedAction: 'REEVALUATE_AND_REPLAN' | 'PAUSE' | 'CONTINUE';
}

export function calculateHarnessDiff(
  oldHarness: WorkspaceKnowledgeHarness,
  newHarness: WorkspaceKnowledgeHarness
): HarnessDiffResult {
  const changedPolicyKeys: string[] = [];
  const changedVoiceKeys: string[] = [];

  const oldPolicies = oldHarness.policies as Record<string, unknown>;
  const newPolicies = newHarness.policies as Record<string, unknown>;

  for (const key of Object.keys({ ...oldPolicies, ...newPolicies })) {
    if (JSON.stringify(oldPolicies[key]) !== JSON.stringify(newPolicies[key])) {
      changedPolicyKeys.push(key);
    }
  }

  const oldVoice = oldHarness.brandVoice as Record<string, unknown>;
  const newVoice = newHarness.brandVoice as Record<string, unknown>;

  for (const key of Object.keys({ ...oldVoice, ...newVoice })) {
    if (JSON.stringify(oldVoice[key]) !== JSON.stringify(newVoice[key])) {
      changedVoiceKeys.push(key);
    }
  }

  const changedOfferingCount = Math.abs(
    (newHarness.offerings?.length || 0) - (oldHarness.offerings?.length || 0)
  );

  const hasChanges =
    changedPolicyKeys.length > 0 ||
    changedVoiceKeys.length > 0 ||
    changedOfferingCount > 0 ||
    oldHarness.harnessVersionId !== newHarness.harnessVersionId;

  return {
    hasChanges,
    fromVersionId: oldHarness.harnessVersionId,
    toVersionId: newHarness.harnessVersionId,
    changedPolicyKeys,
    changedVoiceKeys,
    changedOfferingCount,
    summaryText: hasChanges
      ? `정책 ${changedPolicyKeys.length}건, 브랜드 톤 ${changedVoiceKeys.length}건 변경`
      : '변경 사항 없음',
  };
}

export function detectImpactedAutomations(
  diff: { hasChanges: boolean; changedPolicyKeys: string[]; changedVoiceKeys: string[] },
  activeAutomations: AutomationDefinition[]
): ImpactedAutomationItem[] {
  if (!diff.hasChanges || diff.changedPolicyKeys.length === 0) {
    return [];
  }

  return activeAutomations.map((auto) => ({
    automationId: auto.automationId,
    title: auto.title || '활성 자동화',
    currentState: auto.currentState,
    impactReason: `운영 정책 변경 (${diff.changedPolicyKeys.join(', ')}) 감지됨`,
    recommendedAction: 'REEVALUATE_AND_REPLAN',
  }));
}

export function proposeHarnessRollback(
  workspaceId: string,
  targetVersionId: string,
  currentVersionId: string
): {
  proposalId: string;
  workspaceId: string;
  targetVersionId: string;
  currentVersionId: string;
  requiresConfirmation: boolean;
  warning: string;
} {
  return {
    proposalId: `rollback_${Date.now()}`,
    workspaceId,
    targetVersionId,
    currentVersionId,
    requiresConfirmation: true,
    warning: '과거 하네스 버전으로 롤백 시 현재 스케줄된 자동화들이 재평가됩니다.',
  };
}
