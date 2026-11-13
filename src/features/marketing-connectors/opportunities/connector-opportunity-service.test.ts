import { describe, it, expect } from 'vitest';
import type { ConnectorEvidence } from '../evidence';
import {
  generateConnectorOpportunities,
  computeOpportunityFingerprint,
  type GenerateOpportunitiesInput,
  type OpportunityGateway,
  type ExistingProposal,
} from './connector-opportunity-service';

describe('MC/P01 connector-opportunity-service (ANI-2180)', () => {
  const WORKSPACE_ID = 'ws-test-123';
  const NOW = '2026-11-11T09:00:00.000Z';

  function createCalendarEvidence(overrides: Partial<ConnectorEvidence & { metadata?: Record<string, unknown> }> = {}): ConnectorEvidence & { metadata?: Record<string, unknown> } {
    return {
      id: 'evi-cal-1',
      workspaceId: WORKSPACE_ID,
      connectorId: 'google_calendar',
      sourceId: 'event-spring-fest',
      revision: 'rev-1',
      consentGeneration: 1,
      observedAt: '2026-11-11T08:00:00.000Z',
      expiresAt: '2026-12-11T08:00:00.000Z',
      purpose: 'marketing',
      text: '[Google Calendar] 봄맞이 딸기 축제 (2026-11-15T10:00:00.000Z ~ 2026-11-15T18:00:00.000Z)',
      derivedFromGoogle: true,
      revokedAt: null,
      metadata: {
        calendarId: 'cal-main',
        eventId: 'event-spring-fest',
        summary: '봄맞이 딸기 축제',
        start: '2026-11-15T10:00:00.000Z',
        end: '2026-11-15T18:00:00.000Z',
      },
      ...overrides,
    };
  }

  function createSheetsEvidence(overrides: Partial<ConnectorEvidence & { metadata?: Record<string, unknown> }> = {}): ConnectorEvidence & { metadata?: Record<string, unknown> } {
    return {
      id: 'evi-sheet-1',
      workspaceId: WORKSPACE_ID,
      connectorId: 'google_sheets',
      sourceId: 'sheet-menu-pricing',
      revision: 'rev-2',
      consentGeneration: 1,
      observedAt: '2026-11-11T08:30:00.000Z',
      expiresAt: '2026-12-11T08:30:00.000Z',
      purpose: 'marketing',
      text: '[Google Sheets: sheet-menu-pricing]\n메뉴 | 이전가격 | 새가격\n딸기라떼 | 5500 | 6000',
      derivedFromGoogle: true,
      revokedAt: null,
      metadata: {
        spreadsheetId: 'sheet-menu-pricing',
        hasPriceConflict: true,
        conflictingPrices: [
          { item: '딸기라떼', oldPrice: 5500, newPrice: 6000 },
        ],
      },
      ...overrides,
    };
  }

  describe('TDD Iron Law - failing test first', () => {
    it('1. 캘린더 이벤트: 다가오는 행사(D-4) 감지 시 사전 홍보 기회를 생성한다', async () => {
      const calEvidence = createCalendarEvidence();
      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [calEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);

      expect(opportunities).toHaveLength(1);
      const opp = opportunities[0];
      expect(opp.workspaceId).toBe(WORKSPACE_ID);
      expect(opp.title).toContain('봄맞이 딸기 축제');
      expect(opp.title).toContain('사전 홍보');
      expect(opp.reasonWhyNow).toContain('D-4');
      expect(opp.suggestedAction).toBeDefined();
      expect(opp.evidenceIds).toEqual(['evi-cal-1']);
      expect(opp.status).toBe('pending');
      expect(opp.fingerprint).toBe(
        computeOpportunityFingerprint('cal-main', 'event-spring-fest', '2026-11-15')
      );
    });

    it('2. 캘린더 이벤트: 지난 행사(과거 시점)는 기회를 제안하지 않는다', async () => {
      const pastEvidence = createCalendarEvidence({
        id: 'evi-past',
        sourceId: 'past-event',
        text: '[Google Calendar] 지난 행사 (2026-11-09T10:00:00.000Z ~ 2026-11-09T18:00:00.000Z)',
        metadata: {
          calendarId: 'cal-main',
          eventId: 'past-event',
          summary: '지난 행사',
          start: '2026-11-09T10:00:00.000Z',
        },
      });

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [pastEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(0);
    });

    it('3. 캘린더 이벤트: 14일 초과(D-20) 먼 미래 일정은 기회를 제안하지 않는다', async () => {
      const farFutureEvidence = createCalendarEvidence({
        id: 'evi-far-future',
        sourceId: 'far-future-event',
        text: '[Google Calendar] 먼 미래 행사 (2026-12-01T10:00:00.000Z)',
        metadata: {
          calendarId: 'cal-main',
          eventId: 'far-future-event',
          summary: '먼 미래 행사',
          start: '2026-12-01T10:00:00.000Z',
        },
      });

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [farFutureEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(0);
    });

    it('4. 시트 가격표: hasPriceConflict 감지 시 메뉴판 업데이트 및 소셜 공지 기회를 생성한다', async () => {
      const sheetEvidence = createSheetsEvidence();
      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [sheetEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);

      expect(opportunities).toHaveLength(1);
      const opp = opportunities[0];
      expect(opp.workspaceId).toBe(WORKSPACE_ID);
      expect(opp.title).toContain('딸기라떼');
      expect(opp.title).toContain('가격 변경');
      expect(opp.suggestedAction).toContain('메뉴');
      expect(opp.evidenceIds).toEqual(['evi-sheet-1']);
      expect(opp.status).toBe('pending');
      expect(opp.fingerprint).toBe(
        computeOpportunityFingerprint('sheet-menu-pricing', '딸기라떼', '2026-11-11')
      );
    });

    it('5. 시트 가격표: hasPriceConflict가 false인 경우 기회를 생성하지 않는다', async () => {
      const noConflictEvidence = createSheetsEvidence({
        id: 'evi-no-conflict',
        metadata: {
          spreadsheetId: 'sheet-menu-pricing',
          hasPriceConflict: false,
          conflictingPrices: [],
        },
      });

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [noConflictEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(0);
    });

    it('6. 중복 억제: 최근 7일 이내 동일 fingerprint의 기존 제안이 있으면 스킵한다', async () => {
      const calEvidence = createCalendarEvidence();
      const targetFingerprint = computeOpportunityFingerprint(
        'cal-main',
        'event-spring-fest',
        '2026-11-15'
      );

      const existingProposals: ExistingProposal[] = [
        {
          id: 'prop-old-1',
          fingerprint: targetFingerprint,
          createdAt: '2026-11-08T10:00:00.000Z', // 3일 전 (7일 이내)
        },
      ];

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [calEvidence],
        existingProposals,
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(0);
    });

    it('7. 쿨다운 해제: 동일 fingerprint라도 7일이 경과한 기존 제안이면 다시 제안한다', async () => {
      const calEvidence = createCalendarEvidence();
      const targetFingerprint = computeOpportunityFingerprint(
        'cal-main',
        'event-spring-fest',
        '2026-11-15'
      );

      const existingProposals: ExistingProposal[] = [
        {
          id: 'prop-old-expired',
          fingerprint: targetFingerprint,
          createdAt: '2026-11-01T10:00:00.000Z', // 10일 전 (7일 초과)
        },
      ];

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [calEvidence],
        existingProposals,
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].fingerprint).toBe(targetFingerprint);
    });

    it('8. 거절 선호도 반영: rejectedFingerprints에 등록된 기회는 즉시 억제한다', async () => {
      const sheetEvidence = createSheetsEvidence();
      const sheetFingerprint = computeOpportunityFingerprint(
        'sheet-menu-pricing',
        '딸기라떼',
        '2026-11-11'
      );

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [sheetEvidence],
        rejectedFingerprints: [sheetFingerprint],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(0);
    });

    it('9. Gateway 연동: gateway를 통해 기존 제안 및 거절 이력을 주입받을 수 있다', async () => {
      const calEvidence = createCalendarEvidence();
      const targetFingerprint = computeOpportunityFingerprint(
        'cal-main',
        'event-spring-fest',
        '2026-11-15'
      );

      const mockGateway: OpportunityGateway = {
        getExistingProposals: async (wsId) => {
          expect(wsId).toBe(WORKSPACE_ID);
          return [
            {
              id: 'prop-gw-1',
              fingerprint: targetFingerprint,
              createdAt: '2026-11-09T00:00:00.000Z', // 2일 전
            },
          ];
        },
        getRejectedFingerprints: async () => [],
      };

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [calEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input, mockGateway);
      expect(opportunities).toHaveLength(0);
    });

    it('10. Fail-closed: 유효하지 않은 입력은 빈 배열을 반환한다', async () => {
      expect(await generateConnectorOpportunities(null as unknown as GenerateOpportunitiesInput)).toEqual([]);
      expect(await generateConnectorOpportunities({ workspaceId: '', evidences: [], now: NOW })).toEqual([]);
      expect(await generateConnectorOpportunities({ workspaceId: WORKSPACE_ID, evidences: [], now: 'invalid-date' })).toEqual([]);
    });

    it('11. 철회된 근거(revokedAt !== null)는 기회 생성에서 제외된다', async () => {
      const revokedCalEvidence = createCalendarEvidence({
        id: 'evi-revoked',
        revokedAt: '2026-11-11T08:50:00.000Z',
      });

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [revokedCalEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(0);
    });

    it('12. D-1 및 D-14 경계값: D-1(내일), D-14(14일 후)는 생성되고 D-0(당일), D-15(15일 후)는 제외된다', async () => {
      // D-1 (내일 2026-11-12)
      const d1Evidence = createCalendarEvidence({
        id: 'evi-d1',
        sourceId: 'event-d1',
        metadata: {
          calendarId: 'cal-main',
          eventId: 'event-d1',
          summary: '내일 특강',
          start: '2026-11-12T14:00:00.000Z',
        },
      });

      // D-14 (14일 후 2026-11-25)
      const d14Evidence = createCalendarEvidence({
        id: 'evi-d14',
        sourceId: 'event-d14',
        metadata: {
          calendarId: 'cal-main',
          eventId: 'event-d14',
          summary: '2주 뒤 페스티벌',
          start: '2026-11-25T10:00:00.000Z',
        },
      });

      // D-0 (당일 몇 시간 뒤 2026-11-11T18:00:00.000Z)
      const d0Evidence = createCalendarEvidence({
        id: 'evi-d0',
        sourceId: 'event-d0',
        metadata: {
          calendarId: 'cal-main',
          eventId: 'event-d0',
          summary: '오늘 저녁 행사',
          start: '2026-11-11T18:00:00.000Z',
        },
      });

      // D-15 (15일 후 2026-11-26)
      const d15Evidence = createCalendarEvidence({
        id: 'evi-d15',
        sourceId: 'event-d15',
        metadata: {
          calendarId: 'cal-main',
          eventId: 'event-d15',
          summary: '15일 뒤 행사',
          start: '2026-11-26T10:00:00.000Z',
        },
      });

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [d1Evidence, d14Evidence, d0Evidence, d15Evidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(2);
      expect(opportunities.map((o) => o.title)).toEqual([
        expect.stringContaining('내일 특강'),
        expect.stringContaining('2주 뒤 페스티벌'),
      ]);
    });

    it('13. 동일 배치 내 중복 이벤트는 1회만 기회로 생성된다', async () => {
      const cal1 = createCalendarEvidence({ id: 'evi-dup-1' });
      const cal2 = createCalendarEvidence({ id: 'evi-dup-2' }); // same eventId and date

      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [cal1, cal2],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input);
      expect(opportunities).toHaveLength(1);
    });

    it('14. gateway.saveOpportunities가 제공되면 생성된 기회를 자동 저장한다', async () => {
      let savedList: unknown[] = [];
      const mockGateway: OpportunityGateway = {
        saveOpportunities: async (opps) => {
          savedList = [...opps];
        },
      };

      const calEvidence = createCalendarEvidence();
      const input: GenerateOpportunitiesInput = {
        workspaceId: WORKSPACE_ID,
        evidences: [calEvidence],
        now: NOW,
      };

      const opportunities = await generateConnectorOpportunities(input, mockGateway);
      expect(opportunities).toHaveLength(1);
      expect(savedList).toHaveLength(1);
      expect(savedList[0]).toEqual(opportunities[0]);
    });
  });
});
