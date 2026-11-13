import { describe, expect, it, vi } from 'vitest'
import { sanitizeNotificationBody } from './safe-notification-body'

const generalReplacement = '관련 작업의 처리 상태를 확인해 주세요.'
const publishReplacement = '게시 처리 상태를 확인해 주세요.'

describe('sanitizeNotificationBody', () => {
  it('replaces the plan example without returning the token value', () => {
    const input = 'token=secret-value 게시 실패'

    const result = sanitizeNotificationBody(input)

    expect(result).toBe(publishReplacement)
    expect(result).not.toContain('secret-value')
  })

  it.each([
    'ToKeN=sample-value',
    'AcCeSs-ToKeN: sample-value',
    'ReFrEsH.ToKeN/sample-value',
    'AuThOrIzAtIoN=sample-value',
    'BeArEr sample-value',
    'PaSsWoRd=sample-value',
    'PaSsWd=sample-value',
    'SeCrEt=sample-value',
    'ApI-KeY=sample-value',
    'ApIkEy=sample-value',
    'CrEdEnTiAl=sample-value',
    'CoOkIe=sample-value',
    'SeSsIoN=sample-value',
    'PrIvAtE/KeY=sample-value',
    'ClIeNt:SeCrEt=sample-value',
  ])('rejects the mixed-case sensitive label family in %j', (sensitiveText) => {
    const result = sanitizeNotificationBody(`작업 실패: ${sensitiveText}`)

    expect(result).toBe(generalReplacement)
    expect(result).not.toContain('sample-value')
  })

  it.each([
    '비밀번호=sample-value',
    '접근-토큰=sample-value',
    '인증_토큰=sample-value',
    '비밀/키=sample-value',
  ])('rejects the Korean credential label in %j', (sensitiveText) => {
    const result = sanitizeNotificationBody(`작업 실패: ${sensitiveText}`)

    expect(result).toBe(generalReplacement)
    expect(result).not.toContain('sample-value')
  })

  it.each([
    [
      'JWT',
      ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'signature1234567890'].join('.'),
    ],
    ['OpenAI-style prefix', `s${'k-'}${'abc123'.repeat(6)}`],
    ['GitHub classic prefix', `g${'hp_'}${'abc123'.repeat(6)}`],
    ['GitHub fine-grained prefix', `github_${'pat_'}${'abc123'.repeat(6)}`],
    ['long hexadecimal value', 'deadbeef'.repeat(4)],
    ['long opaque value', 'ab12'.repeat(8)],
  ])('rejects a %s without returning the suspected value', (_label, suspectedValue) => {
    const result = sanitizeNotificationBody(`작업 실패 ${suspectedValue}`)

    expect(result).toBe(generalReplacement)
    expect(result).not.toContain(suspectedValue)
  })

  it.each([
    ['three compact base64url segments', 'e30.e30.e30'],
    ['an unsigned compact token', ['eyJhbGciOiJub25lIn0', 'e30', ''].join('.')],
  ])('rejects %s without returning the compact token', (_label, compactToken) => {
    const result = sanitizeNotificationBody(`작업 실패 ${compactToken}`)

    expect(result).toBe(generalReplacement)
    expect(result).not.toContain(compactToken)
  })

  it.each([
    'https://example.invalid/reset?code=abc123',
    'www.example.invalid/reset#code=abc123',
    'mailto:owner@example.invalid',
    '연결 실패 ?code=abc123&state=ready',
    '연결 실패 #code=abc123',
  ])('rejects URL or query/fragment-looking payload %j', (unsafeBody) => {
    expect(sanitizeNotificationBody(unsafeBody)).toBe(generalReplacement)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/plain,hello',
    'tel:+821012345678',
    '//example.xyz/reset/path',
    'example.xyz/path',
    'example.technology/path',
    '192.0.2.1/reset/path',
    'localhost:3000/reset/path',
    '[2001:db8::1]/reset/path',
  ])('rejects the URI or host-shaped payload %j without returning it', (unsafeBody) => {
    const result = sanitizeNotificationBody(unsafeBody)

    expect(result).toBe(generalReplacement)
    expect(result).not.toContain(unsafeBody)
  })

  it('normalizes safe Korean text and returns safe replacements idempotently', () => {
    expect(sanitizeNotificationBody('  새\t승인\n요청이\u00a0도착했어요.  ')).toBe(
      '새 승인 요청이 도착했어요.',
    )
    expect(sanitizeNotificationBody('새 승인 요청이 도착했어요.')).toBe(
      '새 승인 요청이 도착했어요.',
    )
    expect(sanitizeNotificationBody(generalReplacement)).toBe(generalReplacement)
    expect(sanitizeNotificationBody(publishReplacement)).toBe(publishReplacement)
  })

  it('collapses internal Unicode next-line and byte-order-mark whitespace', () => {
    expect(sanitizeNotificationBody('새\u0085승인\ufeff요청')).toBe('새 승인 요청')
  })

  it.each([
    'z'.repeat(32),
    '가'.repeat(32),
    'status: ready',
    '상태 확인이 끝났습니다. 다음 작업을 준비해 주세요.',
    'Version 1.2.3 is ready.',
    'Release v1.2.3 is ready.',
    '앱 버전은 1.2.3입니다.',
    'The secretary confirmed thirty two ordinary items.',
    'Tokenization completed safely.',
    'The obsession check completed normally.',
  ])('does not treat an ordinary sentence as an opaque credential: %j', (safeBody) => {
    expect(sanitizeNotificationBody(safeBody)).toBe(safeBody)
  })

  it('uses only primitive strings without observing coercion hooks or proxies', () => {
    const coercionHook = vi.fn(() => '새 알림')
    const getter = vi.fn(() => '새 알림')
    const throwingProxy = new Proxy(
      {},
      {
        get() {
          throw new Error('must not observe proxy properties')
        },
      },
    )
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    const coercible = {
      [Symbol.toPrimitive]: coercionHook,
      get value() {
        return getter()
      },
    }

    const values: unknown[] = [
      new String('새 알림'),
      coercible,
      throwingProxy,
      revocable.proxy,
      Symbol('새 알림'),
      null,
      undefined,
      123,
      true,
    ]

    expect(values.map((value) => sanitizeNotificationBody(value))).toEqual(
      values.map(() => generalReplacement),
    )
    expect(coercionHook).not.toHaveBeenCalled()
    expect(getter).not.toHaveBeenCalled()
  })

  it.each([
    ['', generalReplacement],
    [' \t\n\u00a0 ', generalReplacement],
    ['가'.repeat(201), generalReplacement],
    ['게시 ' + '가'.repeat(201), publishReplacement],
    ['안전\u0000알림', generalReplacement],
    ['안전\u0080알림', generalReplacement],
    ['안전\u202e알림', generalReplacement],
    ['안전\u2066알림', generalReplacement],
    ['<strong>실패</strong>', generalReplacement],
  ])('falls back for an empty, oversized, control, bidi, or markup body', (input, expected) => {
    expect(sanitizeNotificationBody(input)).toBe(expected)
  })

  it('counts normalized length in UTF-16 code units', () => {
    const twoHundredCodeUnits = '😀'.repeat(100)

    expect(sanitizeNotificationBody(twoHundredCodeUnits)).toBe(twoHundredCodeUnits)
    expect(sanitizeNotificationBody(`${twoHundredCodeUnits}😀`)).toBe(generalReplacement)
  })

  it('rejects the whole oversized input even when a secret-looking value appears after 200 characters', () => {
    const hiddenTail = 'ab12'.repeat(8)
    const result = sanitizeNotificationBody(`${'안'.repeat(201)}${hiddenTail}`)

    expect(result).toBe(generalReplacement)
    expect(result).not.toContain(hiddenTail)
  })

  it('selects the publish replacement only for an unsafe body containing the Korean word 게시', () => {
    expect(sanitizeNotificationBody('게시 실패 <unsafe>')).toBe(publishReplacement)
    expect(sanitizeNotificationBody('승인 실패 <unsafe>')).toBe(generalReplacement)
    expect(sanitizeNotificationBody('게시 준비가 완료됐어요.')).toBe('게시 준비가 완료됐어요.')
  })

  it('returns deterministic results without calling time, randomness, fetch, or crypto APIs', () => {
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })
    const mathRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called')
    })
    const fetchCall = vi.fn(() => {
      throw new Error('fetch must not be called')
    })
    const randomUUID = vi.fn(() => {
      throw new Error('crypto.randomUUID must not be called')
    })
    const getRandomValues = vi.fn(() => {
      throw new Error('crypto.getRandomValues must not be called')
    })

    vi.stubGlobal('fetch', fetchCall)
    vi.stubGlobal('crypto', { randomUUID, getRandomValues })

    try {
      const first = sanitizeNotificationBody('  새 승인 요청이 도착했어요.  ')
      const second = sanitizeNotificationBody('  새 승인 요청이 도착했어요.  ')

      expect(first).toBe('새 승인 요청이 도착했어요.')
      expect(second).toBe(first)
      expect(dateNow).not.toHaveBeenCalled()
      expect(mathRandom).not.toHaveBeenCalled()
      expect(fetchCall).not.toHaveBeenCalled()
      expect(randomUUID).not.toHaveBeenCalled()
      expect(getRandomValues).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      dateNow.mockRestore()
      mathRandom.mockRestore()
    }
  })

  it('returns stable replacements across repeated URL and compact-token checks', () => {
    const unsafeValues = ['javascript:alert(1)', 'example.technology/path', 'e30.e30.e30']

    for (const unsafeValue of unsafeValues) {
      expect(sanitizeNotificationBody(unsafeValue)).toBe(generalReplacement)
      expect(sanitizeNotificationBody(unsafeValue)).toBe(generalReplacement)
      expect(sanitizeNotificationBody(unsafeValue)).toBe(generalReplacement)
    }
  })
})
