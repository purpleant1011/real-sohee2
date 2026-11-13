import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, expect, vi } from 'vitest'
import { config as loadDotenv } from 'dotenv'
import { MotionGlobalConfig } from 'motion/react'

// 퇴장 애니메이션이 jsdom에서 요소 제거를 지연시키지 않도록 한다.
MotionGlobalConfig.skipAnimations = true

loadDotenv({ path: '.env.local' })
loadDotenv({ path: '.env' })

vi.mock('server-only', () => ({}))

// Legacy publish tests exercise real-write paths; the staged-rollout allowlist is controlled explicitly in its own tests.
process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'

// ANI-1753: 단위 테스트 프로세스는 운영 Supabase에 절대 연결되지 않는다.
// 과거에는 NEXT_PUBLIC_SUPABASE_URL 기본값이 운영 프로젝트 URL이었고, service_role 키가
// 없으면 macOS 키체인에서 운영 비밀키를 꺼내 주입했다. 그 결과 mock 되지 않은
// createServerSupabaseClient() 호출이 운영 DB로 실제 요청을 보내고 테스트가 타임아웃됐다.
// 이제는 loopback 값만 강제로 주입한다. .env/.env.local 에 운영 값이 있어도 덮어쓴다.
const TEST_SUPABASE_URL = 'http://127.0.0.1:54321'
const TEST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_mock_token_12345'
const TEST_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-anon-key'
const TEST_SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_mock_token_12345'

process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_SUPABASE_URL
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = TEST_SUPABASE_PUBLISHABLE_KEY
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = TEST_SUPABASE_ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SUPABASE_SERVICE_ROLE_KEY
// src/lib/env.ts 는 loopback URL 을 로컬 E2E 플래그가 켜져 있을 때만 허용한다.
process.env.SOHEE_LOCAL_E2E = '1'

// ANI-1753: 테스트가 Supabase 엔드포인트로 실제 네트워크 요청을 보내면 즉시 실패시킨다.
// mock 없는 createServerSupabaseClient() 호출은 5초 타임아웃까지 매달린 뒤 ECONNREFUSED 로
// 끝나 원인을 찾기 어려웠다. 이 가드는 그 자리에서 "mock 을 추가하라"는 메시지로 끊는다.
// (SOHEE_LOCAL_SUPABASE_TESTS=1 로 진짜 로컬 스택을 쓰는 경우에는 개입하지 않는다.)
const TEST_SUPABASE_HOST = new URL(TEST_SUPABASE_URL).host
const guardInstalledFlag = Symbol.for('sohee.test.supabaseNetworkGuard')
const violationsFlag = Symbol.for('sohee.test.supabaseNetworkGuardViolations')

/**
 * 위반 기록. 백그라운드(fire-and-forget) 요청은 그 예외를 아무도 await 하지 않으므로
 * reject 만으로는 "조용한 unhandled rejection → 워커 exit code 1" 이 된다.
 * 그래서 (1) 호출자에게는 reject 를 그대로 돌려주고, (2) 동시에 위반을 기록해
 * afterEach 에서 그 테스트를 명시적으로 실패시킨다. 테스트 실패는 정상적인 실패 경로라
 * 프로세스 종료코드를 오염시키지 않는다.
 */
function recordSupabaseGuardViolation(message: string): void {
  const store = ((globalThis as any)[violationsFlag] ??= [] as string[])
  store.push(message)
}

if (!(globalThis as any)[guardInstalledFlag]) {
  ;(globalThis as any)[guardInstalledFlag] = true
  const originalFetch = globalThis.fetch

  const resolveUrl = (input: unknown): string | null => {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.href
    if (input && typeof input === 'object' && 'url' in (input as { url?: unknown })) {
      const url = (input as { url?: unknown }).url
      return typeof url === 'string' ? url : null
    }
    return null
  }

  globalThis.fetch = function guardedFetch(input: unknown, init?: unknown) {
    const localSupabaseAllowed = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
    if (!localSupabaseAllowed) {
      const target = resolveUrl(input)
      if (target) {
        try {
          if (new URL(target).host === TEST_SUPABASE_HOST) {
            const message =
              `[ANI-1753] 테스트가 Supabase 엔드포인트(${TEST_SUPABASE_HOST})로 실제 요청을 보냈습니다. ` +
              `네트워크 없이 결정적으로 통과해야 하므로 vi.mock('@/lib/supabase/server') ` +
              `또는 tests/unit/helpers/fake-supabase-server.ts 대역을 추가하세요.`
            recordSupabaseGuardViolation(message)
            const rejection = Promise.reject(new Error(message))
            // 호출자가 await 하지 않는 경로에서도 unhandled rejection 이 되지 않게 한다.
            // (원래 promise 는 그대로 reject 상태이므로 await 하는 호출자는 오류를 본다.)
            rejection.catch(() => {})
            return rejection
          }
        } catch {
          // 상대 URL 등 파싱 불가 입력은 원래 fetch 로 넘긴다.
        }
      }
    }
    return originalFetch(input as any, init as any)
  } as typeof globalThis.fetch
}

afterEach(() => {
  cleanup()

  // 위반이 있으면 그 테스트를 명시적으로 실패시킨다. throw 대신 단언 실패를 쓴다:
  // throw 는 "테스트 밖 오류"로 보고되어 워커 종료코드를 오염시킬 수 있지만,
  // expect 실패는 정상적인 테스트 실패 경로로 처리된다.
  const store = ((globalThis as any)[violationsFlag] ?? []) as string[]
  if (store.length > 0) {
    const messages = [...store]
    store.length = 0
    expect(messages).toEqual([])
  }
})
