import type { UniversalProviderUsageSnapshot } from '@/types/autonomous-outcome-os';
import { ModelPriceCardRegistry } from './model-price-card-registry';

export interface RawUsageInput {
  workspaceId: string;
  runId: string;
  actionId: string;
  capabilityId: string;
  provider: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  imageUnits?: number;
  videoMinutes?: number;
  browserDurationMs?: number;
  fixedCostUsdOverride?: number;
}

export class UniversalCostMeteringEngine {
  private registry: ModelPriceCardRegistry;

  constructor(registry?: ModelPriceCardRegistry) {
    this.registry = registry || new ModelPriceCardRegistry();
  }

  /**
   * Meters raw provider usage into canonical credits (ANI-759)
   * Formula: raw provider cost USD -> normalized internal COGS KRW -> chargeable COGS -> credits
   */
  meterUsage(input: RawUsageInput): UniversalProviderUsageSnapshot {
    const card = this.registry.getPriceCard(input.modelId);

    const inTokens = input.inputTokens || 0;
    const outTokens = input.outputTokens || 0;
    const cacheTokens = input.cachedTokens || 0;
    const reasonTokens = input.reasoningTokens || 0;
    const imgUnits = input.imageUnits || 0;
    const vidMins = input.videoMinutes || 0;
    const browserMs = input.browserDurationMs || 0;

    // 1. Calculate raw USD cost across tokens, media, and browser runtime
    const tokenCostUsd =
      (inTokens / 1_000_000) * card.inputTokenCostPerMillionUsd +
      (outTokens / 1_000_000) * card.outputTokenCostPerMillionUsd +
      (cacheTokens / 1_000_000) * card.cachedTokenCostPerMillionUsd +
      (reasonTokens / 1_000_000) * card.reasoningTokenCostPerMillionUsd;

    const imageCostUsd = imgUnits * (card.imageCostPerUnitUsd || 0);
    const videoCostUsd = vidMins * (card.videoCostPerMinuteUsd || 0);
    const browserCostUsd = (browserMs / 60_000) * (card.browserCostPerMinuteUsd || 0);
    const fixedCostUsd = input.fixedCostUsdOverride ?? (card.fixedCostPerInvocationUsd || 0);

    const rawProviderCostUsd = tokenCostUsd + imageCostUsd + videoCostUsd + browserCostUsd + fixedCostUsd;

    // 2. Normalize to Internal COGS (KRW)
    const normalizedInternalCogsKrw = Math.round(rawProviderCostUsd * card.usdToKrwFxRate * 100) / 100;

    // 3. Chargeable COGS (No artificial suppression, minimum 1 KRW if cost > 0)
    const chargeableCogsKrw = normalizedInternalCogsKrw > 0 ? Math.max(1, normalizedInternalCogsKrw) : 0;

    // 4. Convert to Credits (e.g. 1 Credit = 10 KRW; minimum 1 credit for any billable action)
    const krwPerCredit = 1 / card.cogsToCreditMultiplier;
    const chargedCredits = chargeableCogsKrw > 0 ? Math.max(1, Math.ceil(chargeableCogsKrw / krwPerCredit)) : 0;

    return {
      workspaceId: input.workspaceId,
      runId: input.runId,
      actionId: input.actionId,
      capabilityId: input.capabilityId,
      provider: input.provider,
      model: input.modelId,
      modelPricingVersion: card.version,
      inputTokens: inTokens,
      outputTokens: outTokens,
      cachedTokens: cacheTokens,
      reasoningTokens: reasonTokens,
      imageUnits: imgUnits,
      videoMinutes: vidMins,
      browserDurationMs: browserMs,
      rawProviderCostUsd: Number(rawProviderCostUsd.toFixed(6)),
      normalizedInternalCogsKrw,
      chargeableCogsKrw,
      chargedCredits,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Preflight cost estimator for action reservation
   * Estimates worst-case credits needed to prevent mid-flight exhaustion.
   */
  estimateReservationCredits(input: {
    modelId: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedBrowserMs?: number;
  }): number {
    const snapshot = this.meterUsage({
      workspaceId: 'preflight',
      runId: 'preflight',
      actionId: 'preflight',
      capabilityId: 'preflight',
      provider: 'preflight',
      modelId: input.modelId,
      inputTokens: input.estimatedInputTokens,
      outputTokens: input.estimatedOutputTokens,
      browserDurationMs: input.estimatedBrowserMs,
    });
    // Add 15% safety buffer for reservation
    return Math.ceil(snapshot.chargedCredits * 1.15);
  }
}
