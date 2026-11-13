/**
 * Official Kakao JavaScript SDK v2 Loader
 *
 * Specification:
 * - Version: 2.8.4
 * - CDN URL: https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js
 * - Integrity (SRI): sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w
 */

export const KAKAO_SDK_VERSION = '2.8.4'
export const KAKAO_SDK_URL = `https://t1.kakaocdn.net/kakao_js_sdk/${KAKAO_SDK_VERSION}/kakao.min.js`
export const KAKAO_SDK_INTEGRITY =
  'sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w'

export interface KakaoSdkGlobal {
  init: (appKey: string) => void
  isInitialized: () => boolean
  Auth?: {
    authorize: (options: Record<string, unknown>) => void
    [key: string]: unknown
  }
  Channel?: {
    addChannel: (options: { channelPublicId: string }) => void
    followChannel?: (options: { channelPublicId: string }) => Promise<unknown>
    chat?: (options: { channelPublicId: string }) => void
    [key: string]: unknown
  }
  [key: string]: unknown
}

declare global {
  interface Window {
    Kakao?: KakaoSdkGlobal
  }
}

export type ScriptLoaderFn = (url: string, integrity: string) => Promise<void>

export interface LoadKakaoSdkOptions {
  readonly jsKey?: string
  readonly loader?: ScriptLoaderFn
  readonly targetWindow?: Window
}

export type LoadKakaoSdkResult =
  | { readonly ok: true; readonly kakao: KakaoSdkGlobal }
  | { readonly ok: false; readonly reason: string }

let activeLoadPromise: Promise<void> | null = null

export function resetKakaoSdkLoaderForTesting(): void {
  activeLoadPromise = null
}

function defaultDomScriptLoader(url: string, integrity: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Document is not available for DOM script injection'))
      return
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)
    if (existingScript) {
      if (existingScript.dataset.loaded === 'true') {
        resolve()
        return
      }
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Failed to load Kakao SDK script')),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = url
    script.integrity = integrity
    script.crossOrigin = 'anonymous'
    script.async = true

    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = () => {
      reject(new Error(`Failed to load Kakao SDK script from ${url}`))
    }

    document.head.appendChild(script)
  })
}

/**
 * Loads Kakao JavaScript SDK v2 and initializes it exactly once with the provided jsKey.
 * Completely guards against SSR window access and duplicate downloads.
 */
export async function loadKakaoSdk(options: LoadKakaoSdkOptions = {}): Promise<LoadKakaoSdkResult> {
  const currentWindow =
    'targetWindow' in options
      ? options.targetWindow
      : typeof window !== 'undefined'
        ? window
        : undefined

  if (!currentWindow) {
    return {
      ok: false,
      reason: 'window is not defined (SSR environment)',
    }
  }

  const jsKey = options.jsKey?.trim()
  if (!jsKey) {
    return {
      ok: false,
      reason: 'Kakao JavaScript Key (jsKey) is required for initialization',
    }
  }

  // If Kakao is already available and initialized, return immediately
  if (currentWindow.Kakao?.isInitialized?.()) {
    return {
      ok: true,
      kakao: currentWindow.Kakao,
    }
  }

  const loader = options.loader ?? defaultDomScriptLoader

  try {
    if (!activeLoadPromise) {
      activeLoadPromise = loader(KAKAO_SDK_URL, KAKAO_SDK_INTEGRITY)
    }
    await activeLoadPromise
  } catch (error) {
    activeLoadPromise = null
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      reason: `Failed to load Kakao SDK: ${errorMessage}`,
    }
  }

  const kakao = currentWindow.Kakao
  if (!kakao || typeof kakao.init !== 'function') {
    activeLoadPromise = null
    return {
      ok: false,
      reason: 'Kakao object not found or invalid on window after loading script',
    }
  }

  if (!kakao.isInitialized?.()) {
    kakao.init(jsKey)
  }

  return {
    ok: true,
    kakao,
  }
}
