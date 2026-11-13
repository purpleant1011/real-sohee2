import { Suspense, type ReactNode } from 'react'
import AppLoading from './loading'
import ProtectedAppContent from './protected-app-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// loading.tsx는 같은 segment의 layout 조회를 감싸지 않는다.
// 로딩 UI에는 사용자·가게 데이터를 넣지 않고 모든 게이트는 내부에서 유지한다.
export default function ProtectedAppLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppLoading />}><ProtectedAppContent>{children}</ProtectedAppContent></Suspense>
}
