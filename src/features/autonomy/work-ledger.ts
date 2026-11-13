/**
 * Background Work Ledger (ANI-903)
 * 
 * Core Invariants:
 * 1. Canonical Work Timeline: Replaces chat transcripts with authoritative, immutable ledger records.
 * 2. Complete Provenance: Connects Trigger -> Action -> Readback -> Outcome -> Learning.
 * 3. Transparent Accounting: Records exact credits consumed and verification state.
 */

export interface WorkLedgerEntry {
  id: string;
  occurredAt: string;
  workspaceId: string;
  triggerId: string;
  triggerType: 'SCHEDULE' | 'BOOKING_GAP' | 'GOAL_SHORTFALL' | 'CHANNEL_EVENT' | 'MANUAL';
  goalId: string;
  runId: string;
  actionId: string;
  actionType: string;
  charterId: string;
  charterVersion: string;
  summary: string;
  verificationState: 'EXTERNAL_VERIFIED' | 'RESULT_UNKNOWN' | 'VERIFY_FAILED';
  evidenceId: string;
  outcomeId?: string;
  learningCandidateId?: string;
  creditsConsumed: number;
}

export interface OwnerBriefingSummary {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  totalAutonomousActions: number;
  verifiedCount: number;
  resultUnknownCount: number;
  failedCount: number;
  totalCreditsSettled: number;
  topAchievements: string[];
}

export class BackgroundWorkLedger {
  private entries: WorkLedgerEntry[] = [];

  record(entry: Omit<WorkLedgerEntry, 'id' | 'occurredAt'>): WorkLedgerEntry {
    const fullEntry: WorkLedgerEntry = {
      id: `wle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      occurredAt: new Date().toISOString(),
      ...entry,
    };

    this.entries.unshift(fullEntry);
    return fullEntry;
  }

  getEntry(id: string): WorkLedgerEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  listTimeline(workspaceId: string, limit = 50): WorkLedgerEntry[] {
    return this.entries
      .filter((e) => e.workspaceId === workspaceId)
      .slice(0, limit);
  }

  getOwnerBriefing(workspaceId: string): OwnerBriefingSummary {
    const items = this.listTimeline(workspaceId, 100);
    const verified = items.filter((i) => i.verificationState === 'EXTERNAL_VERIFIED');
    const unknown = items.filter((i) => i.verificationState === 'RESULT_UNKNOWN');
    const failed = items.filter((i) => i.verificationState === 'VERIFY_FAILED');

    const totalCredits = verified.reduce((acc, cur) => acc + cur.creditsConsumed, 0);
    const achievements = verified.slice(0, 3).map((v) => v.summary);

    const now = new Date();
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    return {
      workspaceId,
      periodStart,
      periodEnd: now.toISOString(),
      totalAutonomousActions: items.length,
      verifiedCount: verified.length,
      resultUnknownCount: unknown.length,
      failedCount: failed.length,
      totalCreditsSettled: totalCredits,
      topAchievements: achievements,
    };
  }
}
