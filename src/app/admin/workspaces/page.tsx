import Link from 'next/link'
import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorWorkspaces } from '../../../features/operator-workspaces/repository'
import { LIFECYCLE_FILTER_VALUES, channelHealth, summarizeWorkspaces } from '../../../features/operator-workspaces/list-summary'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Building2, Search, ArrowRight } from 'lucide-react'
import { createSameTruthGateway } from '@/features/admin/same-truth/repository'
import { readWorkspaceAndVaultCards } from '@/features/admin/same-truth/read-model'
import { EmptyNotice, LoadErrorNotice, MfaRequiredNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import {
  connectionLabel, formatCount, formatRelativeKst, lifecycleLabel, memberStatusLabel, planLabel, workspaceKindLabel,
} from '@/components/admin-ui/labels'

export const MEMBER_FILTER_VALUES = ['formal', 'applicant', 'all'] as const
export type MemberFilterValue = (typeof MEMBER_FILTER_VALUES)[number]

type WorkspaceSearch = {
  cursor: string | null
  query: string | null
  status: string | null
  member: MemberFilterValue
  limit: number
}

export function parseWorkspaceSearchParams(params?: unknown): WorkspaceSearch | null {
  if (typeof params !== 'object' || params === null) {
    return { cursor: null, query: null, status: null, member: 'formal', limit: 50 }
  }
  const record = params as Record<string, unknown>
  if (record.query !== undefined && typeof record.query !== 'string') return null
  const query = typeof record.query === 'string' ? record.query.trim() || null : null

  if (record.status !== undefined && typeof record.status !== 'string') return null
  // The filter form submits an empty value for "전체 상태".
  const status = typeof record.status === 'string' ? record.status.trim() || null : null
  if (status !== null && !(LIFECYCLE_FILTER_VALUES as readonly string[]).includes(status)) return null

  let member: MemberFilterValue = 'formal'
  if (record.member !== undefined) {
    if (typeof record.member !== 'string') return null
    const trimmed = record.member.trim()
    if (trimmed === 'formal' || trimmed === 'applicant' || trimmed === 'all') {
      member = trimmed
    } else if (trimmed === '') {
      member = 'formal'
    } else {
      return null
    }
  }

  const cursor = typeof record.cursor === 'string' ? record.cursor.trim() || null : null
  let limit = 50
  if (typeof record.limit === 'string') {
    const parsed = parseInt(record.limit, 10)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) limit = parsed
  }

  return { cursor, query, status, member, limit }
}

function pageHref(params: {
  query: string | null
  status: string | null
  member?: MemberFilterValue | null
  cursor?: string | null
}): string {
  const search = new URLSearchParams()
  if (params.query) search.set('query', params.query)
  if (params.status) search.set('status', params.status)
  if (params.member && params.member !== 'formal') search.set('member', params.member)
  if (params.cursor) search.set('cursor', params.cursor)
  const text = search.toString()
  return text ? `/admin/workspaces?${text}` : '/admin/workspaces'
}

function ChannelChip({ name, status }: { name: string; status: string }) {
  const health = channelHealth(status)
  const text = status.toLowerCase() === 'unknown' ? '연결 기록 없음' : connectionLabel(status)
  const tone = health === 'healthy'
    ? 'bg-state-ok/10 text-state-ok border-state-ok/30'
    : health === 'problem'
      ? 'bg-state-danger/10 text-state-danger border-state-danger/30'
      : 'bg-muted text-muted-foreground border-border'
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{name} {text}</span>
}

export default async function OperatorWorkspacesPage(props?: { searchParams?: Promise<Record<string, unknown>> }) {
  await requireOperatorAnyScope('workspace.read')
  const resolvedParams = props?.searchParams ? await props.searchParams : {}
  const strict = parseWorkspaceSearchParams(resolvedParams)
  const parsed = strict ?? { cursor: null, query: null, status: null, member: 'formal' as const, limit: 50 }
  const { data, error } = await listOperatorWorkspaces(parsed)
  const workspaces = data?.items ?? []
  const hasMore = Boolean(data?.nextCursor)
  const summary = data ? summarizeWorkspaces(workspaces, hasMore) : null
  const cards = await readWorkspaceAndVaultCards({
    workspaces: data?.items ?? null,
    nextCursor: data?.nextCursor ?? null,
    gateway: createSameTruthGateway(),
  })
  const retryHref = pageHref(parsed)
  const filtered = Boolean(parsed.query || parsed.status || parsed.member !== 'formal')
  const scopeHint = hasMore ? '이 페이지에 불러온 고객사 기준이에요' : '불러온 전체 고객사 기준이에요'

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="고객사"
        description="가입 단계, 채널 연결, 크레딧, 이번 달 게시 현황을 고객사별로 확인해요."
        actions={<Building2 className="size-6 text-foreground" aria-hidden />}
      />

      <form method="get" action="/admin/workspaces" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label htmlFor="ws-query" className="text-xs font-medium text-muted-foreground">고객사 이름 검색</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden />
            <input
              id="ws-query"
              name="query"
              type="search"
              maxLength={120}
              defaultValue={parsed.query ?? ''}
              placeholder="고객사 또는 상호 이름"
              className="h-11 w-full rounded-md border border-input bg-card pl-9 pr-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          </div>
        </div>
        <div className="space-y-1 sm:w-44">
          <label htmlFor="ws-member" className="text-xs font-medium text-muted-foreground">회원 구분</label>
          <select
            id="ws-member"
            name="member"
            defaultValue={parsed.member}
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <option value="formal">정회원</option>
            <option value="applicant">가입자(미인증)</option>
            <option value="all">전체</option>
          </select>
        </div>
        <div className="space-y-1 sm:w-52">
          <label htmlFor="ws-status" className="text-xs font-medium text-muted-foreground">진행 상태</label>
          <select
            id="ws-status"
            name="status"
            defaultValue={parsed.status ?? ''}
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <option value="">전체 상태</option>
            {LIFECYCLE_FILTER_VALUES.map((value) => (
              <option key={value} value={value}>{lifecycleLabel(value)}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="inline-flex h-11 min-w-20 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          검색
        </button>
        {filtered ? (
          <Link href="/admin/workspaces" className="inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
            조건 지우기
          </Link>
        ) : null}
      </form>

      {strict === null ? (
        <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          검색 조건을 알아볼 수 없어 전체 목록을 보여드려요.
        </p>
      ) : null}

      {error === 'MFA_REQUIRED' ? <MfaRequiredNotice /> : error ? <LoadErrorNotice what="고객사 목록" retryHref={retryHref} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricTile
          label="불러온 고객사"
          value={summary ? formatCount(summary.loaded, '곳') : null}
          hint={summary ? (hasMore ? '다음 페이지에 더 있어요' : '더 없어요') : undefined}
        />
        <MetricTile
          label="운영 중"
          value={summary ? formatCount(summary.active, '곳') : null}
          hint={summary ? scopeHint : undefined}
          tone="good"
        />
        <MetricTile
          label="채널 문제"
          value={summary ? formatCount(summary.channelProblems, '곳') : null}
          hint={summary ? `인스타그램·스레드 재연결 필요 · ${scopeHint}` : undefined}
          tone={summary && summary.channelProblems > 0 ? 'bad' : 'default'}
        />
        <MetricTile
          label="크레딧 부족"
          value={summary ? formatCount(summary.lowCredits, '곳') : null}
          hint={summary ? `남은 크레딧 0 이하${summary.creditUnknown > 0 ? ` · 확인 불가 ${summary.creditUnknown}곳 제외` : ''}` : undefined}
          tone={summary && summary.lowCredits > 0 ? 'warn' : 'default'}
        />
        <MetricTile
          label="보관 중인 자료"
          value={cards.vault.value}
          hint={cards.vault.value === null ? '전체 고객사를 확인한 뒤에만 보여드려요' : cards.vault.status === 'STALE' ? '갱신이 필요한 값이에요' : '실고객 보관함 합계'}
        />
      </div>

      <Card className="overflow-hidden border-border/80 p-0 shadow-xs">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="min-w-48">고객사</TableHead>
                <TableHead>진행 상태</TableHead>
                <TableHead>요금제</TableHead>
                <TableHead>남은 크레딧</TableHead>
                <TableHead className="min-w-56">채널 연결</TableHead>
                <TableHead>이번 달 게시</TableHead>
                <TableHead>최근 활동</TableHead>
                <TableHead className="text-right"><span className="sr-only">상세</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">고객사 목록을 불러오지 못해 표시할 수 없어요.</TableCell>
                </TableRow>
              ) : workspaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyNotice
                      title={filtered ? '조건에 맞는 고객사가 없어요' : '표시할 고객사 데이터가 없습니다.'}
                      description={filtered ? '검색어나 진행 상태를 바꿔 보세요.' : undefined}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                workspaces.map((w) => (
                  <TableRow key={w.workspaceId} className="transition-colors hover:bg-muted/30">
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/admin/workspaces/${w.workspaceId}`} className="text-sm font-bold text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                          {w.businessName || w.workspaceName}
                        </Link>
                        <Badge
                          variant={w.memberStatus === 'FORMAL' ? 'success' : 'outline'}
                          className="text-[11px]"
                        >
                          {memberStatusLabel(w.memberStatus)}
                        </Badge>
                        {w.workspaceKind !== 'production' ? (
                          <Badge variant="warning" className="text-[11px]">{workspaceKindLabel(w.workspaceKind)}</Badge>
                        ) : null}
                      </div>
                      {w.businessName && w.businessName !== w.workspaceName ? (
                        <div className="text-xs text-muted-foreground">{w.workspaceName}</div>
                      ) : null}
                    </TableCell>
                    <TableCell><Badge variant={w.lifecycleStatus === 'active' ? 'success' : 'outline'}>{lifecycleLabel(w.lifecycleStatus)}</Badge></TableCell>
                    <TableCell className="text-sm">{planLabel(w.planCode)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-semibold">{formatCount(w.availableCredits, ' 크레딧')}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <ChannelChip name="인스타그램" status={w.instagramStatus} />
                        <ChannelChip name="스레드" status={w.threadsStatus} />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <span className="font-semibold">게시 {formatCount(w.publishedThisMonth)}</span>
                      <span className={w.failedThisMonth > 0 ? 'ml-2 font-semibold text-state-danger' : 'ml-2 text-muted-foreground'}>실패 {formatCount(w.failedThisMonth)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatRelativeKst(w.lastActivityAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/admin/workspaces/${w.workspaceId}`} aria-label={`${w.businessName || w.workspaceName} 상세 보기`} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-primary/30 px-3 text-xs font-semibold text-foreground hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary">
                        상세 <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <nav aria-label="목록 이동" className="flex flex-wrap items-center gap-2">
        <Link href={retryHref} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
          다시 불러오기
        </Link>
        {data?.nextCursor ? (
          <Link href={pageHref({ query: parsed.query, status: parsed.status, member: parsed.member, cursor: data.nextCursor })} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">
            다음 페이지
          </Link>
        ) : null}
        {parsed.cursor ? (
          <Link href={pageHref({ query: parsed.query, status: parsed.status, member: parsed.member })} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
            첫 페이지로
          </Link>
        ) : null}
      </nav>
    </div>
  )
}
