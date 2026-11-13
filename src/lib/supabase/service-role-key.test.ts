import { describe, expect, it } from 'vitest'
import { parseServiceRoleKey } from './service-role-key'

describe('parseServiceRoleKey', () => {
  it('accepts only a modern server-side secret key', () => {
    expect(parseServiceRoleKey('sb_secret_test-only-value')).toBe('sb_secret_test-only-value')
  })

  it.each([
    undefined,
    '',
    'sb_publishable_browser-key',
    'eyJhbGciOiJIUzI1NiJ9.service_role.signature',
    'sb_secret_한글',
  ])('rejects a missing or unsafe server key without echoing it: %s', (value) => {
    expect(() => parseServiceRoleKey(value)).toThrow(
      '서버 전용 Supabase 비밀키가 설정되지 않았습니다.',
    )
  })
})
