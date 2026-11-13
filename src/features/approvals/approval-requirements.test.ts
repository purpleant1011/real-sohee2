import { describe, expect, it } from 'vitest'
import {
  evaluateApprovalRequirements,
  type ApprovalCandidate,
  type ApprovalRequirement,
  type ApprovalRequirementKey,
  type WorkspaceRole,
} from './approval-requirements'

const requirementKeys: ApprovalRequirementKey[] = [
  'latestVersion',
  'approvalPermission',
  'rights',
  'evidence',
  'disclosure',
  'media',
]

const allMetRequirements: ApprovalRequirement[] = [
  { key: 'latestVersion', met: true, message: '최신 버전입니다.' },
  {
    key: 'approvalPermission',
    met: true,
    message: '콘텐츠를 승인할 권한이 있습니다.',
  },
  { key: 'rights', met: true, message: '콘텐츠 사용권을 확인했습니다.' },
  {
    key: 'evidence',
    met: true,
    message: '자동 생성 증빙을 확인했습니다.',
  },
  { key: 'disclosure', met: true, message: '필수 고지 조건을 충족했습니다.' },
  { key: 'media', met: true, message: '모든 미디어가 유효합니다.' },
]

function candidate(overrides: Partial<ApprovalCandidate> = {}): ApprovalCandidate {
  return {
    isLatestVersion: true,
    role: 'reviewer',
    rightsConfirmed: true,
    generationEvidenceConfirmed: true,
    disclosureRequired: true,
    disclosure: '자동 생성 콘텐츠입니다.',
    media: [{ id: 'media-1', isValid: true }],
    ...overrides,
  }
}

function unmetKeys(requirements: ApprovalRequirement[]): ApprovalRequirementKey[] {
  return requirements.filter(({ met }) => !met).map(({ key }) => key)
}

describe('evaluateApprovalRequirements', () => {
  it('모든 조건이 충족되면 고정된 순서로 여섯 개의 한국어 결과를 반환한다', () => {
    const result = evaluateApprovalRequirements(candidate())

    expect(result).toEqual(allMetRequirements)
    expect(result.map(({ key }) => key)).toEqual(requirementKeys)
    expect(result).toHaveLength(6)
    expect(result.every(({ message }) => /[가-힣]/.test(message))).toBe(true)
  })

  it('최신 버전이 아니면 최신 버전 조건만 계획에 승인된 결과로 차단한다', () => {
    const result = evaluateApprovalRequirements(candidate({ isLatestVersion: false }))

    expect(result).toContainEqual({
      key: 'latestVersion',
      met: false,
      message: '최신 버전을 다시 확인해 주세요.',
    })
    expect(unmetKeys(result)).toEqual(['latestVersion'])
  })

  it.each(['owner', 'manager', 'reviewer'] satisfies WorkspaceRole[])(
    '%s 역할은 승인할 수 있다',
    (role) => {
      expect(unmetKeys(evaluateApprovalRequirements(candidate({ role })))).toEqual([])
    },
  )

  it('viewer 역할은 승인 권한 조건만 충족하지 못한다', () => {
    expect(unmetKeys(evaluateApprovalRequirements(candidate({ role: 'viewer' })))).toEqual([
      'approvalPermission',
    ])
  })

  it.each([undefined, null, 'admin', 'OWNER', 1, {}])(
    '런타임 역할 %j에 대해 오류를 던지지 않고 권한을 차단한다',
    (role) => {
      const input = candidate({ role: role as WorkspaceRole })

      expect(() => evaluateApprovalRequirements(input)).not.toThrow()
      expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['approvalPermission'])
    },
  )

  it('사용권이 확인되지 않으면 사용권 조건만 충족하지 못한다', () => {
    expect(
      unmetKeys(evaluateApprovalRequirements(candidate({ rightsConfirmed: false }))),
    ).toEqual(['rights'])
  })

  it('자동 생성 증빙이 확인되지 않으면 증빙 조건만 충족하지 못한다', () => {
    expect(
      unmetKeys(
        evaluateApprovalRequirements(candidate({ generationEvidenceConfirmed: false })),
      ),
    ).toEqual(['evidence'])
  })

  it.each(['', ' \n\t '])('필수 고지가 %j이면 고지 조건을 차단한다', (disclosure) => {
    expect(
      unmetKeys(
        evaluateApprovalRequirements(
          candidate({ disclosureRequired: true, disclosure }),
        ),
      ),
    ).toEqual(['disclosure'])
  })

  it('필수 고지에 공백 외 문자가 있으면 고지 조건을 충족한다', () => {
    expect(
      unmetKeys(
        evaluateApprovalRequirements(
          candidate({ disclosureRequired: true, disclosure: '  필수 고지  ' }),
        ),
      ),
    ).toEqual([])
  })

  it('고지가 필수가 아니면 빈 고지를 허용한다', () => {
    expect(
      unmetKeys(
        evaluateApprovalRequirements(
          candidate({ disclosureRequired: false, disclosure: '' }),
        ),
      ),
    ).toEqual([])
  })

  it.each([
    { disclosureRequired: undefined },
    { disclosureRequired: null },
    { disclosureRequired: 'false' },
    { disclosureRequired: 0 },
    { disclosureRequired: true, disclosure: undefined },
    { disclosureRequired: true, disclosure: null },
    { disclosureRequired: true, disclosure: 1 },
    { disclosureRequired: false, disclosure: null },
  ])('잘못된 고지 값 %#을 오류 없이 차단한다', (malformed) => {
    const input = candidate(malformed as Partial<ApprovalCandidate>)

    expect(() => evaluateApprovalRequirements(input)).not.toThrow()
    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['disclosure'])
  })

  it('미디어가 하나도 없으면 미디어 조건을 차단한다', () => {
    expect(unmetKeys(evaluateApprovalRequirements(candidate({ media: [] })))).toEqual(['media'])
  })

  it.each([
    [[{ id: 'media-1', isValid: true }]],
    [
      [
        { id: 'media-1', isValid: true },
        { id: 'media-2', isValid: true },
        { id: 'media-3', isValid: true },
      ],
    ],
  ] as const)('유효한 미디어 목록은 미디어 조건을 충족한다', (media) => {
    expect(unmetKeys(evaluateApprovalRequirements(candidate({ media })))).toEqual([])
  })

  it('여러 미디어 중 하나라도 유효하지 않으면 미디어 조건을 차단한다', () => {
    const media = [
      { id: 'media-1', isValid: true },
      { id: 'media-2', isValid: false },
      { id: 'media-3', isValid: true },
    ]

    expect(unmetKeys(evaluateApprovalRequirements(candidate({ media })))).toEqual(['media'])
  })

  it.each([
    undefined,
    null,
    {},
    'media',
    [null],
    [{}],
    ['media'],
    [{ id: '', isValid: true }],
    [{ id: 'media-1' }],
    [{ id: 'media-1', isValid: 'true' }],
  ])('잘못된 미디어 %j를 내부 오류 없이 차단한다', (media) => {
    const input = candidate({ media: media as ApprovalCandidate['media'] })

    expect(() => evaluateApprovalRequirements(input)).not.toThrow()
    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['media'])
  })

  it('잘못된 미디어 필드 접근이 오류를 내도 내부 오류를 노출하지 않는다', () => {
    const malformedMediaItem = Object.defineProperty({ id: 'media-1' }, 'isValid', {
      get() {
        throw new Error('internal media error')
      },
    })
    const input = candidate({
      media: [malformedMediaItem] as unknown as ApprovalCandidate['media'],
    })

    expect(() => evaluateApprovalRequirements(input)).not.toThrow()
    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['media'])
  })

  it('배열이 자체 every를 변조해도 호출하거나 부작용을 내지 않고 미디어를 차단한다', () => {
    const sideEffectKey = Symbol('approval-media-every-side-effect')
    const runtimeGlobal = globalThis as unknown as Record<PropertyKey, unknown>
    const mediaItem = { id: '', isValid: false }
    const media = [mediaItem]
    let everyCalls = 0

    Object.defineProperty(media, 'every', {
      configurable: true,
      value: () => {
        everyCalls += 1
        mediaItem.id = 'media-1'
        mediaItem.isValid = true
        media.push({ id: 'media-2', isValid: true })
        runtimeGlobal[sideEffectKey] = 'mutated'
        return true
      },
    })

    try {
      const result = evaluateApprovalRequirements(candidate({ media }))

      expect(unmetKeys(result)).toEqual(['media'])
      expect(everyCalls).toBe(0)
      expect(media).toHaveLength(1)
      expect(mediaItem).toEqual({ id: '', isValid: false })
      expect(runtimeGlobal[sideEffectKey]).toBeUndefined()
    } finally {
      Reflect.deleteProperty(runtimeGlobal, sideEffectKey)
    }
  })

  it('요소가 빈 sparse 미디어 배열을 차단한다', () => {
    const sparseMedia = new Array<ApprovalCandidate['media'][number]>(1)

    expect(
      unmetKeys(evaluateApprovalRequirements(candidate({ media: sparseMedia }))),
    ).toEqual(['media'])
  })

  it('역할을 한 번만 읽고 첫 viewer snapshot을 기준으로 권한을 차단한다', () => {
    const roles: WorkspaceRole[] = ['viewer', 'viewer', 'reviewer']
    let roleReads = 0
    const input = Object.defineProperty(candidate(), 'role', {
      configurable: true,
      get() {
        const role = roles[Math.min(roleReads, roles.length - 1)]
        roleReads += 1
        return role
      },
    })

    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['approvalPermission'])
    expect(roleReads).toBe(1)
  })

  it('필수 고지 필드를 각각 한 번만 읽고 첫 snapshot으로 공백 고지를 차단한다', () => {
    const requiredValues = [true, false]
    const disclosureValues = [' ', '나중에 바뀐 고지']
    let requiredReads = 0
    let disclosureReads = 0
    const input = Object.defineProperties(candidate(), {
      disclosureRequired: {
        configurable: true,
        get() {
          const required = requiredValues[Math.min(requiredReads, requiredValues.length - 1)]
          requiredReads += 1
          return required
        },
      },
      disclosure: {
        configurable: true,
        get() {
          const disclosure =
            disclosureValues[Math.min(disclosureReads, disclosureValues.length - 1)]
          disclosureReads += 1
          return disclosure
        },
      },
    })

    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['disclosure'])
    expect(requiredReads).toBe(1)
    expect(disclosureReads).toBe(1)
  })

  it('미디어 collection을 한 번만 읽고 첫 invalid snapshot을 차단한다', () => {
    const invalidMedia = [{ id: '', isValid: false }]
    const validMedia = [{ id: 'media-1', isValid: true }]
    const collections = [invalidMedia, validMedia, validMedia]
    let mediaReads = 0
    const input = Object.defineProperty(candidate(), 'media', {
      configurable: true,
      get() {
        const media = collections[Math.min(mediaReads, collections.length - 1)]
        mediaReads += 1
        return media
      },
    })

    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['media'])
    expect(mediaReads).toBe(1)
  })

  it.each([
    ['음수', -1],
    ['NaN', Number.NaN],
    ['0 문자열', '0'],
    ['false', false],
    ['null', null],
    ['undefined', undefined],
  ])('빈 배열의 비정상 length %s을 한 번만 읽고 차단한다', (_label, malformedLength) => {
    let lengthReads = 0
    const media = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1
          return malformedLength
        }

        return Reflect.get(target, property, receiver)
      },
    }) as unknown as ApprovalCandidate['media']

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect(lengthReads).toBe(1)
    expect(unmetKeys(result)).toEqual(['media'])
  })

  it.each([
    ['0.5 숫자', 0.5],
    ['1 문자열', '1'],
    ['true', true],
  ])(
    '유효한 항목이 있어도 비정상 length %s을 한 번만 읽고 차단한다',
    (_label, malformedLength) => {
      let lengthReads = 0
      const media = new Proxy([{ id: 'media-1', isValid: true }], {
        get(target, property, receiver) {
          if (property === 'length') {
            lengthReads += 1
            return malformedLength
          }

          return Reflect.get(target, property, receiver)
        },
      }) as unknown as ApprovalCandidate['media']

      const result = evaluateApprovalRequirements(candidate({ media }))

      expect(lengthReads).toBe(1)
      expect(unmetKeys(result)).toEqual(['media'])
    },
  )

  it('길이를 1로 줄여도 관찰 가능한 두 번째 invalid index를 누락하지 않는다', () => {
    let lengthReads = 0
    let ownKeysReads = 0
    const media = new Proxy(
      [
        { id: 'media-1', isValid: true },
        { id: 'media-2', isValid: false },
      ],
      {
        get(target, property, receiver) {
          if (property === 'length') {
            lengthReads += 1
            return 1
          }

          return Reflect.get(target, property, receiver)
        },
        ownKeys(target) {
          ownKeysReads += 1
          return Reflect.ownKeys(target)
        },
      },
    )

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect.soft(unmetKeys(result)).toEqual(['media'])
    expect.soft(lengthReads).toBe(1)
    expect(ownKeysReads).toBe(1)
  })

  it('길이를 2로 줄여도 관찰 가능한 세 번째 invalid index를 누락하지 않는다', () => {
    let lengthReads = 0
    let ownKeysReads = 0
    const media = new Proxy(
      [
        { id: 'media-1', isValid: true },
        { id: 'media-2', isValid: true },
        { id: 'media-3', isValid: false },
      ],
      {
        get(target, property, receiver) {
          if (property === 'length') {
            lengthReads += 1
            return 2
          }

          return Reflect.get(target, property, receiver)
        },
        ownKeys(target) {
          ownKeysReads += 1
          return Reflect.ownKeys(target)
        },
      },
    )

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect.soft(unmetKeys(result)).toEqual(['media'])
    expect.soft(lengthReads).toBe(1)
    expect(ownKeysReads).toBe(1)
  })

  it('snapshot index 0·2 이후 누락된 index 1을 조작해도 out-of-range invalid를 숨기지 못한다', () => {
    const fabricatedItem = { id: 'media-fabricated', isValid: true }
    const target = [
      { id: 'media-1', isValid: true },
      undefined,
      { id: 'media-3', isValid: false },
    ]
    delete target[1]
    let lengthReads = 0
    let ownKeysReads = 0
    let fabricatedDescriptorReads = 0
    let fabricatedItemReads = 0
    const media = new Proxy(target, {
      get(proxyTarget, property, receiver) {
        if (property === 'length') {
          lengthReads += 1
          return 2
        }
        if (property === '1') {
          fabricatedItemReads += 1
          return fabricatedItem
        }

        return Reflect.get(proxyTarget, property, receiver)
      },
      ownKeys() {
        ownKeysReads += 1
        return ['0', '2', 'length']
      },
      getOwnPropertyDescriptor(proxyTarget, property) {
        if (property === '1') {
          fabricatedDescriptorReads += 1
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: fabricatedItem,
          }
        }

        return Reflect.getOwnPropertyDescriptor(proxyTarget, property)
      },
    }) as unknown as ApprovalCandidate['media']

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect.soft(unmetKeys(result)).toEqual(['media'])
    expect.soft(lengthReads).toBe(1)
    expect.soft(ownKeysReads).toBe(1)
    expect.soft(fabricatedDescriptorReads).toBe(0)
    expect(fabricatedItemReads).toBe(0)
  })

  it('snapshot index 1·2 이후 누락된 index 0을 조작해도 out-of-range invalid를 숨기지 못한다', () => {
    const fabricatedItem = { id: 'media-fabricated', isValid: true }
    const target = [
      undefined,
      { id: 'media-2', isValid: true },
      { id: 'media-3', isValid: false },
    ]
    delete target[0]
    let lengthReads = 0
    let ownKeysReads = 0
    let fabricatedDescriptorReads = 0
    let fabricatedItemReads = 0
    const media = new Proxy(target, {
      get(proxyTarget, property, receiver) {
        if (property === 'length') {
          lengthReads += 1
          return 2
        }
        if (property === '0') {
          fabricatedItemReads += 1
          return fabricatedItem
        }

        return Reflect.get(proxyTarget, property, receiver)
      },
      ownKeys() {
        ownKeysReads += 1
        return ['1', '2', 'length']
      },
      getOwnPropertyDescriptor(proxyTarget, property) {
        if (property === '0') {
          fabricatedDescriptorReads += 1
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: fabricatedItem,
          }
        }

        return Reflect.getOwnPropertyDescriptor(proxyTarget, property)
      },
    }) as unknown as ApprovalCandidate['media']

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect.soft(unmetKeys(result)).toEqual(['media'])
    expect.soft(lengthReads).toBe(1)
    expect.soft(ownKeysReads).toBe(1)
    expect.soft(fabricatedDescriptorReads).toBe(0)
    expect(fabricatedItemReads).toBe(0)
  })

  it('snapshot index 0·1이 역순으로 반환돼도 순서와 무관하게 정상 미디어를 허용한다', () => {
    let ownKeysReads = 0
    const media = new Proxy(
      [
        { id: 'media-1', isValid: true },
        { id: 'media-2', isValid: true },
      ],
      {
        ownKeys() {
          ownKeysReads += 1
          return ['1', '0', 'length']
        },
      },
    )

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect(unmetKeys(result)).toEqual([])
    expect(ownKeysReads).toBe(1)
  })

  it('숫자 index가 아닌 own key와 hostile every는 무시하고 정상 미디어를 허용한다', () => {
    const metadataKey = Symbol('media-metadata')
    let everyCalls = 0
    let ownKeysReads = 0
    const target = [{ id: 'media-1', isValid: true }]

    Object.defineProperties(target, {
      metadata: { configurable: true, value: 'ignored' },
      '01': { configurable: true, value: 'ignored' },
      '-1': { configurable: true, value: 'ignored' },
      '1.0': { configurable: true, value: 'ignored' },
      '4294967295': { configurable: true, value: 'ignored' },
      every: {
        configurable: true,
        value: () => {
          everyCalls += 1
          throw new Error('hostile every must not run')
        },
      },
    })
    Object.defineProperty(target, metadataKey, { configurable: true, value: 'ignored' })

    const media = new Proxy(target, {
      ownKeys(proxyTarget) {
        ownKeysReads += 1
        return Reflect.ownKeys(proxyTarget)
      },
    })

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect(unmetKeys(result)).toEqual([])
    expect(ownKeysReads).toBe(1)
    expect(everyCalls).toBe(0)
  })

  it('JavaScript 배열 최대를 초과한 길이는 ownKeys나 item loop 전에 차단한다', () => {
    let lengthReads = 0
    let ownKeysReads = 0
    let ownIndexChecks = 0
    const media = new Proxy([], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1
          return 2 ** 32
        }

        return Reflect.get(target, property, receiver)
      },
      ownKeys(target) {
        ownKeysReads += 1
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === '0') ownIndexChecks += 1
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    }) as unknown as ApprovalCandidate['media']

    const result = evaluateApprovalRequirements(candidate({ media }))

    expect(unmetKeys(result)).toEqual(['media'])
    expect(lengthReads).toBe(1)
    expect(ownKeysReads).toBe(0)
    expect(ownIndexChecks).toBe(0)
  })

  it('미디어 항목의 id와 isValid를 각각 한 번만 읽고 첫 값으로 차단한다', () => {
    const idValues = ['', 'media-1']
    let idReads = 0
    let validityReads = 0
    const mediaItem = Object.defineProperties({}, {
      id: {
        configurable: true,
        get() {
          const id = idValues[Math.min(idReads, idValues.length - 1)]
          idReads += 1
          return id
        },
      },
      isValid: {
        configurable: true,
        get() {
          validityReads += 1
          return true
        },
      },
    })
    const input = candidate({
      media: [mediaItem] as unknown as ApprovalCandidate['media'],
    })

    expect(unmetKeys(evaluateApprovalRequirements(input))).toEqual(['media'])
    expect(idReads).toBe(1)
    expect(validityReads).toBe(1)
  })

  it('여러 조건이 동시에 실패해도 단락 없이 여섯 결과를 모두 반환한다', () => {
    const result = evaluateApprovalRequirements(
      candidate({
        isLatestVersion: false,
        role: 'viewer',
        rightsConfirmed: false,
        generationEvidenceConfirmed: false,
        disclosureRequired: true,
        disclosure: ' ',
        media: [],
      }),
    )

    expect(result.map(({ key }) => key)).toEqual(requirementKeys)
    expect(unmetKeys(result)).toEqual(requirementKeys)
    expect(result).toEqual([
      {
        key: 'latestVersion',
        met: false,
        message: '최신 버전을 다시 확인해 주세요.',
      },
      {
        key: 'approvalPermission',
        met: false,
        message: '콘텐츠 승인 권한을 확인해 주세요.',
      },
      {
        key: 'rights',
        met: false,
        message: '콘텐츠 사용권을 확인해 주세요.',
      },
      {
        key: 'evidence',
        met: false,
        message: '자동 생성 증빙을 확인해 주세요.',
      },
      {
        key: 'disclosure',
        met: false,
        message: '필수 고지 내용을 입력해 주세요.',
      },
      {
        key: 'media',
        met: false,
        message: '미디어를 하나 이상 추가하고 모두 유효한지 확인해 주세요.',
      },
    ])
  })

  it('각 호출마다 새 결과를 만들어 이전 결과 변경이 다음 호출에 영향을 주지 않는다', () => {
    const first = evaluateApprovalRequirements(candidate())
    first[0].met = false
    first[0].message = '이전 호출에서 변경됨'
    first.push({ key: 'media', met: false, message: '추가됨' })

    const second = evaluateApprovalRequirements(candidate())

    expect(second).toEqual(allMetRequirements)
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])
  })

  it('깊게 고정된 입력과 미디어를 변경하지 않는다', () => {
    const mediaItem = Object.freeze({ id: 'media-1', isValid: true })
    const media = Object.freeze([mediaItem])
    const input = Object.freeze({
      isLatestVersion: true,
      role: 'reviewer' as const,
      rightsConfirmed: true,
      generationEvidenceConfirmed: true,
      disclosureRequired: true,
      disclosure: '자동 생성 콘텐츠입니다.',
      media,
    }) satisfies ApprovalCandidate

    expect(() => evaluateApprovalRequirements(input)).not.toThrow()
    expect(evaluateApprovalRequirements(input)).toEqual(allMetRequirements)
    expect(input.media).toEqual([{ id: 'media-1', isValid: true }])
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.media)).toBe(true)
    expect(Object.isFrozen(input.media[0])).toBe(true)
  })

  it('결과 메시지에 입력 콘텐츠나 내부 상태를 노출하지 않는다', () => {
    const sensitiveInput = '11111111-1111-4111-8111-111111111111'
    const internalRole = 'internal_admin_status'
    const result = evaluateApprovalRequirements(
      candidate({
        role: internalRole as WorkspaceRole,
        disclosureRequired: true,
        disclosure: sensitiveInput,
        media: [{ id: sensitiveInput, isValid: false }],
      }),
    )
    const messages = result.map(({ message }) => message).join(' ')

    expect(messages).not.toContain(sensitiveInput)
    expect(messages).not.toContain(internalRole)
    expect(messages).not.toMatch(/[a-f0-9]{8}-[a-f0-9-]{27,}/i)
  })
})
