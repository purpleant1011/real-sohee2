import { describe, expect, it } from 'vitest'
import { previewCreditCost, type CreditRateCatalog } from './rate-catalog'

const emptyUnits = {
  chatTurns: 0,
  textGenerations: 0,
  imageGenerations: 0,
  sourceAnalyses: 0,
  externalActions: 0,
} as const

const catalogV1: CreditRateCatalog = {
  catalogVersion: 1,
  rates: {
    period_plan_generation: {
      baseCredits: 4,
      perUnit: {
        chatTurns: 1,
        textGenerations: 5,
        imageGenerations: 3,
        sourceAnalyses: 0,
        externalActions: 0,
      },
    },
  },
}

describe('versioned credit-rate catalog', () => {
  it('calculates a multi-channel plan from the supplied catalog version', () => {
    const preview = previewCreditCost({
      action: 'period_plan_generation',
      units: { chatTurns: 1, textGenerations: 5, imageGenerations: 8, sourceAnalyses: 0, externalActions: 0 },
    }, catalogV1)

    expect(preview).toEqual({ catalogVersion: 1, estimatedCredits: 54 })
  })

  it('rejects unknown actions instead of charging zero', () => {
    expect(() => previewCreditCost({ action: 'unknown', units: emptyUnits }, catalogV1)).toThrow('CREDIT_ACTION_UNSUPPORTED')
  })

  it('does not substitute a missing policy rate with an invented value', () => {
    expect(() => previewCreditCost({ action: 'chat_turn', units: emptyUnits }, catalogV1)).toThrow('CREDIT_RATE_MISSING')
  })
})
