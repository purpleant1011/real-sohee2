import { describe, expect, it, vi } from 'vitest'
import {
  canTransitionKnowledgeStatus,
  canUseAsEvidence,
  getKnowledgeStatusPresentation,
  knowledgeTransition,
  type KnowledgeStatus,
} from './knowledge-status'

const statuses = [
  'uploading',
  'checking',
  'review_required',
  'approved',
  'rejected',
  'disabled',
] as const satisfies readonly KnowledgeStatus[]

const expectedTransitions = {
  uploading: ['checking', 'rejected'],
  checking: ['review_required', 'rejected'],
  review_required: ['approved', 'rejected'],
  approved: ['disabled'],
  rejected: [],
  disabled: [],
} as const

const expectedPresentations = {
  uploading: {
    label: '업로드 중',
    message: '자료를 안전하게 전송하고 있어요.',
  },
  checking: {
    label: '확인 중',
    message: '파일 형식과 상태를 확인 중이에요. 악성 파일 검사 완료를 의미하지 않아요.',
  },
  review_required: {
    label: '검토 필요',
    message: '콘텐츠 근거로 쓰기 전에 사람의 검토가 필요해요.',
  },
  approved: {
    label: '승인됨',
    message: '승인된 범위에서 콘텐츠 근거로 사용할 수 있어요.',
  },
  rejected: {
    label: '반려됨',
    message: '콘텐츠 근거로 사용하지 않아요.',
  },
  disabled: {
    label: '사용 중지',
    message: '이 자료는 더 이상 콘텐츠 근거로 사용하지 않아요.',
  },
} as const

const unknownPresentation = {
  label: '상태 확인 필요',
  message: '자료 상태를 확인해 주세요.',
} as const

describe('knowledgeTransition', () => {
  it('exposes exactly the six approved statuses and directed transitions', () => {
    expect(Object.keys(knowledgeTransition)).toEqual(statuses)
    expect(knowledgeTransition).toEqual(expectedTransitions)

    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransitionKnowledgeStatus(from, to)).toBe(
          expectedTransitions[from].some((allowed) => allowed === to),
        )
      }
    }
  })

  it.each(statuses)('does not allow the same %s state to transition to itself', (status) => {
    expect(canTransitionKnowledgeStatus(status, status)).toBe(false)
  })

  it.each(['rejected', 'disabled'] as const)('keeps terminal state %s terminal', (status) => {
    expect(knowledgeTransition[status]).toEqual([])

    for (const target of statuses) {
      expect(canTransitionKnowledgeStatus(status, target)).toBe(false)
    }
  })

  it('is deeply frozen and caller mutation cannot alter later transition decisions', () => {
    expect(Object.isFrozen(knowledgeTransition)).toBe(true)
    for (const status of statuses) {
      expect(Object.isFrozen(knowledgeTransition[status])).toBe(true)
    }

    expect(() => {
      ;(knowledgeTransition.uploading as KnowledgeStatus[]).push('disabled')
    }).toThrow()
    expect(() => {
      Object.defineProperty(knowledgeTransition, 'approved', { value: ['uploading'] })
    }).toThrow()

    expect(knowledgeTransition).toEqual(expectedTransitions)
    expect(canTransitionKnowledgeStatus('uploading', 'disabled')).toBe(false)
    expect(canTransitionKnowledgeStatus('approved', 'disabled')).toBe(true)
  })
})

describe('canTransitionKnowledgeStatus', () => {
  it.each([
    ['an unknown source', 'unknown', 'approved'],
    ['an unknown destination', 'checking', 'unknown'],
    ['a symbol source', Symbol('checking'), 'review_required'],
    ['an object destination', 'checking', { value: 'review_required' }],
    ['a function source', () => 'checking', 'review_required'],
    ['a boxed string destination', 'checking', new String('review_required')],
    ['a null source', null, 'checking'],
    ['an undefined destination', 'checking', undefined],
  ])('fails closed for %s without throwing', (_label, from, to) => {
    expect(() => canTransitionKnowledgeStatus(from, to)).not.toThrow()
    expect(canTransitionKnowledgeStatus(from, to)).toBe(false)
  })

  it('does not coerce transition values or invoke coercion hooks', () => {
    const hooks = {
      toString: vi.fn(() => 'checking'),
      valueOf: vi.fn(() => 'checking'),
      [Symbol.toPrimitive]: vi.fn(() => 'checking'),
    }

    expect(canTransitionKnowledgeStatus(hooks, 'review_required')).toBe(false)
    expect(canTransitionKnowledgeStatus('checking', hooks)).toBe(false)
    expect(hooks.toString).not.toHaveBeenCalled()
    expect(hooks.valueOf).not.toHaveBeenCalled()
    expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled()
  })

  it('does not throw for revoked Proxy transition values', () => {
    const objectRevocable = Proxy.revocable({ status: 'checking' }, {})
    const functionRevocable = Proxy.revocable(() => 'review_required', {})
    objectRevocable.revoke()
    functionRevocable.revoke()

    expect(() => canTransitionKnowledgeStatus(objectRevocable.proxy, 'checking')).not.toThrow()
    expect(() => canTransitionKnowledgeStatus('checking', functionRevocable.proxy)).not.toThrow()
    expect(canTransitionKnowledgeStatus(objectRevocable.proxy, 'checking')).toBe(false)
    expect(canTransitionKnowledgeStatus('checking', functionRevocable.proxy)).toBe(false)
  })

  it('does not invoke a caller-poisoned transition-array iterator', () => {
    const transitionArrayPrototype = Object.getPrototypeOf(
      knowledgeTransition.uploading,
    ) as { [Symbol.iterator]: () => Iterator<unknown> }
    const originalIterator = transitionArrayPrototype[Symbol.iterator]
    let result = false
    let thrown: unknown

    try {
      transitionArrayPrototype[Symbol.iterator] = () => {
        throw new Error('caller-controlled iterator must not run')
      }

      try {
        result = canTransitionKnowledgeStatus('uploading', 'checking')
      } catch (error) {
        thrown = error
      }
    } finally {
      transitionArrayPrototype[Symbol.iterator] = originalIterator
    }

    expect(thrown).toBeUndefined()
    expect(result).toBe(true)
    expect(canTransitionKnowledgeStatus('uploading', 'checking')).toBe(true)
  })
})

describe('canUseAsEvidence', () => {
  it.each(statuses)('allows evidence only for the approved status, not %s by default', (status) => {
    expect(canUseAsEvidence({ status })).toBe(status === 'approved')
  })

  it.each([
    ['a missing status', {}],
    ['an unknown status', { status: 'unknown' }],
    ['a numeric status', { status: 1 }],
    ['a boxed approved status', { status: new String('approved') }],
    ['a null status', { status: null }],
    ['a primitive input', 'approved'],
    ['a null input', null],
    ['an array with an approved property', Object.assign([], { status: 'approved' })],
    ['a function with an approved property', Object.assign(() => undefined, { status: 'approved' })],
  ])('fails closed for %s', (_label, input) => {
    expect(canUseAsEvidence(input)).toBe(false)
  })

  it('reads status once, ignores unrelated properties, and keeps the first primitive value authoritative', () => {
    let statusReads = 0
    let unrelatedReads = 0
    const input = {
      get status() {
        statusReads += 1
        return statusReads === 1 ? 'approved' : 'rejected'
      },
      get unrelated() {
        unrelatedReads += 1
        throw new Error('unrelated property must not be read')
      },
    }

    expect(canUseAsEvidence(input)).toBe(true)
    expect(statusReads).toBe(1)
    expect(unrelatedReads).toBe(0)
  })

  it('keeps the first rejected observation authoritative even if a later read would approve it', () => {
    let statusReads = 0
    const input = {
      get status() {
        statusReads += 1
        return statusReads === 1 ? 'rejected' : 'approved'
      },
    }

    expect(canUseAsEvidence(input)).toBe(false)
    expect(statusReads).toBe(1)
  })

  it('does not throw or expose a throwing status getter', () => {
    const input = {
      get status() {
        throw new Error('PRIVATE_KNOWLEDGE_STATUS_DETAIL')
      },
    }

    expect(() => canUseAsEvidence(input)).not.toThrow()
    expect(canUseAsEvidence(input)).toBe(false)
  })

  it('does not throw for a revoked Proxy input', () => {
    const { proxy, revoke } = Proxy.revocable({ status: 'approved' }, {})
    revoke()

    expect(() => canUseAsEvidence(proxy)).not.toThrow()
    expect(canUseAsEvidence(proxy)).toBe(false)
  })
})

describe('getKnowledgeStatusPresentation', () => {
  it.each(statuses)('returns the exact Korean presentation for %s', (status) => {
    expect(getKnowledgeStatusPresentation(status)).toEqual(expectedPresentations[status])
  })

  it('describes checking without claiming that malware scanning is complete', () => {
    const presentation = getKnowledgeStatusPresentation('checking')

    expect(presentation.label).toContain('확인 중')
    expect(presentation.message).toContain('확인 중')
    expect(presentation.message).toContain('악성 파일 검사 완료를 의미하지 않아요')
    expect(presentation.message).not.toBe('악성 파일 검사가 완료되었어요.')
  })

  it.each([
    ['an unknown string', 'unknown'],
    ['a symbol', Symbol('checking')],
    ['an object', { status: 'approved' }],
    ['a function', () => 'approved'],
    ['a boxed approved string', new String('approved')],
    ['null', null],
    ['undefined', undefined],
  ])('returns the conservative presentation for %s', (_label, status) => {
    expect(getKnowledgeStatusPresentation(status)).toEqual(unknownPresentation)
  })

  it('does not coerce unknown presentation values', () => {
    const hooks = {
      toString: vi.fn(() => 'approved'),
      valueOf: vi.fn(() => 'approved'),
      [Symbol.toPrimitive]: vi.fn(() => 'approved'),
    }

    expect(getKnowledgeStatusPresentation(hooks)).toEqual(unknownPresentation)
    expect(hooks.toString).not.toHaveBeenCalled()
    expect(hooks.valueOf).not.toHaveBeenCalled()
    expect(hooks[Symbol.toPrimitive]).not.toHaveBeenCalled()
  })

  it('does not throw for a revoked Proxy status', () => {
    const { proxy, revoke } = Proxy.revocable({ status: 'approved' }, {})
    revoke()

    expect(() => getKnowledgeStatusPresentation(proxy)).not.toThrow()
    expect(getKnowledgeStatusPresentation(proxy)).toEqual(unknownPresentation)
  })

  it.each([...statuses, 'unknown'] as const)('returns fresh frozen exact-shape output for %s', (status) => {
    const first = getKnowledgeStatusPresentation(status)
    const second = getKnowledgeStatusPresentation(status)

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.keys(first)).toEqual(['label', 'message'])
    expect(() => Object.defineProperty(first, 'label', { value: '__poisoned__' })).toThrow()
    expect(second).toEqual(
      status === 'unknown' ? unknownPresentation : expectedPresentations[status],
    )
  })
})

describe('knowledge status policy isolation', () => {
  it('does not mutate frozen input or call ambient runtime APIs', () => {
    const input = Object.freeze({ status: 'approved', unrelated: 'preserved' })
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
      expect(canUseAsEvidence(input)).toBe(true)
      expect(canTransitionKnowledgeStatus('review_required', 'approved')).toBe(true)
      expect(getKnowledgeStatusPresentation('approved')).toEqual(expectedPresentations.approved)
      expect(input).toEqual({ status: 'approved', unrelated: 'preserved' })
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
