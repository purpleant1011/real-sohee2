import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUPABASE_PROJECT_REF } from '@/lib/env'

/**
 * ANI-1753 회귀 가드.
 *
 * src/test/setup.ts 는 단위 테스트 프로세스에 loopback Supabase 주소와 더미 키만 주입해야 한다.
 * 과거에는 NEXT_PUBLIC_SUPABASE_URL 기본값이 운영 프로젝트 URL이었고, service_role 키가 없으면
 * macOS 키체인에서 운영 비밀키를 꺼내 주입했다. 그 결과 mock 되지 않은 DB 클라이언트가
 * 운영 Supabase 로 실제 요청을 보냈다.
 *
 * 이 테스트는 setup.ts 가 다시 운영 자격증명을 주입하도록 되돌아가는 회귀를 잡는다.
 */

// setup.ts 가 주입하는 더미 키. sb_secret_ 접두사는 필요하지만(parseServiceRoleKey 규칙) 실제 비밀값이 아니다.
const DUMMY_SERVICE_ROLE_KEY = 'sb_secret_test_mock_token_12345'
const DUMMY_PUBLISHABLE_KEY = 'sb_publishable_test_mock_token_12345'
const PRODUCTION_PROJECT_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** JWT payload 에 role=service_role 이 들어 있으면 운영 비밀키다. */
function isServiceRoleJwt(value: string): boolean {
  if (!value.startsWith('eyJ')) return false
  const parts = value.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { role?: unknown }
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

function isSupabaseSecretKey(value: string): boolean {
  return /^sb_secret_[A-Za-z0-9._-]+$/.test(value) && value !== DUMMY_SERVICE_ROLE_KEY
}

function isProductionCredential(value: string): boolean {
  return (
    value.includes(SUPABASE_PROJECT_REF) ||
    isSupabaseSecretKey(value) ||
    isServiceRoleJwt(value)
  )
}

describe('단위 테스트 프로세스는 운영 Supabase 자격증명을 갖지 않는다 (ANI-1753)', () => {
  it('NEXT_PUBLIC_SUPABASE_URL 은 loopback 이고 운영 프로젝트를 가리키지 않는다', () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    expect(url).not.toContain(SUPABASE_PROJECT_REF)
    expect(url).not.toBe(PRODUCTION_PROJECT_URL)
    expect(isLoopbackUrl(url)).toBe(true)
  })

  it('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / ANON_KEY 는 더미 값이다', () => {
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
    expect(publishable).toBe(DUMMY_PUBLISHABLE_KEY)
    expect(isProductionCredential(publishable)).toBe(false)

    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    expect(anon).not.toContain(SUPABASE_PROJECT_REF)
    expect(isServiceRoleJwt(anon)).toBe(false)
  })

  it('SUPABASE_SERVICE_ROLE_KEY 는 더미 placeholder 이며 실제 service_role 자격증명이 아니다', () => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    expect(key).toBe(DUMMY_SERVICE_ROLE_KEY)
    expect(isProductionCredential(key)).toBe(false)
  })

  it('Supabase/DB 관련 환경변수 어디에도 운영 프로젝트 ref·sb_secret_·service_role JWT 가 없다', () => {
    const supabaseRelated = /^(NEXT_PUBLIC_)?(SUPABASE|POSTGRES|DATABASE)/i
    const offenders: string[] = []
    for (const [name, value] of Object.entries(process.env)) {
      if (!supabaseRelated.test(name)) continue
      if (typeof value !== 'string' || value.length === 0) continue
      if (isProductionCredential(value)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })

  it('setup.ts 소스에 운영 URL 기본값과 키체인 조회가 남아 있지 않다', () => {
    // vitest 는 저장소 루트를 cwd 로 실행한다.
    const setupSource = readFileSync(resolve(process.cwd(), 'src/test/setup.ts'), 'utf8')
    expect(setupSource).not.toContain(SUPABASE_PROJECT_REF)
    expect(setupSource).not.toContain('find-generic-password')
    expect(setupSource).not.toContain('security')
    expect(setupSource).not.toContain('child_process')
  })

  it('테스트 Supabase 엔드포인트로 나가는 실제 fetch 는 즉시 차단된다', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const violationsSymbol = Symbol.for('sohee.test.supabaseNetworkGuardViolations')

    try {
      // 가드가 설치돼 있으면 네트워크로 나가지 않고 명시적 오류로 끝난다.
      await expect(fetch(`${url}/rest/v1/health`)).rejects.toThrow(/ANI-1753/)
    } finally {
      // 이 테스트는 가드를 의도적으로 발동시키므로 setup.ts 의 afterEach 위반 기록을 비운다.
      // (다른 테스트의 위반 기록은 그대로 남아 정상적으로 실패 처리된다.)
      // 주의: 위반 배열은 첫 위반 때 생성되므로 여기서 다시 조회해야 한다.
      const violations = (globalThis as any)[violationsSymbol] as string[] | undefined
      if (Array.isArray(violations)) violations.length = 0
    }
  })

  /**
   * 실제 네트워크 호출 금지 가드.
   *
   * setup.ts 가 URL 을 loopback 으로 강제한 뒤, Supabase 클라이언트를 mock 없이 호출하던 테스트들이
   * ECONNREFUSED 로 깨졌다(CI run 39888106148: engagement page, agent-loop-progress,
   * commercial-onboarding-first-mission, service-admin-same-truth).
   * 그 테스트들은 "실제 DB 를 기대"하거나 "운영 URL 이라 우연히 통과"하던 케이스였다.
   * 여기서는 그 부류가 다시 들어오지 않도록 정적으로 고정한다:
   * Supabase 서버/어드민 클라이언트를 쓰는 테스트 파일은 반드시 mock 또는 spy 를 가져야 한다.
   */
  it('Supabase 서버/어드민 클라이언트를 쓰는 테스트는 반드시 mock 또는 spy 를 갖는다', () => {
    const root = process.cwd()
    const testFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = resolve(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) testFiles.push(full)
      }
    }
    walk(resolve(root, 'src'))
    walk(resolve(root, 'tests'))

    const unmocked: string[] = []
    for (const file of testFiles) {
      const source = readFileSync(file, 'utf8')
      const callsClient = /(createServerSupabaseClient|createAdminSupabaseClient)\s*\(/.test(source)
      const importsClient = /from\s+['"]@\/lib\/supabase\/(server|admin)['"]/.test(source)
      if (!callsClient && !importsClient) continue

      const mocksServer = /vi\.mock\(\s*['"]@\/lib\/supabase\/server/.test(source)
      const mocksAdmin = /vi\.mock\(\s*['"]@\/lib\/supabase\/admin/.test(source)
      const spiesClient =
        /spyOn\([^)]*['"]create(Server|Admin)SupabaseClient['"]/.test(source)
      const stubsFetch = /stubGlobal\(\s*['"]fetch['"]/.test(source)

      if (!mocksServer && !mocksAdmin && !spiesClient && !stubsFetch) {
        unmocked.push(relative(root, file))
      }
    }

    expect(unmocked).toEqual([])
  })
})
