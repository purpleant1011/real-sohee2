import { creditActions, type CreditCostRequest, type CreditPreview, type CreditRateCatalog, type CreditUnits } from './types'

export type { CreditRateCatalog } from './types'

const unitKeys = [
  'chatTurns',
  'textGenerations',
  'imageGenerations',
  'sourceAnalyses',
  'externalActions',
] as const

function assertNonnegativeInteger(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code)
}

function assertUnits(units: CreditUnits, code: string) {
  for (const key of unitKeys) assertNonnegativeInteger(units[key], code)
}

export function previewCreditCost(input: CreditCostRequest, catalog: CreditRateCatalog): CreditPreview {
  if (!creditActions.includes(input.action as typeof creditActions[number])) {
    throw new Error('CREDIT_ACTION_UNSUPPORTED')
  }
  assertNonnegativeInteger(catalog.catalogVersion, 'CREDIT_CATALOG_INVALID')
  assertUnits(input.units, 'CREDIT_UNITS_INVALID')

  const rate = catalog.rates[input.action as typeof creditActions[number]]
  if (!rate) throw new Error('CREDIT_RATE_MISSING')

  assertNonnegativeInteger(rate.baseCredits, 'CREDIT_RATE_INVALID')
  assertUnits(rate.perUnit, 'CREDIT_RATE_INVALID')

  const estimatedCredits = unitKeys.reduce(
    (total, key) => total + input.units[key] * rate.perUnit[key],
    rate.baseCredits,
  )
  assertNonnegativeInteger(estimatedCredits, 'CREDIT_ESTIMATE_INVALID')

  return { catalogVersion: catalog.catalogVersion, estimatedCredits }
}
