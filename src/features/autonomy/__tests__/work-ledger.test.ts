import { describe, it, expect } from 'vitest';
import { BackgroundWorkLedger } from '../work-ledger';

describe('ANI-903: Background Work Ledger', () => {
  it('records canonical ledger entries with complete provenance', () => {
    const ledger = new BackgroundWorkLedger();

    const entry = ledger.record({
      workspaceId: 'ws-gangnam',
      triggerId: 'trig-booking-gap-01',
      triggerType: 'BOOKING_GAP',
      goalId: 'goal-fill-weekend',
      runId: 'run-auto-100',
      actionId: 'act-post-story',
      actionType: 'PUBLISH_CONTENT',
      charterId: 'charter-v09',
      charterVersion: '1.2.0',
      summary: '주말 오후 빈 예약 슬롯 긴급 타임세일 인스타그램 스토리 발행 완료',
      verificationState: 'EXTERNAL_VERIFIED',
      evidenceId: 'ev-card-998',
      outcomeId: 'out-conv-4',
      learningCandidateId: 'lrn-hook-pattern-02',
      creditsConsumed: 200,
    });

    expect(entry.id).toBeDefined();
    expect(entry.occurredAt).toBeDefined();
    expect(entry.summary).toContain('인스타그램 스토리 발행 완료');

    const retrieved = ledger.getEntry(entry.id);
    expect(retrieved).toEqual(entry);
  });

  it('aggregates owner briefing summary for autonomous operations', () => {
    const ledger = new BackgroundWorkLedger();

    ledger.record({
      workspaceId: 'ws-gangnam',
      triggerId: 'trig-1',
      triggerType: 'SCHEDULE',
      goalId: 'goal-1',
      runId: 'run-1',
      actionId: 'act-1',
      actionType: 'PUBLISH_CONTENT',
      charterId: 'charter-1',
      charterVersion: '1.0',
      summary: '네이버 플레이스 소식 등록',
      verificationState: 'EXTERNAL_VERIFIED',
      evidenceId: 'ev-1',
      creditsConsumed: 150,
    });

    ledger.record({
      workspaceId: 'ws-gangnam',
      triggerId: 'trig-2',
      triggerType: 'BOOKING_GAP',
      goalId: 'goal-1',
      runId: 'run-2',
      actionId: 'act-2',
      actionType: 'PUBLISH_CONTENT',
      charterId: 'charter-1',
      charterVersion: '1.0',
      summary: '당근마켓 소식 등록',
      verificationState: 'RESULT_UNKNOWN',
      evidenceId: 'ev-2',
      creditsConsumed: 100,
    });

    const briefing = ledger.getOwnerBriefing('ws-gangnam');
    expect(briefing.totalAutonomousActions).toBe(2);
    expect(briefing.verifiedCount).toBe(1);
    expect(briefing.resultUnknownCount).toBe(1);
    expect(briefing.totalCreditsSettled).toBe(150);
    expect(briefing.topAchievements).toContain('네이버 플레이스 소식 등록');
  });
});
