import React, { useState, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { usePathname } from 'next/navigation'
import {
  Sun,
  Moon,
} from 'lucide-react'

import { SettingsMasterLayout, SETTINGS_GROUPS } from '@/components/v088/system/settings-master-layout'
import { SettingsOverview } from '@/components/v088/system/settings-overview'
import { ConnectorHub } from '@/features/marketing-connectors/ui/connector-hub'
import { ChannelLearningPanel } from '@/features/channel-learning/components/channel-learning-panel'
import { ConversationThreadPanel } from '@/features/chat/conversation-thread-panel'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { Button } from '@/components/ui/button'
import '../../../src/app/globals.css'

import {
  SAMPLE_WORKSPACE,
  SAMPLE_CONNECTOR_SNAPSHOT,
  SAMPLE_CONVERSATION_THREADS,
} from './sample-data'

type FixtureView = 'settings' | 'overview' | 'connectors' | 'chat-history' | 'mobile-connectors'

// 1. Mock window.fetch to guarantee zero external network / db calls
if (typeof window !== 'undefined') {
  window.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

    // Version / diagnostics
    if (url.includes('/api/diagnostics/version')) {
      return new Response(JSON.stringify({ buildSha: 'development', version: 'v0.94-fixture' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (url.includes('/knowledge/channels')) {
      return new Response(JSON.stringify({ sources: [], capabilities: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Conversations list / pagination
    if (url.includes('/conversations')) {
      return new Response(
        JSON.stringify({
          data: {
            items: SAMPLE_CONVERSATION_THREADS,
            hasMore: false,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    }

    // Marketing connectors ICS import
    if (url.includes('/marketing-connectors/apple-calendar/import')) {
      return new Response(JSON.stringify({ success: true, count: 3 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Any other mock API
    return new Response(JSON.stringify({ ok: true, fixture: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/** Detail Content for SettingsMasterLayout (no artificial back links; layout provides authentic back link) */
function SettingsDetailContent() {
  const pathname = usePathname()

  if (pathname === '/app/connectors') {
    return (
      <div className="space-y-4">
        <ConnectorHub snapshot={SAMPLE_CONNECTOR_SNAPSHOT} />
      </div>
    )
  }

  // Business route placement is independently covered by the server page test.
  // Render its real learning panel here to verify responsive layout without auth or writes.
  if (pathname === '/app/settings/business') {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <h1 className="text-2xl font-semibold">가게 기본 정보</h1>
        <section id="channel-learning" aria-label="가게 정보의 채널 학습" className="min-w-0">
          <h2 className="mb-3 text-lg font-semibold">소희에게 내 채널 가르치기</h2>
          <ChannelLearningPanel workspaceId={SAMPLE_WORKSPACE.workspaceId} canManage />
        </section>
      </div>
    )
  }

  let activeItemTitle = '가게 기본 정보'
  for (const group of SETTINGS_GROUPS) {
    for (const item of group.items) {
      if (item.href === pathname) {
        activeItemTitle = item.label
        break
      }
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-2xs" data-testid="settings-detail-card">
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-bold text-foreground">{activeItemTitle}</h2>
      </div>

      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong>{activeItemTitle}</strong> 내용을 확인하고 변경할 수 있어요.
          다른 설정은 위의 <strong>설정 홈</strong>에서 찾을 수 있어요.
        </p>
      </div>
    </div>
  )
}

function HarnessApp() {
  const [view, setView] = useState<FixtureView>(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('view')
      if (q === 'connectors' || q === 'overview' || q === 'chat-history' || q === 'mobile-connectors') {
        return q
      }
    }
    return 'settings'
  })

  const [isDark, setIsDark] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)

  // Listen to popstate or url changes
  useEffect(() => {
    const handlePopState = () => {
      const q = new URLSearchParams(window.location.search).get('view')
      if (q === 'connectors' || q === 'overview' || q === 'chat-history' || q === 'mobile-connectors') {
        setView(q)
      } else if (!q && window.location.pathname.startsWith('/app/connectors')) {
        setView('connectors')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const switchView = useCallback((nextView: FixtureView) => {
    setView(nextView)
    const url = new URL(window.location.href)
    url.searchParams.set('view', nextView)
    window.history.pushState(null, '', url.toString())
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      if (next) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      return next
    })
  }, [])

  const toggleZoom = useCallback(() => {
    setIsZoomed((prev) => {
      const next = !prev
      document.documentElement.style.fontSize = next ? '200%' : '100%'
      return next
    })
  }, [])

  return (
    <WorkspaceProvider value={SAMPLE_WORKSPACE}>
      <MobileR2Provider enabled={true} forceMobile={view === 'mobile-connectors'}>
        <div className="min-h-screen flex flex-col bg-background text-foreground">
          {/* 하네스 상단 제어 바 */}
          <header
            role="banner"
            aria-label="미리보기 화면 선택"
            hidden={new URLSearchParams(window.location.search).get('controls') !== '1'}
            className="sticky top-0 z-50 border-b border-border bg-muted/95 backdrop-blur-sm px-3 py-2"
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">소희 화면 미리보기</span>
              </div>

              {/* 뷰 전환 탭 */}
              <nav aria-label="미리볼 화면 선택" className="flex flex-wrap items-center gap-1">
                <Button
                  data-testid="tab-settings"
                  size="sm"
                  variant={view === 'settings' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => switchView('settings')}
                >
                  설정 레이아웃
                </Button>
                <Button
                  data-testid="tab-overview"
                  size="sm"
                  variant={view === 'overview' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => switchView('overview')}
                >
                  설정 홈
                </Button>
                <Button
                  data-testid="tab-connectors"
                  size="sm"
                  variant={view === 'connectors' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => switchView('connectors')}
                >
                  업무 도구 연결
                </Button>
                <Button
                  data-testid="tab-chat-history"
                  size="sm"
                  variant={view === 'chat-history' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => switchView('chat-history')}
                >
                  이전 대화 화면
                </Button>
                <Button
                  data-testid="tab-mobile-connectors"
                  size="sm"
                  variant={view === 'mobile-connectors' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => switchView('mobile-connectors')}
                >
                  휴대폰 도구 연결
                </Button>
              </nav>

              {/* 스타일 토글 */}
              <div className="flex items-center gap-1">
                <Button
                  data-testid="toggle-dark-mode"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={toggleTheme}
                  aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
                >
                  {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                  <span className="ml-1 hidden sm:inline">{isDark ? '라이트' : '다크'}</span>
                </Button>
                <Button
                  data-testid="toggle-zoom"
                  size="sm"
                  variant={isZoomed ? 'secondary' : 'outline'}
                  className="h-7 px-2 text-xs"
                  onClick={toggleZoom}
                  aria-label="200% 글자 확대 토글"
                >
                  <span>200%</span>
                </Button>
              </div>
            </div>
          </header>

          {/* 메인 뷰 영역 */}
          <main className="flex-1 overflow-x-hidden">
            {view === 'settings' && (
              <SettingsMasterLayout showBackLink={true}>
                <SettingsDetailContent />
              </SettingsMasterLayout>
            )}

            {view === 'overview' && (
              <SettingsOverview />
            )}

            {view === 'connectors' && (
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                <ConnectorHub snapshot={SAMPLE_CONNECTOR_SNAPSHOT} />
              </div>
            )}

            {view === 'mobile-connectors' && (
              <div className="max-w-md mx-auto px-3 py-4">
                <ConnectorHub snapshot={SAMPLE_CONNECTOR_SNAPSHOT} />
              </div>
            )}

            {view === 'chat-history' && (
              <div className="max-w-2xl mx-auto p-4 space-y-4">
                <div className="rounded-xl border border-border p-4 bg-card space-y-2">
                  <h2 className="text-base font-bold text-foreground">지난 대화 다시 보기</h2>
                  <p className="text-xs text-muted-foreground">
                    이전에 나눈 대화를 찾아 이어서 이야기할 수 있어요.
                  </p>
                </div>
                <div className="rounded-xl border border-border p-4 bg-muted/20 min-h-[400px]">
                  <ConversationThreadPanel
                    workspaceId={SAMPLE_WORKSPACE.workspaceId}
                    currentThreadId="thread-fixture-uuid-01"
                    initialThreads={SAMPLE_CONVERSATION_THREADS}
                    hasMore={false}
                    canManageThreads={true}
                    unreadInboxCount={2}
                  />
                </div>
              </div>
            )}
          </main>
        </div>
      </MobileR2Provider>
    </WorkspaceProvider>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<HarnessApp />)
}
