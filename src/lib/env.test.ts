import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PublicEnvConfigurationError,
  parsePublicEnv,
  readPublicEnv,
  isLoopbackSupabaseUrl,
  LOCAL_E2E_FLAG,
  LOCAL_E2E_PUBLIC_FLAG,
  isLocalE2EEnabled,
} from './env'

describe('parsePublicEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Supabase URL이 없으면 시작을 거부한다', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk' })).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL',
    )
  })

  it('유효한 공개 Supabase 환경값을 반환한다', () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
  })

  it('승인되지 않은 Supabase 프로젝트 URL이면 시작을 거부한다', () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://zkqkqvjijlutyhpxdoed.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it.each([
    'sb_secret_private_key',
    'eyJhbGciOiJIUzI1NiJ9.service_role.signature',
    'plain-text-key',
  ])('비밀키 또는 이전 형식 키를 공개 환경값으로 거부한다: %s', (key) => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow('공개용 Supabase publishable key')
  })

  it('loopback URL + SOHEE_LOCAL_E2E 미설정 시 거부한다 (기존 동작 보존)', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('loopback URL + SOHEE_LOCAL_E2E=1 + NODE_ENV=production 시 거부한다 (프로덕션 빌드 절대 불허)', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('loopback URL + SOHEE_LOCAL_E2E=1 + CF_PAGES=1 시 거부한다 (Cloudflare 절대 불허)', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CF_PAGES', '1')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('loopback URL + SOHEE_LOCAL_E2E=1 + WORKERS_CI=1 시 거부한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('WORKERS_CI', '1')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('SOHEE_LOCAL_E2E=1 + NODE_ENV=development + http://127.0.0.1:56421 은 통과한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
  })

  it('SOHEE_LOCAL_E2E=1 + NODE_ENV=development + http://localhost:56421 은 통과한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:56421',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
  })

  it('SOHEE_LOCAL_E2E=1 + NODE_ENV=development + http://[::1]:56421 은 통과한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:56421',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
  })

  it('SOHEE_LOCAL_E2E=1 + NODE_ENV=development 에서도 임의 외부 URL은 거부한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://evil.example.com',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('SOHEE_LOCAL_E2E=1 + dev 에서도 운영 URL은 통과한다 (운영 핀 유지)', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
  })
  it('서버 플래그 없이 NEXT_PUBLIC_SOHEE_LOCAL_E2E=1 + NODE_ENV=development + loopback 은 통과한다 (브라우저 시나리오)', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '')
    vi.stubEnv('NEXT_PUBLIC_SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
  })

  it('NEXT_PUBLIC_SOHEE_LOCAL_E2E=1 + NODE_ENV=production + loopback 은 거부한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '')
    vi.stubEnv('NEXT_PUBLIC_SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('두 플래그 모두 없음 + loopback 은 거부한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '')
    vi.stubEnv('NEXT_PUBLIC_SOHEE_LOCAL_E2E', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })

  it('NEXT_PUBLIC_SOHEE_LOCAL_E2E=1 + CF_PAGES=1 은 거부한다', () => {
    vi.stubEnv('SOHEE_LOCAL_E2E', '')
    vi.stubEnv('NEXT_PUBLIC_SOHEE_LOCAL_E2E', '1')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CF_PAGES', '1')
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56421',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
      }),
    ).toThrow('승인된 Supabase 프로젝트가 아닙니다')
  })
})

describe('readPublicEnv', () => {
  it('공개 설정이 비어 있어도 내부 환경 변수명을 노출하지 않는 안전한 오류로 변환한다', () => {
    expect.assertions(3)

    try {
      readPublicEnv({})
    } catch (error) {
      expect(error).toBeInstanceOf(PublicEnvConfigurationError)
      expect(error).toMatchObject({ code: 'PUBLIC_ENV_UNAVAILABLE' })
      expect(String(error)).not.toContain('NEXT_PUBLIC_SUPABASE_URL')
    }
  })
})

describe('isLoopbackSupabaseUrl', () => {
  it('loopback URL을 올바르게 판정한다', () => {
    expect(isLoopbackSupabaseUrl('http://127.0.0.1:56421')).toBe(true)
    expect(isLoopbackSupabaseUrl('http://localhost:1')).toBe(true)
    expect(isLoopbackSupabaseUrl('http://[::1]:54321')).toBe(true)
    expect(isLoopbackSupabaseUrl('https://evil.example.com')).toBe(false)
    expect(isLoopbackSupabaseUrl('not-a-url')).toBe(false)
    expect(isLoopbackSupabaseUrl('ftp://127.0.0.1')).toBe(false)
  })
})
