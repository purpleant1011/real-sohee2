'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { MobileHomeView } from './mobile-home-view'
import { MobileApprovalScreen } from './mobile-approval-view'
import { MobileHeader, MobileNavigation, MobileMoreMenu } from './mobile-navigation'
import { getMobileMode } from './navigation'
import { ready, unknown, type MobileHomeDto, type MobileApprovalView } from './contracts'

const fixtureTime = '2026-10-16T01:00:00Z'
const id = 'dm:00000000-0000-4000-8000-000000000001'
export function MobileFixtureClient({ initialState, initialPath, initialTheme }: { initialState: string; initialPath: string; initialTheme: 'light' | 'dark' }) {
  const [path, setPath] = useState(initialPath)
  const [chatOpen, setChatOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const setInitialTheme = useRef(setTheme)
  useEffect(() => { setInitialTheme.current(initialTheme) }, [initialTheme])
  useEffect(() => {
    const back = () => setPath(new URL(location.href).searchParams.get('path') || '/app')
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  function navigate(next: string) {
    setPath(next)
    const url = new URL(location.href)
    url.searchParams.set('path', next)
    history.pushState(null, '', url)
  }
  function follow(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest('a')
    const href = anchor?.getAttribute('href')
    if (href?.startsWith('/app') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); navigate(href)
    }
  }
  const view: MobileHomeDto = {
    workspaceId: 'fixture-ws', businessName: '우리 매장', timeZone: 'Asia/Seoul', generatedAt: fixtureTime,
    agent: unknown(), decisions: ready({ complete: true, total: 2, items: [
      { id, kind: 'dm_reply', title: '방문 문의 답변을 확인해 주세요', targetLabel: '테스트 고객 · 메시지', createdAt: fixtureTime, expiresAt: null },
      { id: 'post:00000000-0000-4000-8000-000000000002', kind: 'post_publish', title: '이번 주 매장 소식', targetLabel: '콘텐츠 · 게시 전', createdAt: fixtureTime, expiresAt: null },
    ] }, fixtureTime), activity: unknown(), results: unknown(),
  }
  if (initialState === 'empty') view.decisions = ready({ complete: true, total: 0, items: [] }, fixtureTime)
  if (initialState === 'loading') view.decisions = { ...unknown(), state: 'loading' }
  if (initialState === 'error') view.decisions = { ...unknown(), state: 'error' }
  if (initialState === 'partial') view.decisions = { ...view.decisions, state: 'error', data: { ...view.decisions.data!, complete: false, total: null } }
  if (initialState === 'stale') view.decisions = { ...view.decisions, state: 'stale' }
  const detail: MobileApprovalView = {
    workspaceId: 'fixture-ws', id, kind: 'dm_reply', title: '방문 문의 답장 검토', targetLabel: '테스트 고객 · 인스타그램',
    sourceText: '이번 주 방문하고 싶은데, 서비스와 가격을 알려주실 수 있나요?',
    fullContent: '안녕하세요. 문의해 주셔서 감사해요.\n원하시는 서비스를 알려주시면 가격과 소요 시간을 확인해 안내해 드릴게요.\n방문 시간은 실제 예약 상황을 확인한 뒤 함께 조율해요.',
    imageUrls: [], datasetMode: 'TEST', writeState: 'unsupported', reason: '테스트 내용 검토만 가능해요. 게시·답장·예약은 실행되지 않아요.',
  }
  const pathname = path.split('?')[0]
  const mode = getMobileMode(pathname, chatOpen)
  return <div onClickCapture={follow} className="min-h-screen bg-background text-foreground">
    <aside aria-label="테스트 환경 안내" className="border-b border-border bg-muted px-4 py-2 text-center text-xs font-medium text-muted-foreground">테스트 예시 · 외부 실행 없음</aside>
    {mode !== 'review' && <MobileHeader onDelegate={() => setChatOpen(true)} />}
    <main className={`mx-auto w-full max-w-3xl px-4 pt-5 ${mode === 'browse' ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : ''}`}>
      {pathname === '/app' ? <MobileHomeView view={view} onRefresh={() => {}} onDelegate={() => setChatOpen(true)} /> :
        pathname === '/app/approvals' ? <MobileApprovalScreen view={detail} onBack={() => navigate('/app')} onRefresh={() => {}} /> :
        pathname === '/app/system' ? <MobileMoreMenu onTheme={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} /> :
        <section className="space-y-4 rounded-2xl border border-border p-5"><h1 className="text-2xl font-semibold">기존 업무 화면 연결 예시</h1><p className="text-base text-muted-foreground">이 페이지에서는 실제 계정·고객·성과를 조회하지 않아요.</p><Link prefetch={false} href="/app" className="inline-flex min-h-11 items-center text-primary">오늘로 돌아가기</Link></section>}
    </main>
    {mode === 'browse' && <MobileNavigation pathname={pathname} />}
    <Dialog title="소희에게 소식 맡기기" open={chatOpen} onOpenChange={setChatOpen}>
      <div className="space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">위임 입력 화면의 테스트 예시예요. 실제 요청은 전송하지 않아요.</p><label className="block space-y-2 text-base"><span>맡길 소식</span><textarea className="min-h-32 w-full rounded-xl border border-border bg-background p-3 text-base" placeholder="가게 소식이나 원하는 목표를 적어 주세요" /></label><Button disabled className="min-h-12 w-full">실제 요청은 실행되지 않아요</Button></div>
    </Dialog>
  </div>
}
