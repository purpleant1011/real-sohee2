'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, AtSign, ChevronDown, ChevronLeft, Check, RefreshCw, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChannelDiagnostics } from './channel-diagnostics'
import { ChannelConnectNotice } from './channel-connect-notice'
import { ChannelAccountHelp } from './channel-account-help'
import { getChannelDisplay, getConnectNotice, type CredentialSummary, type Verification } from './channel-display'

type MetaChannel = 'instagram' | 'threads'
type ChannelCredential = CredentialSummary & {
  channel: string
  webhook_status?: string | null
  last_webhook_at?: string | null
}
type ConnectionsState = Readonly<{
  workspaceId?: string
  extendedScopesAllowed?: boolean
  channels: Record<MetaChannel, Verification | null>
  credentials: Partial<Record<MetaChannel, ChannelCredential>>
  credentialsAvailable: boolean
}>
const NAMES: Record<MetaChannel, string> = { instagram: '인스타그램', threads: '스레드' }
const DESCRIPTIONS: Record<MetaChannel, string> = {
  instagram: '사진과 함께 올리는 피드 게시물',
  threads: '짧은 글 중심의 소식 게시물',
}
const PUBLISHED_STATUSES = ['PUBLISHED_VERIFIED', 'COMPLETED', 'LISTENING']

export function ChannelConnections({
  canRequestExtended,
}: {
  role?: string
  canRequestExtended?: boolean
} = {}) {
  const [data, setData] = useState<ConnectionsState | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [notice, setNotice] = useState<ReturnType<typeof getConnectNotice>>(null)
  const [isAuthorizedQuery, setIsAuthorizedQuery] = useState(false)
  const [hasPublishedPost, setHasPublishedPost] = useState(false)
  const [backHref, setBackHref] = useState('/app')

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [statusResponse, credentialsResponse] = await Promise.all([
        fetch('/api/channels', { cache: 'no-store' }),
        fetch('/api/channels/credentials', { cache: 'no-store' }),
      ])
      if (!statusResponse.ok) throw new Error('status')
      const statuses = await statusResponse.json() as {
        workspaceId?: string
        extendedScopesAllowed?: boolean
        instagram?: Verification
        threads?: Verification
      }
      if (!statuses.instagram || !statuses.threads) throw new Error('status')
      const credentialsAvailable = credentialsResponse.ok
      const credentialsPayload = credentialsAvailable
        ? await credentialsResponse.json() as { connections?: ChannelCredential[] }
        : null
      const credentials: ConnectionsState['credentials'] = {}
      for (const connection of Array.isArray(credentialsPayload?.connections) ? credentialsPayload.connections : []) {
        if (connection.channel === 'instagram' || connection.channel === 'threads') {
          credentials[connection.channel] = connection
        }
      }
      setData({
        workspaceId: statuses.workspaceId,
        extendedScopesAllowed: statuses.extendedScopesAllowed === true,
        channels: { instagram: statuses.instagram, threads: statuses.threads },
        credentials,
        credentialsAvailable,
      })

      // Check if user already published a post
      if (statuses.workspaceId) {
        try {
          const quickRes = await fetch(`/api/workspaces/${encodeURIComponent(statuses.workspaceId)}/quick-post`, { cache: 'no-store' })
          if (quickRes.ok) {
            const quickData = await quickRes.json()
            if (Array.isArray(quickData.items)) {
              const published = quickData.items.some((item: any) => PUBLISHED_STATUSES.includes(item.status))
              setHasPublishedPost(published)
            }
          }
        } catch {
          // Non-blocking
        }
      }
    } catch {
      setData(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const connectVal = query.get('connect')
    const errorVal = query.get('error')
    const connectErrorVal = query.get('connect_error')
    const channelVal = query.get('channel')
    const isAuth = connectVal === 'authorized' || connectVal === 'connected'
    if (isAuth) setIsAuthorizedQuery(true)

    const initialNotice = getConnectNotice(connectVal || errorVal, connectErrorVal || errorVal, {
      channel: channelVal,
      returnPath: '/app/channels',
    })
    setNotice(initialNotice)

    const fromOnboarding =
      query.get('from') === 'onboarding' ||
      query.get('returnPath')?.includes('/start') ||
      (typeof document !== 'undefined' && document.referrer.includes('/start'))
    setBackHref(fromOnboarding ? '/start?step=channels' : '/app')

    if (query.has('connect') || query.has('error')) {
      const cleanUrl = new URL(window.location.href)
      for (const key of ['connect', 'channel', 'account', 'connect_error', 'error']) cleanUrl.searchParams.delete(key)
      window.history.replaceState(window.history.state, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash)
    }
  }, [])

  // Check connected channels for status badge & next-step card
  const isIgConnected = Boolean(data?.channels.instagram?.verified || data?.credentials.instagram?.status === 'connected')
  const isThConnected = Boolean(data?.channels.threads?.verified || data?.credentials.threads?.status === 'connected')
  const hasAnyConnected = isIgConnected || isThConnected

  // Transition notice from loading to verified success
  const allowExtended = canRequestExtended ?? Boolean(data?.extendedScopesAllowed)
  useEffect(() => {
    if (!loading && (isAuthorizedQuery || notice?.title === '연결 결과를 확인하고 있어요') && hasAnyConnected) {
      const connectedLabels: string[] = []
      if (isThConnected) {
        const handle = data?.channels.threads?.username || data?.credentials.threads?.account_label
        connectedLabels.push(`스레드${handle ? ` @${handle.replace(/^@/, '')}` : ''}`)
      }
      if (isIgConnected) {
        const handle = data?.channels.instagram?.username || data?.credentials.instagram?.account_label
        connectedLabels.push(`인스타그램${handle ? ` @${handle.replace(/^@/, '')}` : ''}`)
      }
      const labelText = connectedLabels.length > 0 ? ` (${connectedLabels.join(' · ')})` : ''
      setNotice({
        title: '연결이 확인됐어요 🎉',
        message: `${labelText ? `${labelText} 계정이` : '계정이'} 안전하게 연결되었어요. 이제 첫 게시물을 만들어 볼까요?`,
        kind: 'success',
      })
    }
  }, [loading, isAuthorizedQuery, hasAnyConnected, isIgConnected, isThConnected, data, notice?.title])

  const showNextStepArea = hasAnyConnected || isAuthorizedQuery

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      {/* 상단 내비게이션: 항상 좌측 상단에 '← 이전' 링크 */}
      <nav aria-label="이전 화면 이동">
        <Link
          href={backHref}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="이전 화면으로 이동"
        >
          <ChevronLeft className="size-4" aria-hidden /> 이전
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">게시물을 올릴 계정을 연결해 주세요</h1>
        <p className="text-sm text-muted-foreground">인스타그램이나 스레드 중 하나만 연결해도 시작할 수 있어요. 소희는 사장님이 확인하고 승인한 글만 올립니다.</p>
      </header>

      <ChannelConnectNotice notice={notice} />
      <ChannelAccountHelp />

      {/* 다음 단계 영역 (소넷 확정 설계): 연결 완료 또는 연결 성공 시 노출 */}
      {showNextStepArea && (
        <section aria-label="다음 단계 안내" className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Sparkles className="size-4 text-primary" aria-hidden />
                <span>{hasPublishedPost ? '소희와 함께 마케팅 이어가기' : '채널 연결 완료! 첫 글을 만들어 볼까요?'}</span>
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                {hasPublishedPost
                  ? '채널이 안전하게 연결되어 있어요. 새로운 매장 소식을 작성해 보세요.'
                  : '연결된 계정으로 올릴 사장님 가게 맞춤형 첫 글이 준비되어 있어요.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
              {hasPublishedPost ? (
                <Button asChild className="min-h-[44px] flex-1 sm:flex-initial">
                  <Link href="/app/content">
                    다음 글 만들기 <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              ) : (
                <Button asChild className="min-h-[44px] flex-1 sm:flex-initial">
                  <Link href="/start/preview">
                    첫 글 만들기 <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline" className="min-h-[44px] flex-1 sm:flex-initial">
                <Link href="/app">소희 작업실로 이동</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {error && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-border bg-muted/60 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span>연결 상태를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.</span>
        <Button variant="outline" onClick={() => void load()} className="min-h-[44px] shrink-0"><RefreshCw aria-hidden /> 다시 시도</Button>
      </div>}

      <div className="grid gap-4 sm:grid-cols-2" aria-busy={loading}>
        {(['instagram', 'threads'] as const).map(channel => {
          const display = data ? getChannelDisplay(data.channels[channel], data.credentials[channel]) : null
          const showHandle = data?.credentialsAvailable !== false || Boolean(data?.channels[channel]?.username)
          const label = display?.kind === 'connected' && !showHandle ? '연결됨' : display?.label
          return (
            <Card key={channel} role="article" aria-label={NAMES[channel]} tabIndex={0} className="flex h-full flex-col border-border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-within:ring-2 focus-within:ring-ring">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-lg"><AtSign className="size-5 text-primary" aria-hidden /> {NAMES[channel]}</CardTitle>
                  {display && <Badge variant={display.kind === 'connected' ? 'success' : display.kind === 'reauth' ? 'warning' : 'secondary'}>{display.badgeLabel ?? (display.kind === 'connected' ? '연결됨' : display.kind === 'reauth' ? '확인 필요' : display.kind === 'unknown' ? '조회 불가' : '연결 전')}</Badge>}
                </div>
                <CardDescription>{DESCRIPTIONS[channel]}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="flex items-center gap-2 text-sm font-medium" role="status">
                  {display?.kind === 'connected' && <Check className="size-4 text-primary" aria-hidden />}
                  {loading ? '연결 상태를 확인하고 있어요' : label ?? '상태를 확인할 수 없어요'}
                </p>
                <div className="flex flex-col gap-2">
                  {display?.action ? (
                    <Button asChild size="lg" className="min-h-12 w-full">
                      <a aria-label={`${NAMES[channel]} ${display.action}`} href={`/api/channels/${channel}/connect?returnPath=/app/channels`}>{display.action}</a>
                    </Button>
                  ) : display?.kind === 'connected' ? (
                    <Button asChild variant="outline" className="min-h-12 w-full">
                      <a aria-label={`${NAMES[channel]} 다른 계정으로 다시 연결`} href={`/api/channels/${channel}/connect?returnPath=/app/channels`}>다른 계정으로 다시 연결</a>
                    </Button>
                  ) : display?.kind === 'unknown' ? (
                    <Button variant="outline" onClick={() => void load()} className="min-h-12 w-full">상태 다시 확인</Button>
                  ) : null}
                  {allowExtended && (
                    <Button asChild variant="ghost" size="sm" className="min-h-[44px] text-[16px] w-full text-muted-foreground hover:text-foreground">
                      <a
                        aria-label={`${NAMES[channel]} 확장 권한으로 다시 연결 (댓글·DM·인사이트)`}
                        href={`/api/channels/${channel}/connect?returnPath=/app/channels&extended=1`}
                      >
                        확장 권한으로 다시 연결 (댓글·DM·인사이트)
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">연결할 때 Meta 공식 로그인 페이지로 이동해요. 소희는 비밀번호를 저장하지 않아요. 연결 중 문제가 있으면 소희 운영팀에 문의해 주세요.</p>

      <section aria-label="추가 채널" className="grid grid-cols-2 gap-3">
        {['네이버 블로그', '당근'].map(name => (
          <div key={name} className="flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium">{name}</span><Badge variant="secondary">준비 중</Badge>
          </div>
        ))}
      </section>

      <section className="border-t border-border pt-5" aria-label="고급 정보">
        <Button variant="ghost" aria-controls="channel-advanced-info" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)} className="h-auto min-h-12 w-full justify-between whitespace-normal text-left text-muted-foreground hover:text-foreground">
          <span>고급 정보 · 문제 해결용</span><span className="inline-flex items-center gap-1">{advanced ? '접기' : '펼치기'}<ChevronDown className={`size-4 transition-transform ${advanced ? 'rotate-180' : ''}`} aria-hidden /></span>
        </Button>
        {advanced && <div id="channel-advanced-info" className="mt-3"><ChannelDiagnostics channels={data?.channels ?? { instagram: null, threads: null }} credentials={data?.credentials ?? {}} /></div>}
      </section>
    </main>
  )
}

