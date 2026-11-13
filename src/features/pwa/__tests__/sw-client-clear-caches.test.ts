import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPwaCaches } from '../sw-client'

/**
 * ANI-1722: 로그아웃·매장(워크스페이스) 전환 시 PWA 캐시 정리.
 * - 제어 중인 워커가 있으면 public/sw.js 의 CLEAR_CACHES 계약으로 위임한다.
 * - 워커가 없으면 CacheStorage 에서 sohee-* 캐시만 직접 삭제한다.
 * - 정리 실패는 로그아웃·전환을 막지 않도록 reject 하지 않는다.
 */

const postMessage = vi.fn()

function installServiceWorker(controller: { postMessage: () => void } | null) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller },
  })
}

function installCaches(keys: string[]) {
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => keys),
    delete: vi.fn(async (key: string) => {
      deleted.push(key)
      return true
    }),
  })
  return deleted
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('clearPwaCaches', () => {
  it('제어 중인 워커가 있으면 CLEAR_CACHES 메시지로 위임한다', async () => {
    installServiceWorker({ postMessage })
    const keys = vi.fn(async () => ['sohee-static-sohee-sw-v1'])
    vi.stubGlobal('caches', { keys, delete: vi.fn() })

    await clearPwaCaches()

    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_CACHES' })
    expect(keys).not.toHaveBeenCalled()
  })

  it('워커가 없으면 sohee-* 캐시만 직접 삭제한다', async () => {
    installServiceWorker(null)
    const deleted = installCaches(['sohee-static-sohee-sw-v1', 'third-party-cache', 'sohee-runtime-v1'])

    await clearPwaCaches()

    expect(deleted).toEqual(['sohee-static-sohee-sw-v1', 'sohee-runtime-v1'])
  })

  it('서비스 워커 API 가 없어도 이전 등록이 남긴 캐시는 직접 정리한다', async () => {
    const deleted = installCaches(['sohee-static-sohee-sw-v1'])

    await clearPwaCaches()

    expect(deleted).toEqual(['sohee-static-sohee-sw-v1'])
  })

  it('CacheStorage 조회가 실패해도 reject 하지 않는다', async () => {
    installServiceWorker(null)
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => {
        throw new Error('quota exceeded')
      }),
      delete: vi.fn(),
    })

    await expect(clearPwaCaches()).resolves.toBeUndefined()
  })

  it('워커 postMessage 가 던져도 reject 하지 않는다', async () => {
    installServiceWorker({
      postMessage: () => {
        throw new Error('detached worker')
      },
    })

    await expect(clearPwaCaches()).resolves.toBeUndefined()
  })
})
