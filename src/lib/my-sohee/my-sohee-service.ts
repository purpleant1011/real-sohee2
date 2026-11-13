/**
 * Sohee V0.9 5th Update · Wave 3 My Sohee Service
 * Versioned Rules, Autonomy Envelope, Learning Memory & Recurring Routines
 * 
 * Traceability: ANI-930
 */

import {
  VersionedRuleObject,
  AutonomyEnvelopePolicy,
  RecurringRoutine,
  LearningMemoryItem,
  RuleAuditRecord,
  MutationSource,
} from '@/types/my-sohee-control';

export class MySoheeService {
  /**
   * Versioned Rule Object 업데이트 (직접 편집 & Dock 자연어 지시 단일 모델)
   * Acceptance: "직접 필드 편집과 Dock 자연어 지시가 같은 versioned rule/knowledge object를 변경"
   */
  public static updateRuleObject(
    existing: VersionedRuleObject,
    params: {
      title?: string;
      content: string;
      source: MutationSource;
      author: string;
    }
  ): { updatedRule: VersionedRuleObject; auditRecord: RuleAuditRecord } {
    const nextVersion = existing.version + 1;
    const updatedAt = new Date().toISOString();

    const updatedRule: VersionedRuleObject = {
      ...existing,
      title: params.title || existing.title,
      content: params.content,
      version: nextVersion,
      source: params.source,
      updatedAt,
      author: params.author,
    };

    const auditRecord: RuleAuditRecord = {
      auditId: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ruleId: existing.ruleId,
      workspaceId: existing.workspaceId,
      previousVersion: existing.version,
      newVersion: nextVersion,
      mutatedBy: params.source,
      changeSummary: `Version ${existing.version} ➔ ${nextVersion} by ${params.author} via ${params.source}`,
      timestamp: updatedAt,
    };

    return { updatedRule, auditRecord };
  }

  /**
   * Autonomy Envelope 정책 저장
   * Acceptance: "autonomy envelope(예산/할인/채널/금칙어/승인 조건) server policy로 저장"
   */
  public static saveAutonomyEnvelope(
    current: AutonomyEnvelopePolicy,
    updates: Partial<Omit<AutonomyEnvelopePolicy, 'policyId' | 'workspaceId' | 'version' | 'updatedAt'>>
  ): AutonomyEnvelopePolicy {
    return {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 검증된 증거 기반 학습 메모리 저장 (TTL & Confidence)
   * Acceptance: "learning memory는 verified evidence만 source로 사용하고 TTL/confidence 제공"
   */
  public static recordLearningMemory(params: {
    workspaceId: string;
    sourceEvidenceId: string;
    learnedInsight: string;
    confidenceScore: number;
    ttlDays?: number;
  }): LearningMemoryItem {
    if (!params.sourceEvidenceId || params.sourceEvidenceId.trim().length === 0) {
      throw new Error('[MySoheeService] Learning memory requires a verified source evidence ID');
    }

    if (params.confidenceScore < 0.0 || params.confidenceScore > 1.0) {
      throw new Error('[MySoheeService] Confidence score must be between 0.0 and 1.0');
    }

    const ttlDays = params.ttlDays || 30;
    const ttlTimestamp = new Date(Date.now() + (ttlDays * 86400000)).toISOString();

    return {
      memoryId: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId: params.workspaceId,
      sourceEvidenceId: params.sourceEvidenceId,
      learnedInsight: params.learnedInsight,
      confidenceScore: params.confidenceScore,
      ttlTimestamp,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Recurring Routine 실행 판단 (Owner-Absent 런타임 연결)
   * Acceptance: "recurring routines가 owner-absent runtime과 연결"
   */
  public static executeRoutineCheck(
    routine: RecurringRoutine,
    isOwnerPresent: boolean
  ): { canRun: boolean; reason: string } {
    if (!routine.isActive) {
      return { canRun: false, reason: '비활성화된 루틴입니다.' };
    }

    if (!isOwnerPresent && !routine.ownerAbsentSupported) {
      return {
        canRun: false,
        reason: '사장님 부재 중 자율 실행이 금지된 루틴입니다 (대면 확인 필요).',
      };
    }

    return {
      canRun: true,
      reason: isOwnerPresent
        ? '사장님 재실 중 루틴 자율 가동 가능'
        : '사장님 부재 중 안전 자율 가동 승인됨',
    };
  }
}
