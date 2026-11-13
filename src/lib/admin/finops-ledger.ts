import { SupabaseClient } from '@supabase/supabase-js';

export type CostCategory =
  | 'LLM_INFERENCE'
  | 'IMAGE_GENERATION'
  | 'BROWSER_COMPUTE'
  | 'META_API_CALL'
  | 'STORAGE_BANDWIDTH';

export interface InternalCostEntry {
  id: string;
  workspaceId: string;
  category: CostCategory;
  costInWon: number;
  unitsConsumed: number; // tokens, seconds, images
  description: string;
  timestamp: string;
}

export interface WorkspaceFinOpsSummary {
  workspaceId: string;
  totalCostInWon: number;
  totalRevenueInWon: number;
  grossMarginPercent: number;
  isThrottled: boolean;
  costBreakdown: Record<CostCategory, number>;
}

export function recordInternalCost(
  workspaceId: string,
  category: CostCategory,
  costInWon: number,
  unitsConsumed: number,
  description: string
): InternalCostEntry {
  return {
    id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    category,
    costInWon,
    unitsConsumed,
    description,
    timestamp: new Date().toISOString()
  };
}

export async function recordInternalCostToLedger(
  supabase: SupabaseClient,
  entry: {
    workspaceId: string;
    provider: string;
    category: CostCategory;
    cogsAmountUsd: number;
    cogsAmountKrw: number;
    unitsConsumed: number;
    rateVersion?: string;
    idempotencyKey?: string;
    metadata?: Record<string, any>;
  }
) {
  return await (supabase as any).from('finops_cost_ledger').insert({
    workspace_id: entry.workspaceId,
    provider: entry.provider,
    category: entry.category,
    cogs_amount_usd: entry.cogsAmountUsd,
    cogs_amount_krw: entry.cogsAmountKrw,
    units_consumed: entry.unitsConsumed,
    rate_version: entry.rateVersion || 'v2026-08',
    idempotency_key: entry.idempotencyKey || null,
    recorded_at: new Date().toISOString(),
    metadata: entry.metadata || {}
  });
}

export function calculateFinOpsMargin(
  totalCost: number,
  totalRevenue: number
): number {
  if (totalRevenue <= 0) return 0;
  return Math.round(((totalRevenue - totalCost) / totalRevenue) * 100);
}

export function detectCostAnomaly(
  rolling24hCogsUsd: number,
  thresholdUsd: number = 50.0
): { isAnomaly: boolean; severity: 'NONE' | 'WARNING' | 'CRITICAL'; reason?: string } {
  if (rolling24hCogsUsd > thresholdUsd * 2) {
    return {
      isAnomaly: true,
      severity: 'CRITICAL',
      reason: `24시간 내 COGS가 $${rolling24hCogsUsd.toFixed(2)}로 임계치($${thresholdUsd})의 200%를 초과했습니다. 자동 스로틀링이 권장됩니다.`
    };
  }
  if (rolling24hCogsUsd > thresholdUsd) {
    return {
      isAnomaly: true,
      severity: 'WARNING',
      reason: `24시간 내 COGS가 $${rolling24hCogsUsd.toFixed(2)}로 임계치($${thresholdUsd})를 초과했습니다.`
    };
  }
  return { isAnomaly: false, severity: 'NONE' };
}
