/**
 * Growth Learner & Next-Best-Action (NBA) Engine (ANI-773)
 * 
 * Invariants:
 * 1. LLM proposes hypotheses, but scoring & ranking are strictly deterministic.
 * 2. Observational correlation is not presented as causal truth without evidence.
 * 3. 8-dimensional multi-attribute scoring model.
 */

export interface LearningMemoryItem {
  memoryId: string;
  workspaceId: string;
  finding: string;
  supportingEvidence: string;
  affectedChannel?: string;
  affectedAudience?: string;
  confidenceScore: number; // 0 to 100
  validFrom: string;
  expiresAt: string;
  sourceCampaignId?: string;
  recommendedRule: 'REUSE' | 'AVOID' | 'EXPERIMENT';
}

export interface NextBestActionCandidate {
  actionId: string;
  title: string;
  channel: string;
  description: string;
  expectedImpact: number;      // 0 to 100 (Weight: 25%)
  confidence: number;          // 0 to 100 (Weight: 20%)
  costEfficiency: number;      // 0 to 100 (Weight: 15%)
  riskPenalty: number;         // 0 to 100 (Negative Weight: -15%)
  latencyScore: number;        // 0 to 100 (Weight: 10%, higher = faster)
  reversibility: number;       // 0 to 100 (Weight: 5%)
  measurementReadiness: number;// 0 to 100 (Weight: 5%)
  userPriority: number;        // 0 to 100 (Weight: 5%)
}

export interface ScoredAction {
  candidate: NextBestActionCandidate;
  compositeScore: number; // Max approx 85 to 100
  rank: number;
}

export class GrowthLearnerEngine {
  private memoryStore: LearningMemoryItem[] = [];

  public storeLearningMemory(item: LearningMemoryItem): void {
    this.memoryStore.push(item);
  }

  public getActiveLearnings(workspaceId: string): readonly LearningMemoryItem[] {
    const now = new Date().toISOString();
    return this.memoryStore.filter(
      m => m.workspaceId === workspaceId && m.validFrom <= now && m.expiresAt >= now
    );
  }

  /**
   * Deterministic 8-dimension scoring formula:
   * (Impact * 0.25) + (Conf * 0.20) + (CostEff * 0.15) - (Risk * 0.15)
   * + (Latency * 0.10) + (Rev * 0.05) + (Readiness * 0.05) + (Priority * 0.05)
   */
  public scoreNextBestActions(candidates: readonly NextBestActionCandidate[]): ScoredAction[] {
    const scored = candidates.map(candidate => {
      const positiveScore =
        candidate.expectedImpact * 0.25 +
        candidate.confidence * 0.20 +
        candidate.costEfficiency * 0.15 +
        candidate.latencyScore * 0.10 +
        candidate.reversibility * 0.05 +
        candidate.measurementReadiness * 0.05 +
        candidate.userPriority * 0.05;

      const riskDeduction = candidate.riskPenalty * 0.15;
      const rawScore = positiveScore - riskDeduction;
      const compositeScore = Math.round(Math.max(0, rawScore) * 100) / 100;

      return {
        candidate,
        compositeScore,
        rank: 0,
      };
    });

    // Sort descending by compositeScore
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Assign rank
    return scored.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }
}
