import { useEffect, useState, useCallback } from 'react'

const listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch {}
  })
}

function resolveCurrentPath(): string {
  if (typeof window === 'undefined') return '/app/system'
  const searchParamPath = new URLSearchParams(window.location.search).get('path')
  if (searchParamPath) return searchParamPath
  return window.location.pathname || '/app/system'
}

export function setNavigationPath(newPath: string) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (url.searchParams.has('path')) {
    url.searchParams.set('path', newPath)
  } else {
    url.pathname = newPath
  }
  window.history.pushState(null, '', url.toString())
  notifyListeners()
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(resolveCurrentPath)

  useEffect(() => {
    const handlePopState = () => {
      setPathname(resolveCurrentPath())
    }
    listeners.add(handlePopState)
    window.addEventListener('popstate', handlePopState)
    return () => {
      listeners.delete(handlePopState)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  return pathname
}

export function useSearchParams(): URLSearchParams {
  const [params, setParams] = useState(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''))

  useEffect(() => {
    const handlePopState = () => {
      setParams(new URLSearchParams(window.location.search))
    }
    listeners.add(handlePopState)
    window.addEventListener('popstate', handlePopState)
    return () => {
      listeners.delete(handlePopState)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  return params
}

export function useRouter() {
  const push = useCallback((href: string) => {
    if (typeof window === 'undefined') return
    const currentUrl = new URL(window.location.href)
    if (href.startsWith('?')) {
      currentUrl.search = href
      window.history.pushState(null, '', currentUrl.toString())
    } else {
      const targetUrl = new URL(href, window.location.origin)
      if (currentUrl.searchParams.has('path') || currentUrl.searchParams.has('view')) {
        currentUrl.searchParams.set('path', targetUrl.pathname)
        window.history.pushState(null, '', currentUrl.toString())
      } else {
        window.history.pushState(null, '', targetUrl.pathname + targetUrl.search)
      }
    }
    notifyListeners()
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  const replace = useCallback((href: string) => {
    if (typeof window === 'undefined') return
    const currentUrl = new URL(window.location.href)
    if (href.startsWith('?')) {
      currentUrl.search = href
      window.history.replaceState(null, '', currentUrl.toString())
    } else {
      const targetUrl = new URL(href, window.location.origin)
      if (currentUrl.searchParams.has('path') || currentUrl.searchParams.has('view')) {
        currentUrl.searchParams.set('path', targetUrl.pathname)
        window.history.replaceState(null, '', currentUrl.toString())
      } else {
        window.history.replaceState(null, '', targetUrl.pathname + targetUrl.search)
      }
    }
    notifyListeners()
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  const back = useCallback(() => {
    if (typeof window !== 'undefined') window.history.back()
  }, [])

  const refresh = useCallback(() => {
    notifyListeners()
  }, [])

  const prefetch = useCallback(async () => {}, [])

  return { push, replace, back, refresh, prefetch }
}

export function useParams() {
  return {}
}

export function useSelectedLayoutSegment() {
  return null
}

export function useSelectedLayoutSegments() {
  return []
}

export function redirect(path: string): never {
  if (typeof window !== 'undefined') {
    setNavigationPath(path)
  }
  throw new Error(`NAVIGATION_REDIRECT:${path}`)
}

export function notFound(): never {
  throw new Error('NAVIGATION_NOT_FOUND')
}
