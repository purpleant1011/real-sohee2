import { vi } from 'vitest'

/**
 * ANI-1753: 단위 테스트용 Supabase 서버 클라이언트 대역.
 *
 * src/test/setup.ts 는 테스트 프로세스에 loopback Supabase 주소만 주입한다. 그래서 mock 되지 않은
 * createServerSupabaseClient() 호출은 실제 운영 DB가 아니라 연결되지 않는 loopback 으로 요청을 보내고,
 * 테스트는 기본 타임아웃(5s)까지 매달린다. DB 조회 결과가 필요 없는 테스트는 이 대역으로
 * 쿼리를 즉시 빈 결과로 끝내면 된다.
 *
 * 사용(vi.mock 은 파일 최상단으로 호이스팅되므로 팩토리 안에서 동적 import 한다):
 *   vi.mock('@/lib/supabase/server', async () => (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule())
 */
const EMPTY_RESULT = { data: null, error: null, count: null, status: 200, statusText: 'OK' }

const CHAINABLE_METHODS = [
  'select',
  'insert',
  'update',
  'upsert',
  'delete',
  'eq',
  'neq',
  'in',
  'not',
  'is',
  'order',
  'limit',
  'range',
] as const

export function createFakeServerSupabaseClient() {
  const createQuery = () => {
    const query: Record<string, unknown> = {}
    for (const method of CHAINABLE_METHODS) {
      query[method] = () => query
    }
    query.maybeSingle = async () => EMPTY_RESULT
    query.single = async () => EMPTY_RESULT
    // await query 처럼 직접 await 하는 호출도 빈 결과로 끝난다.
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(EMPTY_RESULT).then(resolve, reject)
    return query
  }

  return {
    from: () => createQuery(),
    rpc: async () => EMPTY_RESULT,
  }
}

export function fakeServerSupabaseModule() {
  return {
    createServerSupabaseClient: vi.fn(async () => createFakeServerSupabaseClient()),
  }
}
