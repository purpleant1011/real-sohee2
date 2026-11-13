import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_OPERATING_POLICY_RULES,
  validateOperatingPolicyRules,
  createOperatingPolicyDraft,
  confirmOperatingPolicy,
  evaluateHandoffRequired,
  evaluateSpendLimit,
  type OperatingPolicyRules,
  type OperatingPolicyVersion,
} from '@/features/operating-policy/operating-policy-manager';
import {
  getActiveOperatingPolicy,
  persistOperatingPolicy,
} from '@/features/operating-policy/operating-policy-server';
import {
  evaluateOperatingPolicyForPublish,
  determineMissionApprovalRequirement,
} from '@/features/operating-policy/runtime-enforcement';
import { getSoheeReadiness } from '@/features/sohee-ready/read-model';

// Mock server admin client & channels verification for isolated read-model tests
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockImplementation(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  })),
}));

vi.mock('@/features/channels/dual-channel-verification', () => ({
  getPersistedChannelVerification: vi.fn().mockResolvedValue({
    verified: false,
    status: 'NOT_CONNECTED',
  }),
}));

function createChainableQuery(resultData: any = null) {
  const query: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: resultData, error: null }),
    single: vi.fn().mockResolvedValue({ data: resultData, error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
  };
  return query;
}

describe('HF-53: Operating Policy Contract & Runtime Enforcement (ANI-1403)', () => {
  const mockWorkspaceId = 'ws-test-policy-123';
  const mockUserId = 'usr-owner-456';
  const mockAttackerId = 'usr-attacker-999';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Readiness Policy Invariant Tests', () => {
    it('1. policy 없음 → SOHEE_READY false & OPERATING_POLICY_CONFIRMED false', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => createChainableQuery(null)),
      };

      const readiness = await getSoheeReadiness(mockWorkspaceId, {
        supabaseClient: mockSupabase as any,
        adminClient: mockSupabase as any,
      });

      expect(readiness.ready).toBe(false);
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.verified).toBe(false);
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.status).toBe('MISSING');
      expect(readiness.blockers.some(b => b.factKey === 'OPERATING_POLICY_CONFIRMED')).toBe(true);
    });

    it('2. Draft만 존재하거나 미승인 상태 → false', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'harness_rules') {
            // Rule exists but is draft or unapproved
            return createChainableQuery({
              id: 'rule-draft-1',
              status: 'draft',
              approved_at: null,
            });
          }
          return createChainableQuery(null);
        }),
      };

      const readiness = await getSoheeReadiness(mockWorkspaceId, {
        supabaseClient: mockSupabase as any,
        adminClient: mockSupabase as any,
      });

      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.verified).toBe(false);
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.status).toBe('MISSING');
    });

    it('3. Agent/system-only candidate(userId 없음) → 확정 거부 및 false 유지', () => {
      expect(() => {
        confirmOperatingPolicy({
          workspaceId: mockWorkspaceId,
          rules: { publishApprovalLevel: 'always_require' },
          userId: '', // No user
        });
      }).toThrow('AUTHZ_CONFIRM_USER_REQUIRED');

      expect(() => {
        confirmOperatingPolicy({
          workspaceId: mockWorkspaceId,
          rules: { publishApprovalLevel: 'always_require' },
          userId: null as any,
        });
      }).toThrow('AUTHZ_CONFIRM_USER_REQUIRED');
    });

    it('4. user confirm → fact true & status CONFIRMED', async () => {
      const mockActiveRule = {
        id: 'rule-active-1',
        workspace_id: mockWorkspaceId,
        rule_key: 'approval_policy_v1',
        version: 1,
        status: 'active',
        structured_rule: {
          ...DEFAULT_OPERATING_POLICY_RULES,
        },
        approved_by_user_id: mockUserId,
        approved_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'harness_rules') {
            return createChainableQuery(mockActiveRule);
          }
          return createChainableQuery(null);
        }),
      };

      const readiness = await getSoheeReadiness(mockWorkspaceId, {
        supabaseClient: mockSupabase as any,
        adminClient: mockSupabase as any,
      });

      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.verified).toBe(true);
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.status).toBe('CONFIRMED');
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.evidenceId).toBe('rule-active-1');
      expect(readiness.facts.OPERATING_POLICY_CONFIRMED.version).toBe('1');
    });
  });

  describe('2. Immutability & Version Lineage Tests', () => {
    it('5. confirmed version in-place mutation 불가 (Object.freeze 보장)', () => {
      const confirmed = confirmOperatingPolicy({
        workspaceId: mockWorkspaceId,
        rules: { publishApprovalLevel: 'always_require' },
        userId: mockUserId,
      });

      expect(Object.isFrozen(confirmed)).toBe(true);
      expect(Object.isFrozen(confirmed.rules)).toBe(true);

      expect(() => {
        (confirmed as any).status = 'retired';
      }).toThrow();

      expect(() => {
        (confirmed.rules as any).publishApprovalLevel = 'full_auto';
      }).toThrow();
    });

    it('6. 새 Draft 생성 중에도 기존 active confirmed version의 runtime 일관성 유지', () => {
      const activePolicy = confirmOperatingPolicy({
        workspaceId: mockWorkspaceId,
        rules: { publishApprovalLevel: 'always_require', maxDailyPublishCount: 2 },
        userId: mockUserId,
        currentVersionNumber: 0, // version 1
      });

      expect(activePolicy.versionNumber).toBe(1);

      // User creates a draft for v2 with different rules
      const draftV2 = createOperatingPolicyDraft({
        workspaceId: mockWorkspaceId,
        rules: { publishApprovalLevel: 'full_auto', maxDailyPublishCount: 5 },
        baseVersionNumber: activePolicy.versionNumber,
      });

      expect(draftV2.status).toBe('draft');
      expect(draftV2.versionNumber).toBe(2);
      expect(draftV2.confirmedByUserId).toBeNull();
      expect(draftV2.confirmedAt).toBeNull();

      // Original active policy remains completely unchanged
      expect(activePolicy.status).toBe('active');
      expect(activePolicy.rules.publishApprovalLevel).toBe('always_require');
      expect(activePolicy.rules.maxDailyPublishCount).toBe(2);
    });

    it('7. active policy 변경 후 필요한 approval requirement가 즉시 갱신', () => {
      const strictPolicy = confirmOperatingPolicy({
        workspaceId: mockWorkspaceId,
        rules: { publishApprovalLevel: 'always_require' },
        userId: mockUserId,
        currentVersionNumber: 0,
      });

      const autoPolicy = confirmOperatingPolicy({
        workspaceId: mockWorkspaceId,
        rules: { publishApprovalLevel: 'full_auto' },
        userId: mockUserId,
        currentVersionNumber: 1,
      });

      const strictDecision = determineMissionApprovalRequirement(strictPolicy);
      expect(strictDecision.requiresHumanApproval).toBe(true);

      const autoDecision = determineMissionApprovalRequirement(autoPolicy);
      expect(autoDecision.requiresHumanApproval).toBe(false);
    });
  });

  describe('3. Runtime Enforcement & Defense-in-Depth Tests', () => {
    it('8. cost limit 초과 → fail-closed', () => {
      const rules: OperatingPolicyRules = {
        ...DEFAULT_OPERATING_POLICY_RULES,
        dailySpendLimitKrw: 10000,
        maxCostPerActionKrw: 2000,
      };

      // 1) Per-action limit exceeded
      const actionCheck = evaluateSpendLimit(rules, {
        proposedCostKrw: 3000, // > 2000
        currentDaySpendKrw: 0,
      });
      expect(actionCheck.allowed).toBe(false);
      expect(actionCheck.errorCode).toBe('PER_ACTION_COST_EXCEEDED');

      // 2) Daily spend limit exceeded
      const dailyCheck = evaluateSpendLimit(rules, {
        proposedCostKrw: 1500,
        currentDaySpendKrw: 9000, // 9000 + 1500 = 10500 > 10000
      });
      expect(dailyCheck.allowed).toBe(false);
      expect(dailyCheck.errorCode).toBe('DAILY_SPEND_LIMIT_EXCEEDED');

      // 3) Within limit
      const passCheck = evaluateSpendLimit(rules, {
        proposedCostKrw: 1500,
        currentDaySpendKrw: 5000,
      });
      expect(passCheck.allowed).toBe(true);
    });

    it('9. stop condition(emergencyStop) → external action 즉각 차단', async () => {
      const mockActiveRule = {
        id: 'rule-stopped-1',
        workspace_id: mockWorkspaceId,
        rule_key: 'approval_policy_v1',
        version: 1,
        status: 'active',
        structured_rule: {
          ...DEFAULT_OPERATING_POLICY_RULES,
          emergencyStop: true, // Emergency Stop Active
        },
        applies_to_channels: ['instagram', 'threads'],
        approved_by_user_id: mockUserId,
        approved_at: new Date().toISOString(),
      };

      const mockSupabase = {
        from: vi.fn().mockReturnValue(createChainableQuery(mockActiveRule)),
      };

      const evaluation = await evaluateOperatingPolicyForPublish(mockWorkspaceId, {
        channel: 'instagram',
        adminClient: mockSupabase as any,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.errorCode).toBe('EMERGENCY_STOP_ACTIVE');
      expect(evaluation.message).toContain('긴급 중단');
    });

    it('10. handoff condition → 자동 응답 대신 사람(원장님)에게 인계', () => {
      const rules: OperatingPolicyRules = {
        ...DEFAULT_OPERATING_POLICY_RULES,
        handoffOnComplaint: true,
        handoffOnPriceInquiry: true,
        handoffOnUncertainty: true,
      };

      // 1) Complaint
      const complaintEval = evaluateHandoffRequired(rules, { isComplaint: true });
      expect(complaintEval.requiresHandoff).toBe(true);
      expect(complaintEval.triggerReason).toBe('complaint');

      // 2) Price inquiry
      const priceEval = evaluateHandoffRequired(rules, { isPriceInquiry: true });
      expect(priceEval.requiresHandoff).toBe(true);
      expect(priceEval.triggerReason).toBe('price_inquiry');

      // 3) Low model confidence
      const uncertEval = evaluateHandoffRequired(rules, { modelConfidence: 0.65 });
      expect(uncertEval.requiresHandoff).toBe(true);
      expect(uncertEval.triggerReason).toBe('model_uncertainty');

      // 4) Standard FAQ question
      const normalEval = evaluateHandoffRequired(rules, {
        isComplaint: false,
        isPriceInquiry: false,
        modelConfidence: 0.95,
      });
      expect(normalEval.requiresHandoff).toBe(false);
    });

    it('11. cross-tenant membership validation → 비회원 요청 시 403 거부', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'workspace_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === 'workspace_id') {
                  return {
                    eq: vi.fn().mockImplementation((col2: string, val2: string) => {
                      if (val2 === mockAttackerId) {
                        return { limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) };
                      }
                      return { limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'm-1' }, error: null }) }) };
                    }),
                  };
                }
                return { eq: vi.fn().mockReturnThis(), limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) };
              }),
            };
          }
          return createChainableQuery(null);
        }),
      };

      await expect(
        persistOperatingPolicy({
          workspaceId: mockWorkspaceId,
          userId: mockAttackerId,
          rules: { publishApprovalLevel: 'full_auto' },
          supabaseClient: mockSupabase as any,
        })
      ).rejects.toThrow('CROSS_TENANT_ACCESS_DENIED');
    });

    it('12. unallowed channel policy enforcement → 미허용 채널 발행 차단', async () => {
      const mockActiveRule = {
        id: 'rule-active-threads-only',
        workspace_id: mockWorkspaceId,
        rule_key: 'approval_policy_v1',
        version: 1,
        status: 'active',
        structured_rule: {
          ...DEFAULT_OPERATING_POLICY_RULES,
          allowedChannels: ['threads'], // Instagram NOT allowed
        },
        applies_to_channels: ['threads'],
        approved_by_user_id: mockUserId,
        approved_at: new Date().toISOString(),
      };

      const mockSupabase = {
        from: vi.fn().mockReturnValue(createChainableQuery(mockActiveRule)),
      };

      const evaluation = await evaluateOperatingPolicyForPublish(mockWorkspaceId, {
        channel: 'instagram', // Attempting instagram
        adminClient: mockSupabase as any,
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.errorCode).toBe('CHANNEL_NOT_ALLOWED_BY_POLICY');
      expect(evaluation.message).toContain('허용 채널 목록에 포함되어 있지 않습니다');
    });

    it('13. Golden Journey policy transition without fixture seeds', async () => {
      // Simulates real user action -> server persistence -> state transition to CONFIRMED
      let storedRule: any = null;

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'workspace_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'm-1', role: 'owner' }, error: null }) }),
            };
          }
          if (table === 'harness_rules') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: storedRule, error: null }),
              }),
              update: vi.fn().mockImplementation((fields: any) => {
                if (storedRule) storedRule.status = fields.status;
                return { eq: vi.fn().mockReturnThis() };
              }),
              insert: vi.fn().mockImplementation((newRow: any) => {
                storedRule = { id: 'rule-db-new', ...newRow };
                return {
                  select: () => ({ single: () => Promise.resolve({ data: storedRule, error: null }) }),
                };
              }),
            };
          }
          return createChainableQuery(null);
        }),
      };

      // Step 1: Pre-confirm -> policy is missing
      const preCheck = await getActiveOperatingPolicy(mockWorkspaceId, mockSupabase as any);
      expect(preCheck).toBeNull();

      // Step 2: User explicitly confirms policy via server action
      const confirmed = await persistOperatingPolicy({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        rules: {
          publishApprovalLevel: 'always_require',
          maxDailyPublishCount: 2,
          allowedChannels: ['instagram', 'threads'],
        },
        supabaseClient: mockSupabase as any,
      });

      expect(confirmed.status).toBe('active');
      expect(confirmed.versionNumber).toBe(1);
      expect(confirmed.confirmedByUserId).toBe(mockUserId);
      expect(confirmed.confirmedAt).toBeTruthy();

      // Step 3: Post-confirm -> active policy is found and valid
      const postCheck = await getActiveOperatingPolicy(mockWorkspaceId, mockSupabase as any);
      expect(postCheck).not.toBeNull();
      expect(postCheck?.status).toBe('active');
      expect(postCheck?.rules.requireApprovalBeforePublish).toBe(true);
    });
  });
});
