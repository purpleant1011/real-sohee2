export type ReadinessInput = {
  business: boolean | null
  brand: boolean | null
  channel: boolean | null
  knowledge: boolean | null
  automation: boolean | null
  permissions: boolean | null
}

type ReadinessResult =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; percentage: number }>

const readinessFields = [
  'business',
  'brand',
  'channel',
  'knowledge',
  'automation',
  'permissions',
] as const

function loadingResult(): ReadinessResult {
  return Object.freeze({ kind: 'loading' })
}

export function calculateReadiness(input: unknown): ReadinessResult {
  if (input === null || typeof input !== 'object') {
    return loadingResult()
  }

  try {
    if (Array.isArray(input)) {
      return loadingResult()
    }
  } catch {
    return loadingResult()
  }

  const record = input as Record<(typeof readinessFields)[number], unknown>
  const values: unknown[] = []
  let unreadable = false

  for (const field of readinessFields) {
    try {
      values.push(record[field])
    } catch {
      unreadable = true
      values.push(undefined)
    }
  }

  if (unreadable || values.some((value) => typeof value !== 'boolean')) {
    return loadingResult()
  }

  let trueCount = 0
  for (const value of values) {
    if (value === true) {
      trueCount += 1
    }
  }

  return Object.freeze({
    kind: 'ready',
    percentage: Math.round((trueCount / readinessFields.length) * 100),
  })
}
