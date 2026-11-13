import type { ModelPricingCard } from '@/types/autonomous-outcome-os';

/**
 * ANI-759 Dynamic Model & Runtime Price Card Registry
 * Eliminates hardcoded model strings and enforces versioned cost policies.
 */
export class ModelPriceCardRegistry {
  private static readonly DEFAULT_CARDS: ModelPricingCard[] = [
    {
      modelId: 'gemini-3.8-flash',
      provider: 'google',
      displayName: 'Google Gemini 3.8 Flash',
      version: '2026-09-v1',
      inputTokenCostPerMillionUsd: 0.15,
      outputTokenCostPerMillionUsd: 0.60,
      cachedTokenCostPerMillionUsd: 0.04,
      reasoningTokenCostPerMillionUsd: 0.60,
      imageCostPerUnitUsd: 0.002,
      videoCostPerMinuteUsd: 0.02,
      browserCostPerMinuteUsd: 0.01,
      fixedCostPerInvocationUsd: 0.0001,
      usdToKrwFxRate: 1400,
      cogsToCreditMultiplier: 0.1, // 1 Credit = 10 KRW COGS
      effectiveFrom: '2026-09-01T00:00:00Z',
    },
    {
      modelId: 'luna-5.6-max',
      provider: 'openai',
      displayName: 'OpenAI 5.6 Luna Max',
      version: '2026-09-v1',
      inputTokenCostPerMillionUsd: 2.50,
      outputTokenCostPerMillionUsd: 10.00,
      cachedTokenCostPerMillionUsd: 1.25,
      reasoningTokenCostPerMillionUsd: 10.00,
      imageCostPerUnitUsd: 0.04,
      videoCostPerMinuteUsd: 0.10,
      browserCostPerMinuteUsd: 0.03,
      fixedCostPerInvocationUsd: 0.001,
      usdToKrwFxRate: 1400,
      cogsToCreditMultiplier: 0.1,
      effectiveFrom: '2026-09-01T00:00:00Z',
    },
    {
      modelId: 'sohee-browser-worker',
      provider: 'sohee-substrate',
      displayName: 'Sohee Playwright Browser Worker',
      version: '2026-09-v1',
      inputTokenCostPerMillionUsd: 0,
      outputTokenCostPerMillionUsd: 0,
      cachedTokenCostPerMillionUsd: 0,
      reasoningTokenCostPerMillionUsd: 0,
      browserCostPerMinuteUsd: 0.015,
      fixedCostPerInvocationUsd: 0.005,
      usdToKrwFxRate: 1400,
      cogsToCreditMultiplier: 0.1,
      effectiveFrom: '2026-09-01T00:00:00Z',
    },
  ];

  private cards: Map<string, ModelPricingCard> = new Map();

  constructor(customCards?: ModelPricingCard[]) {
    const list = customCards || ModelPriceCardRegistry.DEFAULT_CARDS;
    for (const c of list) {
      this.cards.set(c.modelId, c);
    }
  }

  getPriceCard(modelId: string): ModelPricingCard {
    const card = this.cards.get(modelId);
    if (!card) {
      // Fallback to primary production planner
      return this.cards.get('gemini-3.8-flash')!;
    }
    return card;
  }

  registerOrUpdateCard(card: ModelPricingCard): void {
    this.cards.set(card.modelId, card);
  }

  listAllCards(): ModelPricingCard[] {
    return Array.from(this.cards.values());
  }
}
