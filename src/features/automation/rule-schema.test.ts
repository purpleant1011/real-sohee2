import { describe, expect, it, vi } from 'vitest'
import {
  canEditAutomation,
  ruleSchema,
  type AutomationRuleInput,
} from './rule-schema'

function restoreObjectPrototypeProperty(
  key: 'kind' | 'active' | 'approvalRequired',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(Object.prototype, key, descriptor)
  } else {
    Reflect.deleteProperty(Object.prototype, key)
  }
}

describe('ruleSchema', () => {
  it.each([
    ['faq_safe_reply', false],
    ['schedule_reminder', true],
    ['content_draft', true],
  ] as const)('accepts the approved %s rule kind', (kind, approvalRequired) => {
    const result = ruleSchema.safeParse({ kind, approvalRequired })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ kind, active: false, approvalRequired })
    }
  })

  it('requires the human approval point for content drafts', () => {
    const rejected = ruleSchema.safeParse({
      kind: 'content_draft',
      approvalRequired: false,
    })

    expect(rejected.success).toBe(false)
    if (!rejected.success) {
      expect(rejected.error.message).toContain('콘텐츠 초안은 사람의 승인이 필요합니다.')
    }
    expect(
      ruleSchema.safeParse({ kind: 'content_draft', approvalRequired: true }).success,
    ).toBe(true)
  })

  it.each(['faq_safe_reply', 'schedule_reminder'] as const)(
    'preserves both caller-provided approval choices for %s',
    (kind) => {
      expect(ruleSchema.parse({ kind, approvalRequired: false }).approvalRequired).toBe(false)
      expect(ruleSchema.parse({ kind, approvalRequired: true }).approvalRequired).toBe(true)
    },
  )

  it('defaults an omitted active flag to false and preserves explicit primitive booleans', () => {
    expect(ruleSchema.parse({ kind: 'faq_safe_reply', approvalRequired: false }).active).toBe(
      false,
    )
    expect(
      ruleSchema.parse({ kind: 'faq_safe_reply', active: false, approvalRequired: false }).active,
    ).toBe(false)
    expect(
      ruleSchema.parse({ kind: 'faq_safe_reply', active: true, approvalRequired: false }).active,
    ).toBe(true)
  })

  it('rejects an own active data property whose value is undefined', () => {
    expect(
      ruleSchema.safeParse({
        kind: 'faq_safe_reply',
        active: undefined,
        approvalRequired: false,
      }).success,
    ).toBe(false)
  })

  it('rejects an own active getter returning undefined after reading it once', () => {
    let activeReads = 0
    const input = {
      kind: 'faq_safe_reply',
      get active() {
        activeReads += 1
        return undefined
      },
      approvalRequired: false,
    }

    expect(ruleSchema.safeParse(input).success).toBe(false)
    expect(activeReads).toBe(1)
  })

  it('rejects an own active Proxy property returning undefined after reading it once', () => {
    let activeReads = 0
    const input = new Proxy(
      {
        kind: 'faq_safe_reply',
        active: undefined,
        approvalRequired: false,
      },
      {
        get(target, key, receiver) {
          if (key === 'active') activeReads += 1
          return Reflect.get(target, key, receiver)
        },
      },
    )

    expect(ruleSchema.safeParse(input).success).toBe(false)
    expect(activeReads).toBe(1)
  })

  it('distinguishes a truly omitted active flag from null', () => {
    const omitted = ruleSchema.safeParse({
      kind: 'faq_safe_reply',
      approvalRequired: false,
    })

    expect(omitted.success).toBe(true)
    if (omitted.success) expect(omitted.data.active).toBe(false)
    expect(
      ruleSchema.safeParse({
        kind: 'faq_safe_reply',
        active: null,
        approvalRequired: false,
      }).success,
    ).toBe(false)
  })

  it.each([
    ['an unknown kind', { kind: 'unknown', approvalRequired: true }],
    ['a missing kind', { approvalRequired: true }],
    ['a missing approval flag', { kind: 'faq_safe_reply' }],
    ['a numeric kind', { kind: 1, approvalRequired: true }],
    ['a boxed kind', { kind: new String('faq_safe_reply'), approvalRequired: true }],
    ['a string active flag', { kind: 'faq_safe_reply', active: 'false', approvalRequired: true }],
    ['a numeric active flag', { kind: 'faq_safe_reply', active: 1, approvalRequired: true }],
    ['a string approval flag', { kind: 'faq_safe_reply', approvalRequired: 'true' }],
    ['a numeric approval flag', { kind: 'faq_safe_reply', approvalRequired: 1 }],
    ['an extra string key', { kind: 'faq_safe_reply', approvalRequired: true, workspaceId: 'x' }],
    [
      'an extra symbol key',
      Object.assign({ kind: 'faq_safe_reply', approvalRequired: true }, { [Symbol('extra')]: true }),
    ],
    ['an array', Object.assign([], { kind: 'faq_safe_reply', approvalRequired: true })],
    ['a function', Object.assign(() => undefined, { kind: 'faq_safe_reply', approvalRequired: true })],
    ['a primitive string', 'faq_safe_reply'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s without throwing', (_label, input) => {
    expect(() => ruleSchema.safeParse(input)).not.toThrow()
    expect(ruleSchema.safeParse(input).success).toBe(false)
  })

  it('does not mutate frozen input and returns a new plain exact-shape object', () => {
    const input = Object.freeze({
      kind: 'schedule_reminder' as const,
      approvalRequired: false,
    })

    const parsed: AutomationRuleInput = ruleSchema.parse(input)

    expect(parsed).not.toBe(input)
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.keys(parsed)).toEqual(['kind', 'active', 'approvalRequired'])
    expect(parsed).toEqual({
      kind: 'schedule_reminder',
      active: false,
      approvalRequired: false,
    })
    expect(input).toEqual({ kind: 'schedule_reminder', approvalRequired: false })
  })

  it('reads each approved field at most once and keeps the first primitive observation', () => {
    const reads = { kind: 0, active: 0, approvalRequired: 0 }
    const input = {
      get kind() {
        reads.kind += 1
        return reads.kind === 1 ? 'schedule_reminder' : 'content_draft'
      },
      get active() {
        reads.active += 1
        return reads.active === 1 ? true : 'not-a-boolean'
      },
      get approvalRequired() {
        reads.approvalRequired += 1
        return reads.approvalRequired === 1 ? false : true
      },
    }

    const result = ruleSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        kind: 'schedule_reminder',
        active: true,
        approvalRequired: false,
      })
    }
    expect(reads).toEqual({ kind: 1, active: 1, approvalRequired: 1 })
  })

  it('returns an exact plain result when the kind getter installs a prototype setter', () => {
    const originalKind = Object.getOwnPropertyDescriptor(Object.prototype, 'kind')
    let setterCalls = 0
    let thrown: unknown
    let result: ReturnType<typeof ruleSchema.safeParse> | undefined
    const input = {
      get kind() {
        Object.defineProperty(Object.prototype, 'kind', {
          configurable: true,
          set() {
            setterCalls += 1
          },
        })
        return 'faq_safe_reply'
      },
      approvalRequired: false,
    }

    try {
      try {
        result = ruleSchema.safeParse(input)
      } catch (error) {
        thrown = error
      }
    } finally {
      restoreObjectPrototypeProperty('kind', originalKind)
    }

    expect(thrown).toBeUndefined()
    expect(setterCalls).toBe(0)
    expect(result?.success).toBe(true)
    if (result?.success) {
      expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype)
      expect(Object.keys(result.data)).toEqual(['kind', 'active', 'approvalRequired'])
      expect(Object.getOwnPropertyDescriptors(result.data)).toEqual({
        kind: {
          value: 'faq_safe_reply',
          writable: true,
          enumerable: true,
          configurable: true,
        },
        active: {
          value: false,
          writable: true,
          enumerable: true,
          configurable: true,
        },
        approvalRequired: {
          value: false,
          writable: true,
          enumerable: true,
          configurable: true,
        },
      })
    }
  })

  it('bypasses prototype setters for all three result fields within one parse', () => {
    const originalDescriptors = {
      kind: Object.getOwnPropertyDescriptor(Object.prototype, 'kind'),
      active: Object.getOwnPropertyDescriptor(Object.prototype, 'active'),
      approvalRequired: Object.getOwnPropertyDescriptor(
        Object.prototype,
        'approvalRequired',
      ),
    }
    const setterCalls = { kind: 0, active: 0, approvalRequired: 0 }
    let thrown: unknown
    let result: ReturnType<typeof ruleSchema.safeParse> | undefined
    const input = {
      get kind() {
        Object.defineProperty(Object.prototype, 'kind', {
          configurable: true,
          set() {
            setterCalls.kind += 1
          },
        })
        return 'schedule_reminder'
      },
      get active() {
        Object.defineProperty(Object.prototype, 'active', {
          configurable: true,
          set() {
            setterCalls.active += 1
          },
        })
        return true
      },
      get approvalRequired() {
        Object.defineProperty(Object.prototype, 'approvalRequired', {
          configurable: true,
          set() {
            setterCalls.approvalRequired += 1
          },
        })
        return false
      },
    }

    try {
      try {
        result = ruleSchema.safeParse(input)
      } catch (error) {
        thrown = error
      }
    } finally {
      restoreObjectPrototypeProperty('kind', originalDescriptors.kind)
      restoreObjectPrototypeProperty('active', originalDescriptors.active)
      restoreObjectPrototypeProperty(
        'approvalRequired',
        originalDescriptors.approvalRequired,
      )
    }

    expect(thrown).toBeUndefined()
    expect(setterCalls).toEqual({ kind: 0, active: 0, approvalRequired: 0 })
    expect(result?.success).toBe(true)
    if (result?.success) {
      expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype)
      expect(Object.keys(result.data)).toEqual(['kind', 'active', 'approvalRequired'])
      expect(Object.getOwnPropertyDescriptors(result.data)).toEqual({
        kind: {
          value: 'schedule_reminder',
          writable: true,
          enumerable: true,
          configurable: true,
        },
        active: {
          value: true,
          writable: true,
          enumerable: true,
          configurable: true,
        },
        approvalRequired: {
          value: false,
          writable: true,
          enumerable: true,
          configurable: true,
        },
      })
    }
  })

  it.each(['kind', 'active', 'approvalRequired'] as const)(
    'fails parsing safely when the %s getter throws without exposing its detail',
    (field) => {
      const secret = `PRIVATE_AUTOMATION_${field.toUpperCase()}_DETAIL`
      const input = {
        kind: 'faq_safe_reply',
        active: true,
        approvalRequired: false,
      }
      Object.defineProperty(input, field, {
        enumerable: true,
        get() {
          throw new Error(secret)
        },
      })

      expect(() => ruleSchema.safeParse(input)).not.toThrow()
      const result = ruleSchema.safeParse(input)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).not.toContain(secret)
      }
    },
  )

  it('fails parsing safely for a revoked Proxy', () => {
    const revocable = Proxy.revocable(
      { kind: 'faq_safe_reply', approvalRequired: false },
      {},
    )
    revocable.revoke()

    expect(() => ruleSchema.safeParse(revocable.proxy)).not.toThrow()
    expect(ruleSchema.safeParse(revocable.proxy).success).toBe(false)
  })

  it('rejects coercion objects without invoking coercion hooks', () => {
    const hooks = {
      toString: vi.fn(() => 'faq_safe_reply'),
      valueOf: vi.fn(() => true),
      [Symbol.toPrimitive]: vi.fn(() => 'faq_safe_reply'),
    }

    expect(ruleSchema.safeParse({ kind: hooks, approvalRequired: hooks }).success).toBe(false)
    expect(hooks.toString).not.toHaveBeenCalled()
    expect(hooks.valueOf).not.toHaveBeenCalled()
    expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled()
  })
})

describe('canEditAutomation', () => {
  it.each([
    ['owner', true],
    ['manager', true],
    ['reviewer', false],
    ['viewer', false],
  ] as const)('applies the exact automation edit policy for %s', (role, expected) => {
    expect(canEditAutomation(role)).toBe(expected)
  })

  it.each([
    ['an unknown role', 'administrator'],
    ['different casing', 'Owner'],
    ['a symbol', Symbol('owner')],
    ['an object', { role: 'owner' }],
    ['a function', () => 'owner'],
    ['a boxed string', new String('owner')],
    ['a promise', Promise.resolve('owner')],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
  ])('returns false without throwing for %s', (_label, role) => {
    expect(() => canEditAutomation(role)).not.toThrow()
    expect(canEditAutomation(role)).toBe(false)
  })

  it('does not invoke role coercion hooks', () => {
    const hooks = {
      toString: vi.fn(() => 'owner'),
      valueOf: vi.fn(() => 'owner'),
      [Symbol.toPrimitive]: vi.fn(() => 'owner'),
    }

    expect(canEditAutomation(hooks)).toBe(false)
    expect(hooks.toString).not.toHaveBeenCalled()
    expect(hooks.valueOf).not.toHaveBeenCalled()
    expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled()
  })

  it('returns false without touching a revoked Proxy', () => {
    const objectRevocable = Proxy.revocable({ role: 'owner' }, {})
    const functionRevocable = Proxy.revocable(() => 'owner', {})
    objectRevocable.revoke()
    functionRevocable.revoke()

    expect(() => canEditAutomation(objectRevocable.proxy)).not.toThrow()
    expect(() => canEditAutomation(functionRevocable.proxy)).not.toThrow()
    expect(canEditAutomation(objectRevocable.proxy)).toBe(false)
    expect(canEditAutomation(functionRevocable.proxy)).toBe(false)
  })
})

describe('automation rule purity', () => {
  it('does not read ambient time or randomness or call the network', () => {
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('ambient time must not be read')
    })
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('ambient randomness must not be read')
    })
    const fetchCall = vi.fn(() => Promise.reject(new Error('network must not be called')))
    vi.stubGlobal('fetch', fetchCall)

    let thrown: unknown
    let dateCalls = -1
    let randomCalls = -1
    try {
      try {
        ruleSchema.parse({ kind: 'content_draft', approvalRequired: true })
        canEditAutomation('manager')
      } catch (error) {
        thrown = error
      }
      dateCalls = dateNow.mock.calls.length
      randomCalls = random.mock.calls.length
    } finally {
      dateNow.mockRestore()
      random.mockRestore()
      vi.unstubAllGlobals()
    }

    expect(thrown).toBeUndefined()
    expect(dateCalls).toBe(0)
    expect(randomCalls).toBe(0)
    expect(fetchCall).not.toHaveBeenCalled()
  })
})
