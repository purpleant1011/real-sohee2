import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  loadKakaoSdk,
  KAKAO_SDK_URL,
  KAKAO_SDK_INTEGRITY,
  resetKakaoSdkLoaderForTesting,
} from './load-kakao-sdk'

describe('loadKakaoSdk', () => {
  beforeEach(() => {
    resetKakaoSdkLoaderForTesting()
    delete (window as unknown as { Kakao?: unknown }).Kakao
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetKakaoSdkLoaderForTesting()
    delete (window as unknown as { Kakao?: unknown }).Kakao
  })

  it('SSR 환경(window undefined)에서는 window 접근 없이 실패 결과를 반환해야 한다', async () => {
    const result = await loadKakaoSdk({
      jsKey: 'test-js-key',
      targetWindow: undefined,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('SSR')
    }
  })

  it('jsKey가 비어있거나 없으면 실패 결과를 반환해야 한다', async () => {
    const resultNoKey = await loadKakaoSdk({ jsKey: '' })
    expect(resultNoKey.ok).toBe(false)
    if (!resultNoKey.ok) {
      expect(resultNoKey.reason).toContain('jsKey')
    }

    const resultUndefinedKey = await loadKakaoSdk({})
    expect(resultUndefinedKey.ok).toBe(false)
    if (!resultUndefinedKey.ok) {
      expect(resultUndefinedKey.reason).toContain('jsKey')
    }
  })

  it('정상 로드 시 공식 SDK v2 URL과 무결성 해시로 loader를 호출하고 Kakao.init을 1회 실행해야 한다', async () => {
    let initialized = false
    let passedKey = ''
    const mockKakao = {
      init: vi.fn((key: string) => {
        initialized = true
        passedKey = key
      }),
      isInitialized: vi.fn(() => initialized),
      Channel: {
        addChannel: vi.fn(),
      },
    }

    const mockLoader = vi.fn(async (url: string, integrity: string) => {
      expect(url).toBe(KAKAO_SDK_URL)
      expect(integrity).toBe(KAKAO_SDK_INTEGRITY)
      window.Kakao = mockKakao
    })

    const result = await loadKakaoSdk({
      jsKey: 'valid-kakao-key',
      loader: mockLoader,
    })

    expect(result.ok).toBe(true)
    expect(mockLoader).toHaveBeenCalledTimes(1)
    expect(passedKey).toBe('valid-kakao-key')
    expect(mockKakao.init).toHaveBeenCalledWith('valid-kakao-key')
    expect(mockKakao.init).toHaveBeenCalledTimes(1)
    if (result.ok) {
      expect(result.kakao).toBe(mockKakao)
    }
  })

  it('이미 Kakao가 초기화되어 있으면 중복 로드나 중복 init을 수행하지 않아야 한다', async () => {
    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Channel: {
        addChannel: vi.fn(),
      },
    }
    window.Kakao = mockKakao

    const mockLoader = vi.fn()

    const result = await loadKakaoSdk({
      jsKey: 'valid-kakao-key',
      loader: mockLoader,
    })

    expect(result.ok).toBe(true)
    expect(mockLoader).not.toHaveBeenCalled()
    expect(mockKakao.init).not.toHaveBeenCalled()
  })

  it('동시에 여러 번 로드 요청이 들어와도 loader를 1회만 호출해야 한다 (중복 로드 방지)', async () => {
    let initialized = false
    const mockKakao = {
      init: vi.fn(() => {
        initialized = true
      }),
      isInitialized: vi.fn(() => initialized),
      Channel: {
        addChannel: vi.fn(),
      },
    }

    const mockLoader = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            window.Kakao = mockKakao
            resolve()
          }, 10)
        }),
    )

    const [res1, res2, res3] = await Promise.all([
      loadKakaoSdk({ jsKey: 'key-1', loader: mockLoader }),
      loadKakaoSdk({ jsKey: 'key-1', loader: mockLoader }),
      loadKakaoSdk({ jsKey: 'key-1', loader: mockLoader }),
    ])

    expect(mockLoader).toHaveBeenCalledTimes(1)
    expect(res1.ok).toBe(true)
    expect(res2.ok).toBe(true)
    expect(res3.ok).toBe(true)
  })

  it('스크립트 로더가 실패하면 ok: false와 에러 사유를 반환해야 한다', async () => {
    const mockLoader = vi.fn(async () => {
      throw new Error('Network timeout or integrity check failed')
    })

    const result = await loadKakaoSdk({
      jsKey: 'valid-key',
      loader: mockLoader,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Network timeout')
    }
  })
})
