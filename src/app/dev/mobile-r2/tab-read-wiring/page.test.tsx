import { afterEach, describe, expect, it, vi } from 'vitest'

const { notFound } = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error('404') }) }))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('./harness', () => ({ TabReadWiringHarness: () => null }))
import Page from './page'

afterEach(() => vi.unstubAllEnvs())

describe('탭 조회 검증 화면 경계', () => {
  it('운영에서는 404로 닫는다', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(Page({ searchParams: Promise.resolve({ tab: 'customers' }) })).rejects.toThrow('404')
  })
  it('개발에서도 알 수 없는 탭은 열지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await expect(Page({ searchParams: Promise.resolve({ tab: 'invalid' }) })).rejects.toThrow('404')
  })
  it('개발에서만 선택한 실제 조회 컴포넌트를 연결한다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const result = await Page({ searchParams: Promise.resolve({ tab: 'results' }) })
    expect(result.props.tab).toBe('results')
  })
})
