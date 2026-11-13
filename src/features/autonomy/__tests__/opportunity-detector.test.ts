import { describe, it, expect } from 'vitest';
import { OpportunityDetector } from '../opportunity-detector';
import type { A3AutonomyCharter } from '../types';

describe('ANI-906: Opportunity Detector & Replan Loop', () => {
  const charter: A3AutonomyCharter = {
    id: 'ch-01',
    version: '1.0.0',
    workspaceId: 'ws-gangnam',
    status: 'ACTIVE',
    envelope: {
      maxDailyBudgetKRW: 100000,
      maxCreditsPerAction: 300,
      allowedChannels: ['instagram', 'naver'],
      requireExplicitApprovalRiskTier: 'R2_CRITICAL',
      quietHoursStartHour: 22,
      quietHoursEndHour: 8,
    },
    authorizedByOwnerId: 'owner-1',
    authorizedAt: '2026-09-01T00:00:00Z',
  };

  it('detects multiple signals, prioritizes by urgency score, and enforces deduplication cooldown', () => {
    const detector = new OpportunityDetector(60 * 60 * 1000); // 1 hr cooldown
    const now = 1757150000000;

    const candidates = detector.detectOpportunities(
      'ws-gangnam',
      {
        hasOpenBookingSlotsNext48h: true,
        openSlotCount: 3,
        scheduledPostDue: true,
        weeklyGoalCompletionRate: 0.3,
        unansweredInquiriesCount: 2,
      },
      now
    );

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    // Booking gap has higher urgency (90) than scheduled post (50)
    expect(candidates[0].type).toBe('BOOKING_GAP');
    expect(candidates[0].urgencyScore).toBe(90);
    expect(candidates[0].rationale).not.toContain('스토리')
    expect(candidates[0].rationale).toContain('피드')

    const daangnCandidate = candidates.find((c) => c.type === 'GOAL_SHORTFALL')
    expect(daangnCandidate?.rationale).not.toContain('쿠폰 발행')
    expect(daangnCandidate?.rationale).toContain('소식 초안')

    // Mark as executed
    detector.markExecuted(candidates[0].dedupeKey, now);

    // Re-detect immediately within cooldown: booking gap should be suppressed
    const reCandidates = detector.detectOpportunities(
      'ws-gangnam',
      {
        hasOpenBookingSlotsNext48h: true,
        openSlotCount: 3,
        scheduledPostDue: true,
        weeklyGoalCompletionRate: 0.3,
        unansweredInquiriesCount: 2,
      },
      now + 5000 // 5 seconds later
    );

    expect(reCandidates.some((c) => c.type === 'BOOKING_GAP')).toBe(false);
  });

  it('filters out opportunities targeting unapproved channels or when charter is PAUSED', () => {
    const detector = new OpportunityDetector();
    const candidates = detector.detectOpportunities('ws-gangnam', {
      hasOpenBookingSlotsNext48h: false,
      openSlotCount: 0,
      scheduledPostDue: false,
      weeklyGoalCompletionRate: 0.2, // produces DAANGN opportunity
      unansweredInquiriesCount: 0,
    });

    expect(candidates[0].targetChannel).toBe('daangn');

    // Charter only allows instagram, naver
    const promotable = detector.filterPromotableOpportunities(candidates, charter, true);
    expect(promotable).toHaveLength(0); // daangn is excluded

    // When charter is PAUSED, none can be promoted
    const promotablePaused = detector.filterPromotableOpportunities(
      candidates,
      { ...charter, status: 'PAUSED' },
      true
    );
    expect(promotablePaused).toHaveLength(0);
  });
});
