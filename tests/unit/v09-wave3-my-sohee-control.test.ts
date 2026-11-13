/**
 * Tests for Sohee V0.9 Wave 3 My Sohee Control Center
 * Traceability: ANI-930
 */

import { describe, it, expect } from 'vitest';
import { MySoheeService } from '@/lib/my-sohee/my-sohee-service';
import { 
  VersionedRuleObject, 
  AutonomyEnvelopePolicy, 
  RecurringRoutine 
} from '@/types/my-sohee-control';

describe('V0.9 Wave 3 · My Sohee Control Center (ANI-930)', () => {
  it('1. 직접 필드 편집과 Dock 자연어 지시가 동일한 Versioned Rule을 변경하고 감사 기록을 생성해야 한다', () => {
    const initialRule: VersionedRuleObject = {
      ruleId: 'rule-voice-001',
      workspaceId: 'ws-gangnam',
      version: 1,
      category: 'VOICE',
      title: '브랜드 톤앤매너',
      content: '친절하고 따뜻한 이웃 원장님 말투',
      source: 'OWNER_DIRECT_EDIT',
      confidence: 1.0,
      isApproved: true,
      updatedAt: '2026-09-01T10:00:00.000Z',
      author: '원장님',
    };

    // 1-1. 직접 편집에 의한 업데이트
    const { updatedRule: directUpdated, auditRecord: directAudit } = MySoheeService.updateRuleObject(
      initialRule,
      {
        content: '전문적이면서도 다정한 1:1 퍼스널 디자인 상담 말투',
        source: 'OWNER_DIRECT_EDIT',
        author: '원장님',
      }
    );

    expect(directUpdated.version).toBe(2);
    expect(directUpdated.content).toContain('전문적이면서도');
    expect(directAudit.previousVersion).toBe(1);
    expect(directAudit.newVersion).toBe(2);
    expect(directAudit.mutatedBy).toBe('OWNER_DIRECT_EDIT');

    // 1-2. Dock 자연어 지시("소희야 시술 설명할 때 무통 강조해줘")에 의한 업데이트
    const { updatedRule: dockUpdated, auditRecord: dockAudit } = MySoheeService.updateRuleObject(
      directUpdated,
      {
        content: '전문적이면서도 다정한 1:1 퍼스널 디자인 상담 말투 (무통 및 위생 철저 강조)',
        source: 'DOCK_CHAT_MUTATION',
        author: 'UniversalAgentDock',
      }
    );

    expect(dockUpdated.version).toBe(3);
    expect(dockUpdated.content).toContain('무통 및 위생 철저 강조');
    expect(dockAudit.previousVersion).toBe(2);
    expect(dockAudit.newVersion).toBe(3);
    expect(dockAudit.mutatedBy).toBe('DOCK_CHAT_MUTATION');
  });

  it('2. Autonomy Envelope 가드레일 정책이 버전 관리되어 안전하게 저장되어야 한다', () => {
    const initialPolicy: AutonomyEnvelopePolicy = {
      policyId: 'pol-001',
      workspaceId: 'ws-gangnam',
      version: 1,
      maxDailyAdSpendKrw: 30000,
      maxDiscountPercent: 15,
      allowedChannels: ['INSTAGRAM', 'NAVER_BLOG'],
      forbiddenWords: ['완치', '100% 보장'],
      approvalConditions: {
        minSpendRequiringApproval: 20000,
        requireApprovalForNewCampaign: true,
        requireApprovalForRefundProposal: true,
      },
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const updated = MySoheeService.saveAutonomyEnvelope(initialPolicy, {
      maxDailyAdSpendKrw: 50000,
      maxDiscountPercent: 20,
    });

    expect(updated.version).toBe(2);
    expect(updated.maxDailyAdSpendKrw).toBe(50000);
    expect(updated.maxDiscountPercent).toBe(20);
    expect(updated.updatedAt).not.toBe(initialPolicy.updatedAt);
  });

  it('3. Learning Memory는 오직 검증된 Evidence만 source로 사용하며 TTL을 지원해야 한다', () => {
    // 3-1. evidenceId 누락 시 즉각 거부 (Fail-Closed)
    expect(() => {
      MySoheeService.recordLearningMemory({
        workspaceId: 'ws-gangnam',
        sourceEvidenceId: '', // 누락
        learnedInsight: '화요일 15시 예약률이 가장 높음',
        confidenceScore: 0.95,
      });
    }).toThrow(/requires a verified source evidence ID/);

    // 3-2. 검증된 evidenceId로 정상 학습 메모리 기록
    const memory = MySoheeService.recordLearningMemory({
      workspaceId: 'ws-gangnam',
      sourceEvidenceId: 'ev_proof_confirmed_888',
      learnedInsight: '화요일 15시 예약률이 가장 높음',
      confidenceScore: 0.95,
      ttlDays: 14,
    });

    expect(memory.status).toBe('ACTIVE');
    expect(memory.sourceEvidenceId).toBe('ev_proof_confirmed_888');
    expect(memory.confidenceScore).toBe(0.95);
    expect(new Date(memory.ttlTimestamp).getTime()).toBeGreaterThan(Date.now());
  });

  it('4. Recurring Routine이 Owner-Absent 런타임 환경과 정확히 연계되어야 한다', () => {
    const routineHighRisk: RecurringRoutine = {
      routineId: 'rout-01',
      workspaceId: 'ws-gangnam',
      title: '대량 신규 광고 캠페인 자동 송출',
      cronExpression: '0 9 * * *',
      targetAction: 'CAMPAIGN_BATCH_SEND',
      isActive: true,
      ownerAbsentSupported: false, // 원장님 부재 시 실행 불가
      lastRunAt: null,
      lastProofId: null,
    };

    const routineLowRisk: RecurringRoutine = {
      routineId: 'rout-02',
      workspaceId: 'ws-gangnam',
      title: '유휴 슬롯 모니터링 및 상권 키워드 순위 수집',
      cronExpression: '0 * * * *',
      targetAction: 'COLLECT_RANKINGS',
      isActive: true,
      ownerAbsentSupported: true, // 원장님 부재 시에도 자율 가동 가능
      lastRunAt: null,
      lastProofId: null,
    };

    // 원장님 부재 중 (Owner Absent)
    const check1 = MySoheeService.executeRoutineCheck(routineHighRisk, false);
    expect(check1.canRun).toBe(false);
    expect(check1.reason).toContain('사장님 부재 중 자율 실행이 금지된');

    const check2 = MySoheeService.executeRoutineCheck(routineLowRisk, false);
    expect(check2.canRun).toBe(true);
    expect(check2.reason).toContain('사장님 부재 중 안전 자율 가동 승인됨');
  });
});
