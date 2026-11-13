import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveImportedCalendarEvents,
  createSupabaseCalendarImportGateway,
  type CalendarImportGateway,
  type CalendarImportEvidenceRow,
  type ImportedCalendarEventInput,
} from './calendar-import-service';
import type {
  ConsentLedgerGateway,
  MarketingConsentRecord,
} from '../consent/consent-ledger';

class MockConsentLedgerGateway implements ConsentLedgerGateway {
  private records: MarketingConsentRecord[] = [];

  async getLatestConsent(
    workspaceId: string,
    connectorId: string
  ): Promise<MarketingConsentRecord | null> {
    const matching = this.records
      .filter((r) => r.workspaceId === workspaceId && r.connectorId === connectorId)
      .sort((a, b) => b.consentGeneration - a.consentGeneration);
    return matching[0] ?? null;
  }

  async saveConsentRecord(record: MarketingConsentRecord): Promise<void> {
    this.records.push(record);
  }

  async getConsentHistory(
    workspaceId: string,
    connectorId: string
  ): Promise<readonly MarketingConsentRecord[]> {
    return this.records.filter(
      (r) => r.workspaceId === workspaceId && r.connectorId === connectorId
    );
  }
}

class MockCalendarImportGateway implements CalendarImportGateway {
  readonly consentLedger: MockConsentLedgerGateway;
  readonly savedEvidence: CalendarImportEvidenceRow[] = [];
  lastConnectionUpdate: any = null;

  constructor() {
    this.consentLedger = new MockConsentLedgerGateway();
  }

  async saveEvidence(rows: readonly CalendarImportEvidenceRow[]): Promise<void> {
    this.savedEvidence.push(...rows);
  }

  async updateConnection(params: any): Promise<void> {
    this.lastConnectionUpdate = params;
  }
}

describe('calendar-import-service (ANI-2171 / A02)', () => {
  let gateway: MockCalendarImportGateway;
  const validWorkspaceId = '00000000-0000-4000-8000-000000000001';
  const validActorUserId = 'user-owner-123';
  const fixedNow = '2026-11-11T10:00:00.000Z';

  const sampleEvents: ImportedCalendarEventInput[] = [
    {
      id: 'event-1',
      title: '신메뉴 출시 프로모션 회의',
      startsAt: '2026-11-15T14:00:00.000Z',
      endsAt: '2026-11-15T15:30:00.000Z',
      timeZone: 'Asia/Seoul',
    },
    {
      id: 'event-2',
      title: '인스타그램 릴스 촬영',
      startsAt: '2026-11-16T10:00:00.000Z',
      endsAt: '2026-11-16T12:00:00.000Z',
      timeZone: 'Asia/Seoul',
    },
  ];

  beforeEach(() => {
    gateway = new MockCalendarImportGateway();
  });

  describe('입력 유효성 검증 (엄격한 서버 검증)', () => {
    it('유효하지 않은 workspaceId이면 INVALID_WORKSPACE_ID 에러를 던진다', async () => {
      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: 'invalid-uuid',
            events: sampleEvents,
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'INVALID_WORKSPACE_ID',
        })
      );
    });

    it('actorUserId가 없거나 빈 문자열이면 INVALID_ACTOR_USER_ID 에러를 던진다', async () => {
      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: sampleEvents,
            actorUserId: '  ',
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'INVALID_ACTOR_USER_ID',
        })
      );
    });

    it('events가 빈 배열이거나 비배열이면 EMPTY_EVENTS 에러를 던진다', async () => {
      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: [],
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'EMPTY_EVENTS',
        })
      );

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: null as any,
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'EMPTY_EVENTS',
        })
      );
    });

    it('events가 100개를 초과하면 LIMIT_EXCEEDED 에러를 던진다', async () => {
      const tooManyEvents = Array.from({ length: 101 }, (_, i) => ({
        id: `evt-${i}`,
        title: `Event ${i}`,
        startsAt: '2026-11-15T14:00:00.000Z',
        endsAt: '2026-11-15T15:00:00.000Z',
      }));

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: tooManyEvents,
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'LIMIT_EXCEEDED',
        })
      );
    });

    it('이벤트 제목이 200자를 초과하면 TITLE_TOO_LONG 에러를 던진다', async () => {
      const longTitleEvent: ImportedCalendarEventInput = {
        title: 'A'.repeat(201),
        startsAt: '2026-11-15T14:00:00.000Z',
        endsAt: '2026-11-15T15:00:00.000Z',
      };

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: [longTitleEvent],
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'TITLE_TOO_LONG',
        })
      );
    });

    it('이벤트 제목이 빈 문자열이거나 공백이면 TITLE_EMPTY 에러를 던진다', async () => {
      const emptyTitleEvent: ImportedCalendarEventInput = {
        title: '   ',
        startsAt: '2026-11-15T14:00:00.000Z',
        endsAt: '2026-11-15T15:00:00.000Z',
      };

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: [emptyTitleEvent],
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'TITLE_EMPTY',
        })
      );
    });

    it('startsAt 또는 endsAt이 유효하지 않은 ISO 문자열이면 INVALID_ISO_DATE 에러를 던진다', async () => {
      const invalidDateEvent: ImportedCalendarEventInput = {
        title: '정기 점검',
        startsAt: '2026-11-15 14:00:00', // Missing T or ISO format
        endsAt: '2026-11-15T15:00:00.000Z',
      };

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: [invalidDateEvent],
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'INVALID_ISO_DATE',
        })
      );
    });

    it('시작 시간이 종료 시간보다 미래이면 (start > end) START_AFTER_END 에러를 던진다 (시간 역전 검증)', async () => {
      const reversedEvent: ImportedCalendarEventInput = {
        title: '시간 역전 이벤트',
        startsAt: '2026-11-15T16:00:00.000Z',
        endsAt: '2026-11-15T14:00:00.000Z', // startsAt > endsAt
      };

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: [reversedEvent],
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'START_AFTER_END',
        })
      );
    });

    it('시작 시간과 종료 시간이 같은 (start === end) 순간 이벤트는 허용된다', async () => {
      const instantEvent: ImportedCalendarEventInput = {
        title: '타임세일 오픈 시작 알림',
        startsAt: '2026-11-15T14:00:00.000Z',
        endsAt: '2026-11-15T14:00:00.000Z',
      };

      const result = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: [instantEvent],
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      expect(result.ok).toBe(true);
      expect(result.importedCount).toBe(1);
    });

    it('지원되지 않거나 유효하지 않은 timeZone이면 INVALID_TIMEZONE 에러를 던진다', async () => {
      const badTzEvent: ImportedCalendarEventInput = {
        title: '이벤트',
        startsAt: '2026-11-15T14:00:00.000Z',
        endsAt: '2026-11-15T15:00:00.000Z',
        timeZone: 'Mars/Curiosity',
      };

      await expect(
        saveImportedCalendarEvents(
          {
            workspaceId: validWorkspaceId,
            events: [badTzEvent],
            actorUserId: validActorUserId,
            now: fixedNow,
          },
          gateway
        )
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'INVALID_TIMEZONE',
        })
      );
    });
  });

  describe('sourceId 생성 및 F04 동의 원장 연동', () => {
    it('SHA-256 기반의 고유 sourceId (apple_cal_${hash})가 생성된다', async () => {
      const result = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      expect(result.sourceId).toMatch(/^apple_cal_[0-9a-f]{16,64}$/);
    });

    it('동일한 이벤트 입력에 대해 결정론적(deterministic) sourceId가 생성된다', async () => {
      const result1 = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      const result2 = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      expect(result1.sourceId).toBe(result2.sourceId);
    });

    it('F04 recordConsentGrant가 호출되어 connectorId=apple_calendar, purpose=marketing, allowedSourceIds=[sourceId]로 기록된다', async () => {
      const result = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      const latestConsent = await gateway.consentLedger.getLatestConsent(
        validWorkspaceId,
        'apple_calendar'
      );

      expect(latestConsent).not.toBeNull();
      expect(latestConsent?.connectorId).toBe('apple_calendar');
      expect(latestConsent?.purpose).toBe('marketing');
      expect(latestConsent?.aiProcessingApproved).toBe(true);
      expect(latestConsent?.status).toBe('active');
      expect(latestConsent?.allowedSourceIds).toEqual([result.sourceId]);
      expect(latestConsent?.consentGeneration).toBe(1);
    });

    it('신규 업로드 시 세대(consentGeneration)가 단조 증가하고 이전 import 배치는 제외된다', async () => {
      // 1회차 업로드
      const firstBatch = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: [sampleEvents[0]],
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );
      expect(firstBatch.consentGeneration).toBe(1);

      // 2회차 업로드 (다른 이벤트)
      const secondBatch = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: [sampleEvents[1]],
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );
      expect(secondBatch.consentGeneration).toBe(2);

      const latestConsent = await gateway.consentLedger.getLatestConsent(
        validWorkspaceId,
        'apple_calendar'
      );
      expect(latestConsent?.consentGeneration).toBe(2);
      // 2회차의 allowedSourceIds에는 2회차 sourceId만 존재하여 1회차 배치는 자동 비활성화됨
      expect(latestConsent?.allowedSourceIds).toEqual([secondBatch.sourceId]);
      expect(latestConsent?.allowedSourceIds).not.toContain(firstBatch.sourceId);
    });
  });

  describe('marketing_connector_evidence 원장 적재', () => {
    it('각 이벤트별로 marketing_connector_evidence 레코드가 올바르게 생성 및 적재된다', async () => {
      const result = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      expect(gateway.savedEvidence).toHaveLength(2);

      const [ev1, ev2] = gateway.savedEvidence;
      expect(ev1.workspaceId).toBe(validWorkspaceId);
      expect(ev1.connectorId).toBe('apple_calendar');
      expect(ev1.sourceId).toBe(result.sourceId);
      expect(ev1.consentGeneration).toBe(result.consentGeneration);
      expect(ev1.purpose).toBe('marketing');
      expect(ev1.observedAt).toBe(fixedNow);
      expect(ev1.derivedFromGoogle).toBe(false);
      expect(ev1.revokedAt).toBeNull();
      expect(ev1.text).toContain('신메뉴 출시 프로모션 회의');
      expect(ev1.metadata).toMatchObject({
        title: '신메뉴 출시 프로모션 회의',
        startsAt: '2026-11-15T14:00:00.000Z',
        endsAt: '2026-11-15T15:30:00.000Z',
      });

      expect(ev2.text).toContain('인스타그램 릴스 촬영');
    });

    it('보존 기한(expiresAt)은 now 기준 최대 30일 이내로 설정된다', async () => {
      const result = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        gateway
      );

      const expectedExpiresEpoch = Date.parse(fixedNow) + 30 * 24 * 60 * 60 * 1000;
      const expectedExpiresIso = new Date(expectedExpiresEpoch).toISOString();

      expect(result.validUntil).toBe(expectedExpiresIso);
      expect(gateway.savedEvidence[0].expiresAt).toBe(expectedExpiresIso);
    });
  });

  describe('createSupabaseCalendarImportGateway', () => {
    it('Supabase 클라이언트를 래핑하여 consent와 evidence를 올바르게 저장하고 조회한다', async () => {
      const connectionsTable: any[] = [];
      const evidenceTable: any[] = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'marketing_connector_connections') {
            return {
              select: () => ({
                eq: (_col1: string, val1: string) => ({
                  eq: (_col2: string, val2: string) => ({
                    maybeSingle: async () => {
                      const found = connectionsTable.find(
                        (r) => r.workspace_id === val1 && r.connector_id === val2
                      );
                      return { data: found ?? null, error: null };
                    },
                  }),
                }),
              }),
              upsert: async (row: any) => {
                const idx = connectionsTable.findIndex(
                  (r) =>
                    r.workspace_id === row.workspace_id &&
                    r.connector_id === row.connector_id
                );
                if (idx >= 0) {
                  connectionsTable[idx] = { ...connectionsTable[idx], ...row };
                } else {
                  connectionsTable.push({ ...row });
                }
                return { error: null };
              },
            };
          }
          if (table === 'marketing_connector_evidence') {
            return {
              insert: async (rows: any[]) => {
                evidenceTable.push(...rows);
                return { error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      };

      const supabaseGateway = createSupabaseCalendarImportGateway(mockSupabase as any);

      const result = await saveImportedCalendarEvents(
        {
          workspaceId: validWorkspaceId,
          events: sampleEvents,
          actorUserId: validActorUserId,
          now: fixedNow,
        },
        supabaseGateway
      );

      expect(result.ok).toBe(true);
      expect(connectionsTable).toHaveLength(1);
      expect(connectionsTable[0].workspace_id).toBe(validWorkspaceId);
      expect(connectionsTable[0].connector_id).toBe('apple_calendar');
      expect(connectionsTable[0].consent_generation).toBe(1);
      expect(connectionsTable[0].status).toBe('connected');

      expect(evidenceTable).toHaveLength(2);
      expect(evidenceTable[0].workspace_id).toBe(validWorkspaceId);
      expect(evidenceTable[0].connector_id).toBe('apple_calendar');
      expect(evidenceTable[0].source_id).toBe(result.sourceId);

      const loadedConsent = await supabaseGateway.consentLedger.getLatestConsent(
        validWorkspaceId,
        'apple_calendar'
      );
      expect(loadedConsent?.consentGeneration).toBe(1);
      expect(loadedConsent?.allowedSourceIds).toEqual([result.sourceId]);
    });
  });
});
