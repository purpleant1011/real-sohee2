import { describe, expect, it } from 'vitest'
import { resolveRoute } from './routes'

describe('/app/inbox 라우트 등록', () => {
  it('소통함 루트는 고객 탭으로 잡힌다', () => {
    const route = resolveRoute('/app/inbox')
    expect(route?.pattern).toBe('/app/inbox')
    expect(route?.tab).toBe('customers')
  })

  it('스레드 상세는 고객 탭 DETAIL 로 잡힌다', () => {
    const route = resolveRoute('/app/inbox/t-1')
    expect(route?.pattern).toBe('/app/inbox/:id')
    expect(route?.tab).toBe('customers')
    expect(route?.mode).toBe('DETAIL')
  })

  it('등록되지 않은 경로는 그대로 더보기로 떨어진다', () => {
    expect(resolveRoute('/app/unknown-thing')?.tab).toBe('more')
  })
})
