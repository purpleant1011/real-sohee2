import { describe, expect, it, vi } from 'vitest'
import { calculateReadiness, type ReadinessInput } from './readiness'

const fields = [
  'business',
  'brand',
  'channel',
  'knowledge',
  'automation',
  'permissions',
] as const

function completeInput(trueCount: number): ReadinessInput {
  return {
    business: trueCount > 0,
    brand: trueCount > 1,
    channel: trueCount > 2,
    knowledge: trueCount > 3,
    automation: trueCount > 4,
    permissions: trueCount > 5,
  }
}

describe('calculateReadiness', () => {
  it.each([
    [0, 0],
    [1, 17],
    [2, 33],
    [3, 50],
    [4, 67],
    [5, 83],
    [6, 100],
  ])('returns %s loaded true fields as %s percent', (trueCount, expectedPercentage) => {
    expect(calculateReadiness(completeInput(trueCount))).toEqual({
      kind: 'ready',
      percentage: expectedPercentage,
    })
  })

  it.each(fields)('returns loading with no percentage when %s is null', (field) => {
    const input: ReadinessInput = { ...completeInput(6), [field]: null }

    const result = calculateReadiness(input)

    expect(result).toEqual({ kind: 'loading' })
    expect(Object.hasOwn(result, 'percentage')).toBe(false)
  })

  it.each(fields)('returns loading with no percentage when %s is missing', (field) => {
    const input: Partial<ReadinessInput> = { ...completeInput(6) }
    delete input[field]

    const result = calculateReadiness(input)

    expect(result).toEqual({ kind: 'loading' })
    expect(Object.hasOwn(result, 'percentage')).toBe(false)
  })

  it.each([
    ['undefined', undefined],
    ['a number', 1],
    ['a string', 'true'],
    ['a boxed boolean', new Boolean(true)],
    ['an object', {}],
  ])('returns loading when a field is %s instead of a primitive boolean', (_label, value) => {
    expect(
      calculateReadiness({
        ...completeInput(6),
        business: value,
      }),
    ).toEqual({ kind: 'loading' })
  })

  it.each([
    [
      'an array with named fields',
      Object.assign([], completeInput(6)),
    ],
    [
      'a function with named fields',
      Object.assign(() => undefined, completeInput(6)),
    ],
  ])('fails closed for %s instead of a readiness object', (_label, input) => {
    expect(calculateReadiness(input)).toEqual({ kind: 'loading' })
  })

  it('does not show the visually misleading 17 percent while later fields are loading', () => {
    const result = calculateReadiness({
      business: true,
      brand: null,
      channel: null,
      knowledge: null,
      automation: null,
      permissions: null,
    })

    expect(result).toEqual({ kind: 'loading' })
    expect(Object.hasOwn(result, 'percentage')).toBe(false)
  })

  it('reads all six fields once and keeps their first observed values authoritative', () => {
    const reads = Object.fromEntries(fields.map((field) => [field, 0])) as Record<
      (typeof fields)[number],
      number
    >
    const input = Object.fromEntries(
      fields.map((field) => [
        field,
        undefined,
      ]),
    ) as Record<string, unknown>

    for (const field of fields) {
      Object.defineProperty(input, field, {
        enumerable: true,
        get() {
          reads[field] += 1
          return reads[field] === 1 ? true : null
        },
      })
    }

    expect(calculateReadiness(input)).toEqual({ kind: 'ready', percentage: 100 })
    expect(reads).toEqual({
      business: 1,
      brand: 1,
      channel: 1,
      knowledge: 1,
      automation: 1,
      permissions: 1,
    })
  })

  it.each(fields)('does not throw when the %s getter throws', (throwingField) => {
    const input = completeInput(6) as ReadinessInput
    Object.defineProperty(input, throwingField, {
      configurable: true,
      get() {
        throw new Error('PRIVATE_READINESS_EXCEPTION_DETAIL')
      },
    })

    expect(() => calculateReadiness(input)).not.toThrow()
    expect(calculateReadiness(input)).toEqual({ kind: 'loading' })
  })

  it('does not throw for a revoked Proxy input', () => {
    const { proxy, revoke } = Proxy.revocable(completeInput(4), {})
    revoke()

    expect(() => calculateReadiness(proxy)).not.toThrow()
    expect(calculateReadiness(proxy)).toEqual({ kind: 'loading' })
  })

  it('ignores unknown extra keys without reading them', () => {
    const input = completeInput(4) as ReadinessInput & { unexpected?: unknown }
    Object.defineProperty(input, 'unexpected', {
      enumerable: true,
      get() {
        throw new Error('unknown keys must be ignored')
      },
    })

    expect(calculateReadiness(input)).toEqual({ kind: 'ready', percentage: 67 })
  })

  it.each([
    [completeInput(4), ['kind', 'percentage']],
    [{ ...completeInput(4), permissions: null }, ['kind']],
  ] as const)('returns fresh frozen exact-shape outputs for %s', (input, expectedKeys) => {
    const first = calculateReadiness(input)
    const second = calculateReadiness(input)

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.keys(first)).toEqual(expectedKeys)
    expect(() => Object.defineProperty(first, 'kind', { value: '__poisoned__' })).toThrow()
    expect(second).toEqual(input.permissions === null
      ? { kind: 'loading' }
      : { kind: 'ready', percentage: 67 })
  })

  it('does not mutate a frozen readiness input or call ambient runtime APIs', () => {
    const input = Object.freeze(completeInput(4))
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })
    const mathRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called')
    })
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch must not be called')
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal(
      'crypto',
      new Proxy(
        {},
        {
          get() {
            throw new Error('crypto must not be read')
          },
        },
      ),
    )

    try {
      expect(calculateReadiness(input)).toEqual({ kind: 'ready', percentage: 67 })
      expect(input).toEqual(completeInput(4))
      expect(dateNow).not.toHaveBeenCalled()
      expect(mathRandom).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      dateNow.mockRestore()
      mathRandom.mockRestore()
    }
  })
})
