import { channelLabel, lifecycleLabel } from '@/components/admin-ui/labels'

/**
 * Pure derivation of the operator home from already-loaded read models.
 * A source that is null means "the read failed": numbers that depend on it are null (never 0)
 * and the attention list can never claim "all clear".
 */

type Source<T> = Readonly<{ items: readonly T[]; truncated: boolean }> | null

export type HomeWorkspace = Readonly<{ workspaceId: string; workspaceName: string; workspaceKind: string; lifecycleStatus: string | null }>
export type HomeOnboarding = Readonly<{ workspaceId: string; workspaceName: string; lifecycleStatus: string | null; changedAt: string | null }>
export type HomeChannel = Readonly<{ workspaceId: string; workspaceName: string; channel: string; connectionStatus: string }>
export type HomePublish = Readonly<{
  workspaceId: string; workspaceName: string; channel: string; contentTitle: string
  displayState: string; publishedAt: string | null; publishAt: string | null; scheduleAt?: string | null
}>
export type HomeBilling = Readonly<{ workspaceId: string; workspaceName: string; available: number | null; weeklyLimit: number | null }>
export type HomeSupport = Readonly<{ workspaceId: string; status: string; startedAt: string; expiresAt: string }>
export type HomeSystem = Readonly<{ source: string; state: string }>
export type HomeAudit = Readonly<{ id: string; action: string; workspaceName: string | null; result: 'succeeded' | 'failed' | 'denied'; createdAt: string }>

export type OperatorHomeInput = Readonly<{
  workspaces: Source<HomeWorkspace>
  memberships?: Readonly<{ formalCount: number; applicantCount: number }> | null
  onboarding: readonly HomeOnboarding[] | null
  channels: Source<HomeChannel>
  publishing: Source<HomePublish>
  billing: Source<HomeBilling>
  audit: Readonly<{ items: readonly HomeAudit[] }> | null
  support: Source<HomeSupport>
  system: Readonly<{ items: readonly HomeSystem[] }> | null
}>

export type HomeTile = Readonly<{
  key: string; label: string; value: number | string | null; hint?: string
  tone: 'default' | 'good' | 'warn' | 'bad'; href: string
}>
export type HomeRisk = Readonly<{
  id: string; kind: 'publish_failed' | 'channel_problem' | 'low_credit' | 'system_warning' | 'onboarding_stuck'
  title: string; detail: string; href: string
}>
export type HomeRecent = Readonly<{ id: string; text: string; workspaceName: string | null; result: HomeAudit['result']; createdAt: string }>
export type OperatorHome = Readonly<{
  tiles: readonly HomeTile[]
  risks: readonly HomeRisk[]
  riskStatus: 'items' | 'clear' | 'unconfirmed'
  recent: readonly HomeRecent[] | null
  failedSources: readonly string[]
}>

const DAY = 86_400_000
const WINDOW_DAYS = 7
const STUCK_DAYS = 7
const LOW_CREDIT_RATIO = 0.2
const DEMO_WORKSPACE_IDS = new Set(['ws-demo-byreum'])

const CHANNEL_PROBLEM_LABELS: Record<string, string> = {
  expired: '재연결 필요',
  reverify_required: '재인증 필요',
  missing_permission: '권한 부족',
  wrong_account: '다른 계정에 연결됨',
  provider_error: '연결 오류',
  error: '연결 오류',
}
const SYSTEM_SOURCE_LABELS: Record<string, string> = {
  conversation_jobs: '대화 작업', provider_webhooks: '외부 채널 알림 수신', operation_events: '운영 이벤트',
  cloudflare: '서버 환경', queue: '작업 대기열', cron: '예약 작업', release: '배포',
}
const NOT_FINISHED_EXCLUDED = new Set(['active', 'paused', 'terminated'])

const AUDIT_DOMAINS: Record<string, string> = {
  'credit.adjust': '크레딧 조정',
  'publish.retry': '게시 재시도',
  'audit.export.global': '감사 기록 내보내기',
  'audit.export.workspace': '감사 기록 내보내기',
  'agreement.verify': '약관 확인',
}
const AUDIT_STAGES: Record<string, string> = {
  requested: '요청', applied: '적용', approved: '승인', rejected: '반려', cancelled: '취소', expired: '만료',
}

export function auditEventText(action: string): string {
  const parts = action.split('.')
  const stage = AUDIT_STAGES[parts[parts.length - 1] ?? '']
  const domain = AUDIT_DOMAINS[parts.slice(0, -1).join('.')]
  return domain && stage ? `${domain} ${stage}` : '운영 작업'
}

function time(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

export function isLowCredit(available: number | null, weeklyLimit: number | null): boolean {
  if (available === null) return false
  return weeklyLimit !== null && weeklyLimit > 0 ? available <= weeklyLimit * LOW_CREDIT_RATIO : available <= 0
}

export function buildOperatorHome(input: OperatorHomeInput, now: Date = new Date()): OperatorHome {
  const nowMs = now.getTime()
  const demoIds = new Set(DEMO_WORKSPACE_IDS)
  for (const w of input.workspaces?.items ?? []) if (w.workspaceKind === 'demo') demoIds.add(w.workspaceId)
  const real = <T extends { workspaceId: string }>(items: readonly T[]): T[] => items.filter((i) => !demoIds.has(i.workspaceId))

  const failedSources = [
    ...(input.workspaces === null || input.memberships === null ? ['고객사'] : []),
    ...(input.onboarding === null ? ['가입·계약'] : []),
    ...(input.channels === null ? ['채널'] : []),
    ...(input.publishing === null ? ['게시'] : []),
    ...(input.billing === null ? ['결제·크레딧'] : []),
    ...(input.audit === null ? ['감사 기록'] : []),
    ...(input.support === null ? ['지원 세션'] : []),
    ...(input.system === null ? ['시스템'] : []),
  ]

  const partial = (source: { truncated: boolean } | null) => (source?.truncated ? ' · 최근 일부만 집계' : '')

  // 게시: 최근 7일. 시각이 없는 실패는 놓치지 않도록 포함한다.
  const since = nowMs - WINDOW_DAYS * DAY
  const publishItems = input.publishing ? real(input.publishing.items) : null
  const inWindow = (p: HomePublish) => {
    const t = time(p.publishedAt) ?? time(p.publishAt) ?? time(p.scheduleAt)
    return t === null ? p.displayState === 'failure' : t >= since && t <= nowMs
  }
  const publishSuccess = publishItems ? publishItems.filter((p) => p.displayState === 'success' && inWindow(p)) : null
  const publishFailure = publishItems ? publishItems.filter((p) => p.displayState === 'failure' && inWindow(p)) : null

  const channelProblems = input.channels ? real(input.channels.items).filter((c) => c.connectionStatus in CHANNEL_PROBLEM_LABELS) : null
  const lowCredit = input.billing ? real(input.billing.items).filter((b) => isLowCredit(b.available, b.weeklyLimit)) : null
  const openSupport = input.support
    ? real(input.support.items).filter((s) => s.status === 'active' && (time(s.expiresAt) ?? 0) > nowMs)
    : null
  const systemWarnings = input.system ? input.system.items.filter((s) => s.state === 'degraded' || s.state === 'error') : null

  const workspaceList = input.workspaces ? real(input.workspaces.items) : null
  const activeCount = workspaceList ? workspaceList.filter((w) => w.lifecycleStatus === 'active').length : 0
  const more = input.workspaces?.truncated ? ' 이상' : ''

  const formalValue = input.memberships !== undefined
    ? (input.memberships === null ? null : input.memberships.formalCount)
    : (workspaceList === null ? null : input.workspaces!.truncated ? `${workspaceList.length.toLocaleString('ko-KR')}곳 이상` : workspaceList.length)

  const formalHint = input.memberships !== undefined
    ? (input.memberships === null ? undefined : `가입자(미인증) ${input.memberships.applicantCount.toLocaleString('ko-KR')}곳`)
    : (workspaceList === null ? undefined : `${lifecycleLabel('active')} ${activeCount.toLocaleString('ko-KR')}곳${more}`)

  const tiles: HomeTile[] = [
    {
      key: 'workspaces', label: '전체 고객사',
      value: formalValue,
      hint: formalHint,
      tone: 'default', href: '/admin/workspaces?member=formal',
    },
    ...(input.memberships && typeof input.memberships.applicantCount === 'number' ? [{
      key: 'applicants', label: '가입자(미인증)',
      value: input.memberships.applicantCount,
      hint: '사업자 미인증 가입자',
      tone: 'default' as const, href: '/admin/workspaces?member=applicant',
    }] : []),
    {
      key: 'publishSuccess', label: '최근 7일 게시 성공', value: publishSuccess?.length ?? null,
      hint: publishSuccess ? `게시 완료${partial(input.publishing)}` : undefined, tone: 'good', href: '/admin/publishing',
    },
    {
      key: 'publishFailure', label: '최근 7일 게시 실패', value: publishFailure?.length ?? null,
      hint: publishFailure ? `확인이 필요한 게시${partial(input.publishing)}` : undefined,
      tone: publishFailure && publishFailure.length > 0 ? 'bad' : 'default', href: '/admin/publishing',
    },
    {
      key: 'channelProblems', label: '채널 연결 문제', value: channelProblems?.length ?? null,
      hint: channelProblems ? `재연결·권한 확인 필요${partial(input.channels)}` : undefined,
      tone: channelProblems && channelProblems.length > 0 ? 'warn' : 'default', href: '/admin/channels',
    },
    {
      key: 'lowCredit', label: '크레딧이 부족한 고객사', value: lowCredit?.length ?? null,
      hint: lowCredit ? `남은 크레딧 20% 이하${partial(input.billing)}` : undefined,
      tone: lowCredit && lowCredit.length > 0 ? 'warn' : 'default', href: '/admin/billing',
    },
    {
      key: 'support', label: '열려 있는 지원 세션', value: openSupport?.length ?? null,
      hint: openSupport ? `종료되지 않은 세션${partial(input.support)}` : undefined, tone: 'default', href: '/admin/workspaces',
    },
    {
      key: 'system', label: '시스템 경고', value: systemWarnings?.length ?? null,
      hint: systemWarnings ? '지연·오류가 관측된 항목' : undefined,
      tone: systemWarnings && systemWarnings.length > 0 ? 'bad' : 'default', href: '/admin/system',
    },
  ]

  const risks: HomeRisk[] = []
  if (publishFailure) {
    const byWorkspace = new Map<string, { name: string; titles: string[] }>()
    for (const p of publishFailure) {
      const entry = byWorkspace.get(p.workspaceId) ?? { name: p.workspaceName, titles: [] }
      entry.titles.push(p.contentTitle)
      byWorkspace.set(p.workspaceId, entry)
    }
    for (const [workspaceId, entry] of byWorkspace) {
      risks.push({
        id: `publish:${workspaceId}`, kind: 'publish_failed',
        title: `${entry.name} · 게시 실패 ${entry.titles.length}건`,
        detail: `최근 7일 · ${entry.titles.slice(0, 2).join(', ')}${entry.titles.length > 2 ? ' 외' : ''}`,
        href: '/admin/publishing',
      })
    }
  }
  for (const c of channelProblems ?? []) {
    risks.push({
      id: `channel:${c.workspaceId}:${c.channel}`, kind: 'channel_problem',
      title: `${c.workspaceName} · ${channelLabel(c.channel)} ${CHANNEL_PROBLEM_LABELS[c.connectionStatus]}`,
      detail: '연결이 끊기면 예약된 게시가 나가지 않을 수 있어요.', href: '/admin/channels',
    })
  }
  for (const b of lowCredit ?? []) {
    risks.push({
      id: `credit:${b.workspaceId}`, kind: 'low_credit', title: `${b.workspaceName} · 크레딧 부족`,
      detail: `남은 크레딧 ${(b.available ?? 0).toLocaleString('ko-KR')}`, href: `/admin/workspaces/${b.workspaceId}`,
    })
  }
  for (const s of systemWarnings ?? []) {
    risks.push({
      id: `system:${s.source}`, kind: 'system_warning',
      title: `${SYSTEM_SOURCE_LABELS[s.source] ?? '시스템 항목'} ${s.state === 'error' ? '오류' : '지연'}`,
      detail: '시스템 화면에서 최근 관측 내용을 확인하세요.', href: '/admin/system',
    })
  }
  if (input.onboarding) {
    for (const o of real(input.onboarding)) {
      const changed = time(o.changedAt)
      if (!o.lifecycleStatus || NOT_FINISHED_EXCLUDED.has(o.lifecycleStatus) || changed === null) continue
      const days = Math.floor((nowMs - changed) / DAY)
      if (days < STUCK_DAYS) continue
      risks.push({
        id: `onboarding:${o.workspaceId}`, kind: 'onboarding_stuck', title: `${o.workspaceName} · 가입 진행이 멈춰 있어요`,
        detail: `${lifecycleLabel(o.lifecycleStatus)} 단계에서 ${days}일째`, href: '/admin/onboarding',
      })
    }
  }

  const riskStatus = risks.length > 0 ? 'items' : failedSources.length > 0 ? 'unconfirmed' : 'clear'

  const recent = input.audit
    ? [...input.audit.items]
        .sort((a, b) => (time(b.createdAt) ?? 0) - (time(a.createdAt) ?? 0))
        .slice(0, 10)
        .map((e) => ({ id: e.id, text: auditEventText(e.action), workspaceName: e.workspaceName, result: e.result, createdAt: e.createdAt }))
    : null

  return { tiles, risks, riskStatus, recent, failedSources }
}
