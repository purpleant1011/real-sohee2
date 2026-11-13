import { useEffect, useState } from 'react'
export function usePathname() { return location.pathname }
export function useSearchParams() { return new URLSearchParams(location.search) }
export function useRouter() { return { push: (path: string) => { location.assign(path) }, replace: (path: string) => { location.replace(path) }, back: () => history.back(), refresh: () => location.reload() } }
export function useParams() { return {} }
export function useSelectedLayoutSegment() { return null }
export function useSelectedLayoutSegments() { return [] }
// These exports intentionally implement only browser navigation in the isolated Vite surface.
export function redirect(path: string): never { location.assign(path); throw new Error('local navigation') }
export function notFound(): never { throw new Error('local not found') }
export function useSearchState() { const [path, setPath] = useState(location.href); useEffect(() => { const update = () => setPath(location.href); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update) }, []); return path }
