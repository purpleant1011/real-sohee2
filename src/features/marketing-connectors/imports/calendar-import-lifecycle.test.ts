import { describe, it, expect, beforeEach } from 'vitest';
import {
  runAppleCalendarLifecycleScenario,
  createInMemoryLifecycleGateway,
  verifyCalendarEdgeCases,
  type AppleCalendarLifecycleScenarioInput,
  type AppleCalendarLifecycleGateway,
} from './calendar-import-lifecycle';
import type { CalendarParseWindow } from './ics-parser';

describe('calendar-import-lifecycle E2E (MC/A03 - ANI-2172)', () => {
  let gateway: AppleCalendarLifecycleGateway;
  const validWorkspaceId = '00000000-0000-4000-8000-000000000001';
  const actorUserId = 'owner-user-777';

  beforeEach(() => {
    gateway = createInMemoryLifecycleGateway();
  });

  const parseWindow: CalendarParseWindow = {
    startInstant: '2026-11-01T00:00:00.000Z',
    endInstant: '2026-11-30T23:59:59.999Z',
    startDate: '2026-11-01',
    endDateExclusive: '2026-12-01',
  };

  const sampleIcs1 = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//macOS 15.1//EN',
    'BEGIN:VEVENT',
    'UID:apple-evt-1@sohee.ai',
    'SUMMARY:11월 첫째 주 마케팅 기획 회의',
    'DTSTART:20261105T100000Z',
    'DTEND:20261105T110000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:apple-evt-2@sohee.ai',
    'SUMMARY:신제품 인스타그램 라이브 방송',
    'DTSTART:20261110T140000Z',
    'DTEND:20261110T160000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:apple-evt-3@sohee.ai',
    'SUMMARY:블랙프라이데이 사전 할인 이벤트',
    'DTSTART:20261120T090000Z',
    'DTEND:20261120T180000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  // 2차 파일: evt-2 삭제, evt-1 시간 변경, 신규 evt-4 추가
  const sampleIcs2 = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//macOS 15.1//EN',
    'BEGIN:VEVENT',
    'UID:apple-evt-1@sohee.ai',
    'SUMMARY:11월 첫째 주 마케팅 기획 회의 (수정)',
    'DTSTART:20261105T130000Z',
    'DTEND:20261105T143000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:apple-evt-4@sohee.ai',
    'SUMMARY:인플루언서 섭외 및 콘텐츠 리뷰',
    'DTSTART:20261115T150000Z',
    'DTEND:20261115T163000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('1단계부터 4단계까지 전체 라이프사이클(임포트->활성근거조회->파일교체->연동해제삭제)을 성공적으로 수행한다', async () => {
    const input: AppleCalendarLifecycleScenarioInput = {
      workspaceId: validWorkspaceId,
      actorUserId,
      initialIcs: sampleIcs1,
      initialParseWindow: parseWindow,
      initialNow: '2026-11-01T10:00:00.000Z',

      replacementIcs: sampleIcs2,
      replacementParseWindow: parseWindow,
      replacementNow: '2026-11-02T10:00:00.000Z',

      deletionJobId: 'job-del-001',
      deletionNow: '2026-11-03T10:00:00.000Z',
    };

    const result = await runAppleCalendarLifecycleScenario(input, gateway);

    // 1단계: 1차 ICS 파일 임포트 -> K01 원장에 3개 일정 적재 확인
    expect(result.step1InitialImport.importedCount).toBe(3);
    expect(result.step1InitialImport.consentGeneration).toBe(1);
    expect(result.step1InitialImport.evidenceIds).toHaveLength(3);

    // 2단계: K01 listActiveEvidence로 활성 근거 정상 조회 확인 (purpose: 'marketing')
    expect(result.step2ActiveEvidence.count).toBe(3);
    expect(result.step2ActiveEvidence.records).toHaveLength(3);
    for (const record of result.step2ActiveEvidence.records) {
      expect(record.purpose).toBe('marketing');
      expect(record.revokedAt).toBeNull();
      expect(record.consentGeneration).toBe(1);
      expect(record.connectorId).toBe('apple_calendar');
    }

    // 3단계: 2차 ICS 파일(LWW 교체) 임포트 -> 세대 증가 및 이전 배치 비활성화, 새 일정 반영 확인
    expect(result.step3ReplacementImport.consentGeneration).toBe(2);
    expect(result.step3ReplacementImport.importedCount).toBe(2);
    expect(result.step3ReplacementImport.previousBatchActiveCount).toBe(0);
    expect(result.step3ReplacementImport.newBatchActiveCount).toBe(2);

    // 4단계: F06 executeConnectorDeletion 호출 -> 원장 revoked_at 갱신 및 listActiveEvidence 조회 시 0건 반환
    expect(result.step4Deletion.deletionResult.ok).toBe(true);
    expect(result.step4Deletion.deletionResult.evidenceRevoked).toBe(true);
    expect(result.step4Deletion.deletionResult.consentRevoked).toBe(true);
    expect(result.step4Deletion.activeEvidenceCountAfterDeletion).toBe(0);
    expect(result.step4Deletion.consentStatusAfterDeletion).toBe('revoked');
  });

  it('사전 파싱된 이벤트 객체를 직접 전달해도 전체 라이프사이클이 동일하게 동작한다', async () => {
    const input: AppleCalendarLifecycleScenarioInput = {
      workspaceId: validWorkspaceId,
      actorUserId,
      initialEvents: [
        {
          id: 'manual-evt-1',
          title: '오프라인 팝업스토어 미팅',
          startsAt: '2026-11-08T09:00:00.000Z',
          endsAt: '2026-11-08T10:00:00.000Z',
          timeZone: 'Asia/Seoul',
        },
      ],
      initialNow: '2026-11-01T09:00:00.000Z',
      replacementEvents: [
        {
          id: 'manual-evt-2',
          title: '겨울 신제품 패키징 완료',
          startsAt: '2026-11-12T14:00:00.000Z',
          endsAt: '2026-11-12T15:00:00.000Z',
          timeZone: 'Asia/Seoul',
        },
      ],
      replacementNow: '2026-11-02T09:00:00.000Z',
      deletionNow: '2026-11-03T09:00:00.000Z',
    };

    const result = await runAppleCalendarLifecycleScenario(input, gateway);

    expect(result.step1InitialImport.importedCount).toBe(1);
    expect(result.step2ActiveEvidence.count).toBe(1);
    expect(result.step3ReplacementImport.consentGeneration).toBe(2);
    expect(result.step3ReplacementImport.newBatchActiveCount).toBe(1);
    expect(result.step4Deletion.activeEvidenceCountAfterDeletion).toBe(0);
  });

  describe('5단계: 특수 일정 엣지케이스(윤일, 월말 31일, 시간대 변환, RRULE 바운디드 종료성)', () => {
    it('윤일(2월 29일) 일정이 있는 윤년 캘린더를 안전하게 파싱하고 원장에 적재한다', async () => {
      const leapWindow: CalendarParseWindow = {
        startInstant: '2028-02-15T00:00:00.000Z',
        endInstant: '2028-03-05T23:59:59.999Z',
        startDate: '2028-02-15',
        endDateExclusive: '2028-03-06',
      };

      const leapIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Apple Inc.//macOS 15.1//EN',
        'BEGIN:VEVENT',
        'UID:leap-day-event@sohee.ai',
        'SUMMARY:4년에 한 번 있는 윤일 마케팅 특별 세일',
        'DTSTART:20280229T090000Z',
        'DTEND:20280229T180000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const verification = await verifyCalendarEdgeCases(
        {
          workspaceId: validWorkspaceId,
          actorUserId,
          icsText: leapIcs,
          window: leapWindow,
          now: '2028-02-01T00:00:00.000Z',
        },
        gateway
      );

      expect(verification.leapDayHandled).toBe(true);
      expect(verification.importedCount).toBe(1);
      expect(verification.activeEvidenceRecords[0].text).toContain('윤일 마케팅 특별 세일');
    });

    it('월말 31일 경계 일정(All-day 및 Timed)이 윈도우에서 잘림 없이 안전하게 적재된다', async () => {
      const monthEndWindow: CalendarParseWindow = {
        startInstant: '2026-10-25T00:00:00.000Z',
        endInstant: '2026-11-05T23:59:59.999Z',
        startDate: '2026-10-25',
        endDateExclusive: '2026-11-06',
      };

      const monthEndIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Apple Inc.//macOS 15.1//EN',
        'BEGIN:VEVENT',
        'UID:monthend-all-day@sohee.ai',
        'SUMMARY:10월 31일 할로윈 전일 프로모션',
        'DTSTART;VALUE=DATE:20261031',
        'DTEND;VALUE=DATE:20261101',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:monthend-timed@sohee.ai',
        'SUMMARY:10월 31일 심야 마감 타임세일',
        'DTSTART:20261031T230000Z',
        'DTEND:20261031T235959Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const verification = await verifyCalendarEdgeCases(
        {
          workspaceId: validWorkspaceId,
          actorUserId,
          icsText: monthEndIcs,
          window: monthEndWindow,
          now: '2026-10-20T00:00:00.000Z',
        },
        gateway
      );

      expect(verification.monthEndHandled).toBe(true);
      expect(verification.importedCount).toBe(2);
    });

    it('지역 시간대(Asia/Seoul, America/New_York)가 UTC 표준시로 안전하게 변환된다', async () => {
      const tzWindow: CalendarParseWindow = {
        startInstant: '2026-11-01T00:00:00.000Z',
        endInstant: '2026-11-20T23:59:59.999Z',
        startDate: '2026-11-01',
        endDateExclusive: '2026-11-21',
      };

      const tzIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Apple Inc.//macOS 15.1//EN',
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Seoul',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0900',
        'TZOFFSETTO:+0900',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:seoul-tz-evt@sohee.ai',
        'SUMMARY:서울 KST 오전 10시 마케팅 밋업',
        'DTSTART;TZID=Asia/Seoul:20261110T100000',
        'DTEND;TZID=Asia/Seoul:20261110T110000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const verification = await verifyCalendarEdgeCases(
        {
          workspaceId: validWorkspaceId,
          actorUserId,
          icsText: tzIcs,
          window: tzWindow,
          now: '2026-11-01T00:00:00.000Z',
        },
        gateway
      );

      expect(verification.timeZoneConverted).toBe(true);
      expect(verification.importedCount).toBe(1);
      // KST 10:00:00 -> UTC 01:00:00Z
      const record = verification.activeEvidenceRecords[0];
      expect(record.metadata.startsAt).toBe('2026-11-10T01:00:00.000Z');
      expect(record.metadata.endsAt).toBe('2026-11-10T02:00:00.000Z');
    });

    it('RRULE 바운디드 종료성(COUNT 및 UNTIL)이 윈도우 내에서 상한을 준수하며 안전하게 완료된다', async () => {
      const rruleWindow: CalendarParseWindow = {
        startInstant: '2026-11-01T00:00:00.000Z',
        endInstant: '2026-11-15T23:59:59.999Z',
        startDate: '2026-11-01',
        endDateExclusive: '2026-11-16',
      };

      const rruleIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Apple Inc.//macOS 15.1//EN',
        'BEGIN:VEVENT',
        'UID:daily-bounded-rrule@sohee.ai',
        'SUMMARY:매일 5일간 진행되는 게릴라 쿠폰 배포',
        'DTSTART:20261102T090000Z',
        'DTEND:20261102T100000Z',
        'RRULE:FREQ=DAILY;COUNT=5',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const verification = await verifyCalendarEdgeCases(
        {
          workspaceId: validWorkspaceId,
          actorUserId,
          icsText: rruleIcs,
          window: rruleWindow,
          now: '2026-11-01T00:00:00.000Z',
        },
        gateway
      );

      expect(verification.rruleBoundedHandled).toBe(true);
      expect(verification.importedCount).toBe(5);
      expect(verification.activeEvidenceRecords).toHaveLength(5);
    });
  });

  describe('유효성 및 에러 핸들링', () => {
    it('workspaceId가 올바르지 않으면 ValidationError를 발생시킨다', async () => {
      await expect(
        runAppleCalendarLifecycleScenario(
          {
            workspaceId: 'invalid-id',
            actorUserId,
            initialEvents: [
              {
                title: '테스트',
                startsAt: '2026-11-10T09:00:00.000Z',
                endsAt: '2026-11-10T10:00:00.000Z',
              },
            ],
          },
          gateway
        )
      ).rejects.toThrow();
    });

    it('이벤트나 ICS가 제공되지 않으면 에러를 발생시킨다', async () => {
      await expect(
        runAppleCalendarLifecycleScenario(
          {
            workspaceId: validWorkspaceId,
            actorUserId,
          },
          gateway
        )
      ).rejects.toThrow();
    });
  });
});
