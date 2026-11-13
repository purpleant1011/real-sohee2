import { describe, expect, it } from 'vitest'
import { buildOperatorHome, auditEventText, type OperatorHomeInput } from './operator-home'

const NOW = new Date('2026-10-08T03:00:00.000Z')
const WS_A = '48000000-0000-4000-8000-000000000001'
const WS_B = '48000000-0000-4000-8000-000000000002'

function input(overrides: Partial<OperatorHomeInput> = {}): OperatorHomeInput {
  return {
    workspaces: { items: [
      { workspaceId: WS_A, workspaceName: '고객사 A', workspaceKind: 'production', lifecycleStatus: 'active' },
      { workspaceId: WS_B, workspaceName: '고객사 B', workspaceKind: 'production', lifecycleStatus: 'channel_pending' },
      { workspaceId: 'ws-demo', workspaceName: '체험', workspaceKind: 'demo', lifecycleStatus: 'active' },
    ], truncated: false },
    onboarding: [],
    channels: { items: [], truncated: false },
    publishing: { items: [], truncated: false },
    billing: { items: [], truncated: false },
    audit: { items: [] },
    support: { items: [], truncated: false },
    system: { items: [] },
    ...overrides,
  }
}
const tile = (r: ReturnType<typeof buildOperatorHome>, key: string) => r.tiles.find((t) => t.key === key)!

describe('buildOperatorHome tiles', () => {
  it('counts workspaces excluding demo and reports active ones', () => {
    const r = buildOperatorHome(input(), NOW)
    expect(tile(r, 'workspaces').value).toBe(2)
    expect(tile(r, 'workspaces').hint).toBe('운영 중 1곳')
    expect(tile(r, 'workspaces').href).toBe('/admin/workspaces?member=formal')
  })

  it('uses authoritative formal membership count and hints unverified applicants', () => {
    const r = buildOperatorHome(input({
      memberships: { formalCount: 15, applicantCount: 8 },
    }), NOW)
    expect(tile(r, 'workspaces').value).toBe(15)
    expect(tile(r, 'workspaces').hint).toBe('가입자(미인증) 8곳')
    expect(tile(r, 'applicants').value).toBe(8)
    expect(r.failedSources).not.toContain('고객사')
  })

  it('fails closed with null and reports failed source when membership overview read fails', () => {
    const r = buildOperatorHome(input({
      memberships: null,
    }), NOW)
    expect(tile(r, 'workspaces').value).toBeNull()
    expect(r.failedSources).toContain('고객사')
  })

  it('marks a truncated workspace list as a lower bound instead of an exact count', () => {
    const r = buildOperatorHome(input({ workspaces: { items: input().workspaces!.items, truncated: true } }), NOW)
    expect(tile(r, 'workspaces').value).toBe('2곳 이상')
  })

  it('counts publish success and failure in the last 7 days only', () => {
    const base = { workspaceId: WS_A, workspaceName: '고객사 A', channel: 'instagram', contentTitle: '봄 신상', scheduleAt: null }
    const r = buildOperatorHome(input({ publishing: { truncated: false, items: [
      { ...base, displayState: 'success', publishedAt: '2026-10-07T00:00:00.000Z', publishAt: null },
      { ...base, displayState: 'success', publishedAt: '2026-09-20T00:00:00.000Z', publishAt: null },
      { ...base, displayState: 'failure', publishedAt: null, publishAt: '2026-10-06T00:00:00.000Z' },
      { ...base, displayState: 'pending', publishedAt: null, publishAt: '2026-10-09T00:00:00.000Z' },
    ] } }), NOW)
    expect(tile(r, 'publishSuccess').value).toBe(1)
    expect(tile(r, 'publishFailure').value).toBe(1)
    expect(tile(r, 'publishFailure').tone).toBe('bad')
  })

  it('shows value null and lists the Korean source name when a source failed', () => {
    const r = buildOperatorHome(input({ publishing: null, billing: null }), NOW)
    expect(tile(r, 'publishSuccess').value).toBeNull()
    expect(tile(r, 'publishFailure').value).toBeNull()
    expect(tile(r, 'lowCredit').value).toBeNull()
    expect(tile(r, 'workspaces').value).toBe(2)
    expect(r.failedSources).toEqual(['게시', '결제·크레딧'])
  })

  it('counts channel problems (expired, error, ...) but not simply disconnected channels', () => {
    const c = (connectionStatus: string, workspaceId = WS_A) => ({ workspaceId, workspaceName: '고객사 A', channel: 'instagram', connectionStatus })
    const r = buildOperatorHome(input({ channels: { truncated: false, items: [c('connected'), c('expired'), c('provider_error'), c('disconnected')] } }), NOW)
    expect(tile(r, 'channelProblems').value).toBe(2)
  })

  it('counts low-credit workspaces using the weekly limit and ignores unknown balances', () => {
    const b = (workspaceId: string, available: number | null, weeklyLimit: number | null) => ({ workspaceId, workspaceName: workspaceId, available, weeklyLimit })
    const r = buildOperatorHome(input({ billing: { truncated: false, items: [
      b(WS_A, 5, 100), b(WS_B, 80, 100), b('x', null, 100), b('y', 0, null), b('z', 3, null),
    ] } }), NOW)
    expect(tile(r, 'lowCredit').value).toBe(2)
  })

  it('counts only unexpired active support sessions', () => {
    const s = (status: string, expiresAt: string) => ({ workspaceId: WS_A, status, startedAt: '2026-10-08T01:00:00.000Z', expiresAt })
    const r = buildOperatorHome(input({ support: { truncated: false, items: [
      s('active', '2026-10-08T05:00:00.000Z'), s('active', '2026-10-08T02:00:00.000Z'), s('ended', '2026-10-08T05:00:00.000Z'),
    ] } }), NOW)
    expect(tile(r, 'support').value).toBe(1)
  })

  it('counts degraded or errored system observations', () => {
    const r = buildOperatorHome(input({ system: { items: [
      { source: 'queue', state: 'degraded' }, { source: 'cron', state: 'healthy' }, { source: 'cloudflare', state: 'error' }, { source: 'release', state: 'unknown' },
    ] } }), NOW)
    expect(tile(r, 'system').value).toBe(2)
  })
})

describe('buildOperatorHome attention list', () => {
  it('is clear only when every source succeeded and nothing needs attention', () => {
    expect(buildOperatorHome(input(), NOW).riskStatus).toBe('clear')
  })

  it('is unconfirmed (never clear) when a source failed and nothing was found', () => {
    const r = buildOperatorHome(input({ channels: null }), NOW)
    expect(r.risks).toEqual([])
    expect(r.riskStatus).toBe('unconfirmed')
  })

  it('derives rows only from real data with links and puts failures first', () => {
    const r = buildOperatorHome(input({
      publishing: { truncated: false, items: [{ workspaceId: WS_A, workspaceName: '고객사 A', channel: 'instagram', contentTitle: '봄 신상', displayState: 'failure', publishedAt: null, publishAt: '2026-10-07T00:00:00.000Z', scheduleAt: null }] },
      channels: { truncated: false, items: [{ workspaceId: WS_B, workspaceName: '고객사 B', channel: 'threads', connectionStatus: 'expired' }] },
      billing: { truncated: false, items: [{ workspaceId: WS_A, workspaceName: '고객사 A', available: 2, weeklyLimit: 100 }] },
      onboarding: [{ workspaceId: WS_B, workspaceName: '고객사 B', lifecycleStatus: 'channel_pending', changedAt: '2026-09-20T00:00:00.000Z' }],
    }), NOW)
    expect(r.riskStatus).toBe('items')
    expect(r.risks.map((x) => x.kind)).toEqual(['publish_failed', 'channel_problem', 'low_credit', 'onboarding_stuck'])
    expect(r.risks[0]).toMatchObject({ title: '고객사 A · 게시 실패 1건', href: '/admin/publishing' })
    expect(r.risks[1].title).toBe('고객사 B · 스레드 재연결 필요')
    expect(r.risks[2].href).toBe(`/admin/workspaces/${WS_A}`)
    expect(r.risks[3].detail).toContain('채널 연결 대기')
  })

  it('does not flag fresh onboarding or finished lifecycle states', () => {
    const r = buildOperatorHome(input({ onboarding: [
      { workspaceId: WS_B, workspaceName: '고객사 B', lifecycleStatus: 'channel_pending', changedAt: '2026-10-07T00:00:00.000Z' },
      { workspaceId: WS_A, workspaceName: '고객사 A', lifecycleStatus: 'active', changedAt: '2026-01-01T00:00:00.000Z' },
    ] }), NOW)
    expect(r.risks).toEqual([])
  })

  it('never leaks demo workspaces into numbers or rows', () => {
    const r = buildOperatorHome(input({ channels: { truncated: false, items: [{ workspaceId: 'ws-demo', workspaceName: '체험', channel: 'instagram', connectionStatus: 'error' }] } }), NOW)
    expect(tile(r, 'channelProblems').value).toBe(0)
    expect(r.risks).toEqual([])
  })
})

describe('recent activity', () => {
  it('returns the latest 10 events with Korean text and no raw action codes', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: String(i), action: 'credit.adjust.applied', workspaceName: '고객사 A', result: 'succeeded' as const, createdAt: `2026-10-08T0${i % 10}:00:00.000Z`,
    }))
    const r = buildOperatorHome(input({ audit: { items } }), NOW)
    expect(r.recent).toHaveLength(10)
    expect(r.recent![0].text).toBe('크레딧 조정 적용')
    expect(r.recent![0].text).not.toMatch(/credit|\./u)
  })

  it('translates known action codes and falls back to a neutral label', () => {
    expect(auditEventText('publish.retry.applied')).toBe('게시 재시도 적용')
    expect(auditEventText('audit.export.global.requested')).toBe('감사 기록 내보내기 요청')
    expect(auditEventText('totally.unknown_thing')).toBe('운영 작업')
  })
})
