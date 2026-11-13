import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateSlotOpportunity,
  generateSlotOpportunity,
  invalidateSlotOpportunity,
  type SlotOpportunityRequest,
  type SlotLedgerSnapshot,
  type SlotOpportunity,
  type SlotCandidate,
  type LedgerSourceEvidence,
} from './slot-opportunity';

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

describe('slot-opportunity (ANI-1625)', () => {
  const baseNow = '2026-10-21T01:00:00.000Z'; // 10:00:00+09:00 KST
  const baseTz = 'Asia/Seoul';
  const validWorkspace = 'ws-beauty-01';

  const validRequest: SlotOpportunityRequest = {
    workspaceId: validWorkspace,
    queryRange: {
      startsAt: '2026-10-21T14:00:00.000+09:00', // 05:00:00.000Z (> baseNow)
      endsAt: '2026-10-21T18:00:00.000+09:00',   // 09:00:00.000Z
    },
    timezone: baseTz,
  };

  const validOwnerSource: LedgerSourceEvidence = {
    workspaceId: validWorkspace,
    kind: 'OWNER_CONFIRMED',
    sourceId: 'src-owner-01',
    evidenceId: 'ev-owner-ledger-01',
    checkedAt: '2026-10-21T00:55:00.000Z', // 5m ago (< 15m)
    validUntil: '2026-10-21T01:10:00.000Z', // 10m in future
    ledgerVersion: 'lv-001',
    confirmedByRef: 'user-owner-01',
  };

  const validCandidate: SlotCandidate = {
    slotId: 'slot-01',
    slotVersion: 'sv-001',
    catalogVersion: 'cv-001',
    workspaceId: validWorkspace,
    serviceId: 'srv-cut-01',
    range: {
      startsAt: '2026-10-21T14:00:00.000+09:00',
      endsAt: '2026-10-21T15:00:00.000+09:00', // 60 min
    },
    timezone: baseTz,
    status: 'AVAILABLE',
    resource: {
      workspaceId: validWorkspace,
      ledgerVersion: 'lv-001',
      resourceId: 'res-room-01',
      evidenceId: 'ev-res-01',
      version: 'rv-001',
      checkedAt: '2026-10-21T00:50:00.000Z',
      validUntil: '2026-10-21T03:00:00.000Z',
      capacity: 1,
      availableCapacity: 1,
    },
    service: {
      workspaceId: validWorkspace,
      serviceId: 'srv-cut-01',
      catalogVersion: 'cv-001',
      evidenceId: 'ev-srv-01',
      checkedAt: '2026-10-21T00:50:00.000Z',
      validUntil: '2026-10-21T03:00:00.000Z',
      durationMinutes: 45, // <= 60 min
      requiredCapacity: 1,
      priceKrw: 35000,
    },
  };

  const validSuccessSnapshot: SlotLedgerSnapshot = {
    state: 'SUCCESS',
    workspaceId: validWorkspace,
    datasetMode: 'ACTUAL',
    freshness: 'CURRENT',
    coverage: 'COMPLETE',
    queryRange: {
      startsAt: '2026-10-21T14:00:00.000+09:00',
      endsAt: '2026-10-21T18:00:00.000+09:00',
    },
    timezone: baseTz,
    source: validOwnerSource,
    ledgerVersion: 'lv-001',
    candidate: validCandidate,
  };

  describe('1. Missing Port / NOT_OBSERVED / Port Error', () => {
    it('포트가 없거나 null이면 질문 상태와 executionAllowed: false를 반환한다', async () => {
      const decision = await generateSlotOpportunity({
        request: validRequest,
        readLedger: null,
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.availabilityTruth).toBe('UNKNOWN');
      expect(decision.reason).toBe('LEDGER_NOT_OBSERVED');
      expect(decision.message).toBe('빈시간 맞나요? 장부를 확인한 뒤 다시 알려주세요.');
      expect(decision.executionAllowed).toBe(false);
      expect(decision.opportunity).toBeNull();
    });

    it('포트가 NOT_OBSERVED를 반환하면 질문 상태를 반환한다', async () => {
      const decision = await generateSlotOpportunity({
        request: validRequest,
        readLedger: async () => ({ state: 'NOT_OBSERVED', workspaceId: validWorkspace }),
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('LEDGER_NOT_OBSERVED');
      expect(decision.message).toBe('빈시간 맞나요? 장부를 확인한 뒤 다시 알려주세요.');
      expect(decision.opportunity).toBeNull();
    });

    it('포트가 ERROR를 반환하거나 throw하면 raw 에러를 은폐하고 ERROR/LEDGER_QUERY_ERROR를 반환한다', async () => {
      const throwingPort = vi.fn().mockRejectedValue(new Error('FATAL DATABASE CONNECTION EXPOSURE'));
      const decision = await generateSlotOpportunity({
        request: validRequest,
        readLedger: throwingPort,
        now: baseNow,
      });

      expect(decision.state).toBe('ERROR');
      expect(decision.availabilityTruth).toBe('UNKNOWN');
      expect(decision.reason).toBe('LEDGER_QUERY_ERROR');
      expect(decision.message).toBe('예약 장부를 불러오지 못했어요. 다시 확인해 주세요.');
      expect(decision.message).not.toContain('FATAL');
      expect(decision.executionAllowed).toBe(false);
      expect(decision.opportunity).toBeNull();
    });

    it('잘못된 request(빈 workspaceId, 잘못된 timezone 등)는 포트를 호출하지 않고 ERROR를 반환한다', async () => {
      const mockPort = vi.fn();
      const decision = await generateSlotOpportunity({
        request: { ...validRequest, timezone: 'Invalid/NonExistent_Zone' },
        readLedger: mockPort,
        now: baseNow,
      });

      expect(mockPort).not.toHaveBeenCalled();
      expect(decision.state).toBe('ERROR');
      expect(decision.reason).toBe('INVALID_INPUT');
    });
  });

  describe('2. Tenancy & Dataset Mode & Cross-Workspace Isolation', () => {
    it('snapshot의 workspaceId가 request와 불일치하면 BLOCKED/WORKSPACE_MISMATCH를 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: { ...validSuccessSnapshot, workspaceId: 'other-ws-99' },
        now: baseNow,
      });

      expect(decision.state).toBe('BLOCKED');
      expect(decision.reason).toBe('WORKSPACE_MISMATCH');
      expect(decision.message).toBe('이 시간은 빈자리로 제안할 수 없어요.');
      expect(decision.opportunity).toBeNull();
    });

    it('candidate의 workspaceId가 request와 불일치하면 BLOCKED/WORKSPACE_MISMATCH를 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: { ...validCandidate, workspaceId: 'leaked-ws-99' },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('BLOCKED');
      expect(decision.reason).toBe('WORKSPACE_MISMATCH');
      expect(decision.opportunity).toBeNull();
    });

    it('datasetMode가 ACTUAL이 아니면(TEST, SHOWCASE_DEMO) BLOCKED/NON_ACTUAL_DATASET을 반환한다', () => {
      for (const mode of ['TEST', 'SHOWCASE_DEMO'] as const) {
        const decision = evaluateSlotOpportunity({
          request: validRequest,
          snapshot: { ...validSuccessSnapshot, datasetMode: mode },
          now: baseNow,
        });

        expect(decision.state).toBe('BLOCKED');
        expect(decision.reason).toBe('NON_ACTUAL_DATASET');
        expect(decision.opportunity).toBeNull();
      }
    });
  });

  describe('3. Freshness & Coverage & Evidence Temporal Boundaries', () => {
    it('freshness가 CURRENT가 아니면 질문 상태를 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: { ...validSuccessSnapshot, freshness: 'STALE' },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('LEDGER_NOT_CURRENT');
      expect(decision.opportunity).toBeNull();
    });

    it('coverage가 COMPLETE가 아니면 질문 상태를 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: { ...validSuccessSnapshot, coverage: 'PARTIAL' },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('INCOMPLETE_COVERAGE');
      expect(decision.opportunity).toBeNull();
    });

    it('queryRange 또는 timezone이 request와 불일치하면 COVERAGE_MISMATCH 질문을 반환한다', () => {
      const decisionTz = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: { ...validSuccessSnapshot, timezone: 'America/New_York' },
        now: baseNow,
      });
      expect(decisionTz.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decisionTz.reason).toBe('COVERAGE_MISMATCH');

      const decisionRange = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          queryRange: {
            startsAt: '2026-10-21T15:00:00.000+09:00',
            endsAt: '2026-10-21T19:00:00.000+09:00',
          },
        },
        now: baseNow,
      });
      expect(decisionRange.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decisionRange.reason).toBe('COVERAGE_MISMATCH');
    });

    it('source.checkedAt이 미래 시각이면 CLOCK_SKEW 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          source: { ...validOwnerSource, checkedAt: '2026-10-21T01:05:00.000Z' }, // 5m in future
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('CLOCK_SKEW');
      expect(decision.opportunity).toBeNull();
    });

    it('OWNER_CONFIRMED source의 checkedAt이 15분을 초과했으면 STALE_EVIDENCE 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          source: {
            ...validOwnerSource,
            checkedAt: '2026-10-21T00:44:00.000Z', // 16m ago (> 15m)
            validUntil: '2026-10-21T02:00:00.000Z',
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('STALE_EVIDENCE');
      expect(decision.opportunity).toBeNull();
    });

    it('source.validUntil이 now 이하이면 STALE_EVIDENCE 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          source: { ...validOwnerSource, validUntil: '2026-10-21T01:00:00.000Z' }, // equal to now
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('STALE_EVIDENCE');
    });

    it('OWNER_CONFIRMED에 confirmedByRef가 누락되면 MISSING_EVIDENCE 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          source: { ...validOwnerSource, confirmedByRef: '' },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('MISSING_EVIDENCE');
    });

    it('EXTERNAL_READBACK에 providerRef가 누락되면 MISSING_EVIDENCE 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          source: {
            workspaceId: validWorkspace,
            kind: 'EXTERNAL_READBACK',
            sourceId: 'ext-01',
            evidenceId: 'ev-ext-01',
            checkedAt: '2026-10-21T00:59:00.000Z',
            validUntil: '2026-10-21T01:30:00.000Z',
            ledgerVersion: 'lv-ext-01',
            providerRef: '', // missing
          },
          ledgerVersion: 'lv-ext-01',
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('MISSING_EVIDENCE');
    });
  });

  describe('4. Candidate Validation & NO_CANDIDATE & Slot Invariants', () => {
    it('정상 SUCCESS COMPLETE에서 candidate: null이면 명시 범위 NO_CANDIDATE를 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: { ...validSuccessSnapshot, candidate: null },
        now: baseNow,
      });

      expect(decision.state).toBe('NO_CANDIDATE');
      expect(decision.availabilityTruth).toBe('NOT_AVAILABLE');
      expect(decision.reason).toBe('NO_CANDIDATE');
      expect(decision.message).toBe('확인한 범위에 제안할 빈시간이 없어요.');
      expect(decision.executionAllowed).toBe(false);
      expect(decision.opportunity).toBeNull();
    });

    it('후보 슬롯 status가 BOOKED 또는 WITHDRAWN이면 BLOCKED/SLOT_NOT_AVAILABLE을 반환한다', () => {
      for (const status of ['BOOKED', 'WITHDRAWN'] as const) {
        const decision = evaluateSlotOpportunity({
          request: validRequest,
          snapshot: {
            ...validSuccessSnapshot,
            candidate: { ...validCandidate, status },
          },
          now: baseNow,
        });

        expect(decision.state).toBe('BLOCKED');
        expect(decision.reason).toBe('SLOT_NOT_AVAILABLE');
        expect(decision.opportunity).toBeNull();
      }
    });

    it('슬롯 시작 시각이 now 이하이면 SLOT_EXPIRED 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            range: {
              startsAt: '2026-10-21T00:30:00.000Z', // in past relative to baseNow (01:00:00.000Z)
              endsAt: '2026-10-21T01:30:00.000Z',
            },
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('SLOT_EXPIRED');
    });

    it('슬롯 종료 시각이 시작 시각 이하이면 BLOCKED/INVALID_SLOT을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            range: {
              startsAt: '2026-10-21T15:00:00.000+09:00',
              endsAt: '2026-10-21T14:00:00.000+09:00', // end < start
            },
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('BLOCKED');
      expect(decision.reason).toBe('INVALID_SLOT');
    });

    it('슬롯이 request.queryRange 바깥에 위치하면 BLOCKED/INVALID_SLOT을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            range: {
              startsAt: '2026-10-21T19:00:00.000+09:00', // outside queryRange
              endsAt: '2026-10-21T20:00:00.000+09:00',
            },
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('BLOCKED');
      expect(decision.reason).toBe('INVALID_SLOT');
    });
  });

  describe('5. Resource & Service Fit and Capacity Invariants', () => {
    it('service durationMinutes가 슬롯 길이보다 길면 RESOURCE_OR_SERVICE_UNVERIFIED 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            service: {
              ...validCandidate.service,
              durationMinutes: 90, // slot is 60m
            },
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('RESOURCE_OR_SERVICE_UNVERIFIED');
    });

    it('availableCapacity가 requiredCapacity 미달이면 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            resource: {
              ...validCandidate.resource,
              capacity: 1,
              availableCapacity: 0, // 0 is an observed fact, not replaced with fallback
            },
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('RESOURCE_OR_SERVICE_UNVERIFIED');
    });

    it('priceKrw가 음수이거나 unsafe integer이면 질문을 반환한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            service: {
              ...validCandidate.service,
              priceKrw: -1000,
            },
          },
        },
        now: baseNow,
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('RESOURCE_OR_SERVICE_UNVERIFIED');
    });
  });

  describe('6. Verified Candidate Production & Deterministic ID', () => {
    it('완전한 검증 슬롯이 주어지면 VERIFIED_SLOT을 생성하고 executionAllowed: false를 유지한다', () => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: validSuccessSnapshot,
        now: baseNow,
      });

      expect(decision.state).toBe('VERIFIED_SLOT');
      expect(decision.availabilityTruth).toBe('VERIFIED');
      expect(decision.reason).toBe('VERIFIED_SLOT');
      expect(decision.message).toBe('장부에서 확인한 빈시간이에요. 실행 전에 다시 확인해 주세요.');
      expect(decision.executionAllowed).toBe(false);

      const opp = decision.opportunity;
      expect(opp).not.toBeNull();
      expect(opp!.workspaceId).toBe(validWorkspace);
      expect(opp!.slotId).toBe('slot-01');
      expect(opp!.slotVersion).toBe('sv-001');
      expect(opp!.ledgerVersion).toBe('lv-001');
      expect(opp!.confidence).toBe('VERIFIED');
      expect(opp!.executionAllowed).toBe(false);
      expect(opp!.observedAt).toBe(validOwnerSource.checkedAt);
      expect(opp!.evaluatedAt).toBe(baseNow);
      // expiresAt should be min(source.validUntil: 01:10, res: 03:00, srv: 03:00, slot: 05:00, owner checkedAt+15m: 01:10)
      expect(opp!.expiresAt).toBe('2026-10-21T01:10:00.000Z');
      expect(opp!.evidenceIds).toEqual(['ev-owner-ledger-01', 'ev-res-01', 'ev-srv-01']);

      // Price, customer, target must not be in opportunity
      expect((opp as any).priceKrw).toBeUndefined();
      expect((opp as any).customers).toBeUndefined();
      expect((opp as any).targetCustomerCount).toBeUndefined();
    });

    it('동일한 증거에 대해 now가 달라도 생성되는 Opportunity ID는 동일하다 (결정론적 ID)', () => {
      const decision1 = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: validSuccessSnapshot,
        now: '2026-10-21T01:00:00.000Z',
      });
      const decision2 = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: validSuccessSnapshot,
        now: '2026-10-21T01:02:00.000Z',
      });

      expect(decision1.opportunity!.id).toBe(decision2.opportunity!.id);
      expect(decision1.opportunity!.id).toMatch(/^[a-f0-9]{64}$/);
    });

    it('버전이나 슬롯 시간이 변경되면 Opportunity ID가 달라진다', () => {
      const decision1 = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: validSuccessSnapshot,
        now: baseNow,
      });
      const decision2 = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            slotVersion: 'sv-002',
          },
        },
        now: baseNow,
      });

      expect(decision1.opportunity!.id).not.toBe(decision2.opportunity!.id);
    });
  });

  describe('7. Invalidation Boundary', () => {
    let validOpp: SlotOpportunity;

    beforeEach(() => {
      const decision = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: validSuccessSnapshot,
        now: baseNow,
      });
      validOpp = decision.opportunity!;
    });

    it('정상 상태에서 재검증 시 VERIFIED_SLOT을 유지하되 executionAllowed: false를 유지한다', () => {
      const decision = invalidateSlotOpportunity({
        opportunity: validOpp,
        workspaceId: validWorkspace,
        ledgerVersion: 'lv-001',
        slotVersion: 'sv-001',
        now: '2026-10-21T01:05:00.000Z', // before expiresAt 01:10
      });

      expect(decision.state).toBe('VERIFIED_SLOT');
      expect(decision.executionAllowed).toBe(false);
      expect(decision.opportunity).not.toBeNull();
      expect(decision.opportunity!.id).toBe(validOpp.id);
      expect(decision.opportunity!.observedAt).toBe(validOpp.observedAt);
    });

    it('now >= expiresAt 이면 STALE_EVIDENCE 질문 상태를 반환하고 opportunity: null이다', () => {
      const decision = invalidateSlotOpportunity({
        opportunity: validOpp,
        workspaceId: validWorkspace,
        ledgerVersion: 'lv-001',
        slotVersion: 'sv-001',
        now: '2026-10-21T01:10:00.000Z', // exactly at expiresAt
      });

      expect(decision.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decision.reason).toBe('STALE_EVIDENCE');
      expect(decision.opportunity).toBeNull();
    });

    it('slotVersion 또는 ledgerVersion이 변경되었으면 VERSION_CHANGED 질문 상태를 반환한다', () => {
      const decisionSlot = invalidateSlotOpportunity({
        opportunity: validOpp,
        workspaceId: validWorkspace,
        ledgerVersion: 'lv-001',
        slotVersion: 'sv-002', // changed
        now: '2026-10-21T01:05:00.000Z',
      });
      expect(decisionSlot.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decisionSlot.reason).toBe('VERSION_CHANGED');
      expect(decisionSlot.opportunity).toBeNull();

      const decisionLedger = invalidateSlotOpportunity({
        opportunity: validOpp,
        workspaceId: validWorkspace,
        ledgerVersion: 'lv-002', // changed
        slotVersion: 'sv-001',
        now: '2026-10-21T01:05:00.000Z',
      });
      expect(decisionLedger.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decisionLedger.reason).toBe('VERSION_CHANGED');
    });

    it('workspaceId가 불일치하면 BLOCKED/WORKSPACE_MISMATCH를 반환한다', () => {
      const decision = invalidateSlotOpportunity({
        opportunity: validOpp,
        workspaceId: 'other-ws-attacker',
        ledgerVersion: 'lv-001',
        slotVersion: 'sv-001',
        now: '2026-10-21T01:05:00.000Z',
      });

      expect(decision.state).toBe('BLOCKED');
      expect(decision.reason).toBe('WORKSPACE_MISMATCH');
      expect(decision.opportunity).toBeNull();
    });
  });

  describe('8. Immutability and Pure Boundary', () => {
    it('deepFreeze된 입력 객체를 변형하지 않는다', () => {
      const frozenRequest = deepFreeze({ ...validRequest });
      const frozenSnapshot = deepFreeze({ ...validSuccessSnapshot });

      expect(() => {
        evaluateSlotOpportunity({
          request: frozenRequest as any,
          snapshot: frozenSnapshot as any,
          now: baseNow,
        });
      }).not.toThrow();
    });
  });

  describe('9. Sol Review R1~R6 Defenses', () => {
    it('R1: invalidate는 불완전한 객체나 unknown 필드를 스프레드하지 않고 거부한다', () => {
      const incompleteOpp: any = {
        workspaceId: validWorkspace,
        ledgerVersion: 'lv-001',
        slotVersion: 'sv-001',
        expiresAt: '2026-10-21T01:10:00.000Z',
        customers: ['fake-customer-01'],
      };

      const decision = invalidateSlotOpportunity({
        opportunity: incompleteOpp,
        workspaceId: validWorkspace,
        ledgerVersion: 'lv-001',
        slotVersion: 'sv-001',
        now: '2026-10-21T01:05:00.000Z',
      });

      expect(decision.state).toBe('ERROR');
      expect(decision.reason).toBe('INVALID_INPUT');
      expect(decision.opportunity).toBeNull();
    });

    it('R2: root null/undefined/primitive 입력 시 throw 없이 fail-closed ERROR를 반환한다', async () => {
      expect(evaluateSlotOpportunity(null as any).state).toBe('ERROR');
      expect(evaluateSlotOpportunity(undefined as any).state).toBe('ERROR');
      expect(evaluateSlotOpportunity('not-an-object' as any).state).toBe('ERROR');

      expect((await generateSlotOpportunity(null as any)).state).toBe('ERROR');
      expect((await generateSlotOpportunity(undefined as any)).state).toBe('ERROR');

      expect(invalidateSlotOpportunity(null as any).state).toBe('ERROR');
      expect(invalidateSlotOpportunity(123 as any).state).toBe('ERROR');
    });

    it('R3: 달력상 불가능한 2월 30일 등 invalid calendar date는 엄격히 거부한다', () => {
      const decision = evaluateSlotOpportunity({
        request: {
          ...validRequest,
          queryRange: {
            startsAt: '2026-02-30T10:00:00.000Z',
            endsAt: '2026-02-30T11:00:00.000Z',
          },
        },
        snapshot: validSuccessSnapshot,
        now: baseNow,
      });

      expect(decision.state).toBe('ERROR');
      expect(decision.reason).toBe('INVALID_INPUT');
    });

    it('R3: 동등한 instant의 표현 차이(+09:00 vs Z)에도 결정론적 ID가 동일하다', () => {
      const decision1 = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: validSuccessSnapshot,
        now: baseNow,
      });

      // Same instant in UTC Z representation: 14:00+09:00 is 05:00Z
      const decisionZ = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            range: {
              startsAt: '2026-10-21T05:00:00.000Z',
              endsAt: '2026-10-21T06:00:00.000Z',
            },
          },
        },
        now: baseNow,
      });

      expect(decision1.opportunity!.id).toBe(decisionZ.opportunity!.id);
    });

    it('R4: resource/service workspace 불일치 시 BLOCKED/WORKSPACE_MISMATCH (availabilityTruth: UNKNOWN) 반환', () => {
      const decisionResMismatch = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            resource: {
              ...validCandidate.resource,
              workspaceId: 'other-ws-99',
            },
          },
        },
        now: baseNow,
      });

      expect(decisionResMismatch.state).toBe('BLOCKED');
      expect(decisionResMismatch.reason).toBe('WORKSPACE_MISMATCH');
      expect(decisionResMismatch.availabilityTruth).toBe('UNKNOWN');
    });

    it('R4: resource.ledgerVersion 또는 candidate.catalogVersion 불일치 시 VERSION_CHANGED 반환', () => {
      const decisionVersionMismatch = evaluateSlotOpportunity({
        request: validRequest,
        snapshot: {
          ...validSuccessSnapshot,
          candidate: {
            ...validCandidate,
            resource: {
              ...validCandidate.resource,
              ledgerVersion: 'lv-old',
            },
          },
        },
        now: baseNow,
      });

      expect(decisionVersionMismatch.state).toBe('NEEDS_OWNER_CONFIRMATION');
      expect(decisionVersionMismatch.reason).toBe('VERSION_CHANGED');
      expect(decisionVersionMismatch.availabilityTruth).toBe('UNKNOWN');
    });

    it('R6: port가 request를 mutate하려 해도 원본과 평가 기준이 오염되지 않는다', async () => {
      const mutatingPort = async (req: any) => {
        try {
          req.workspaceId = 'hacked-ws';
        } catch {
          // Object.freeze might throw in strict mode, which is also safe
        }
        return {
          ...validSuccessSnapshot,
          workspaceId: 'hacked-ws',
        };
      };

      const decision = await generateSlotOpportunity({
        request: validRequest,
        readLedger: mutatingPort,
        now: baseNow,
      });

      // The original request was for validWorkspace, so snapshot from hacked-ws is rejected as WORKSPACE_MISMATCH!
      expect(decision.state).toBe('BLOCKED');
      expect(decision.reason).toBe('WORKSPACE_MISMATCH');
      expect(decision.workspaceId).toBe(validWorkspace);
    });
  });
});
