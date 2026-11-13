import { describe, expect, it } from 'vitest'
import { readMobileCampaigns, type CampaignSourceResult } from './read-campaigns'
import type { CampaignCandidate } from '../campaigns-view'

const ctx = { workspaceId: 'ws-a', userId: 'u' }
const NOW = '2026-10-24T00:00:00.000Z'
const deps = (source: () => Promise<CampaignSourceResult>) => ({ now: () => NOW, readSource: source })

function candidate(workspaceId: string, slotWorkspaceId: string | null = null): CampaignCandidate {
  return {
    proposal: { id: 'p', workspaceId, kind: 'revisit', slotId: null, message: 'm', audienceIds: [], estimatedConversions: null, sentTo: [], approvedAt: null, dispatchIdempotencyKey: null },
    slot: slotWorkspaceId ? { id: 's', workspaceId: slotWorkspaceId, serviceLabel: 'x', startsAt: NOW, availability: 'confirmed_open', observedAt: NOW, sourceLabel: null } : null,
    channel: { channelLabel: '카카오', publishable: false, reason: null, next: null },
    ledger: {} as never,
    estimate: null, actualConversions: null, actualSource: null,
  }
}

describe('readMobileCampaigns', () => {
  it('원본 미연결은 빈 목록 ready 가 아니라 unknown + ok=false', async () => {
    const r = await readMobileCampaigns(ctx, deps(async () => ({ connected: false, candidates: [], customers: [], complete: false, observedAt: NOW })))
    expect(r.ok).toBe(false)
    expect(r.payload).toMatchObject({ loadState: 'unknown', sourceConnected: false, candidates: [], workspaceId: 'ws-a' })
  })

  it('조회 실패는 error', async () => {
    const r = await readMobileCampaigns(ctx, deps(async () => { throw new Error('db') }))
    expect(r.ok).toBe(false)
    expect(r.payload.loadState).toBe('error')
  })

  it('다른 매장 제안·슬롯·고객은 버리고 stale 로 낮춘다', async () => {
    const r = await readMobileCampaigns(ctx, deps(async () => ({
      connected: true, complete: true, observedAt: NOW,
      candidates: [candidate('ws-a'), candidate('ws-b'), candidate('ws-a', 'ws-b')],
      customers: [{ id: 'c1', workspaceId: 'ws-a' }, { id: 'c2', workspaceId: 'ws-b' }] as never,
    })))
    expect(r.ok).toBe(true)
    expect(r.payload.candidates).toHaveLength(1)
    expect(r.payload.customers.map(c => c.id)).toEqual(['c1'])
    expect(r.payload.loadState).toBe('stale')
  })

  it('같은 매장 완전 읽기는 ready + checkedAt', async () => {
    const r = await readMobileCampaigns(ctx, deps(async () => ({ connected: true, complete: true, observedAt: NOW, candidates: [candidate('ws-a')], customers: [] })))
    expect(r.payload).toMatchObject({ loadState: 'ready', checkedAt: NOW, now: NOW })
  })

  it('일부만 읽었으면 stale', async () => {
    const r = await readMobileCampaigns(ctx, deps(async () => ({ connected: true, complete: false, observedAt: NOW, candidates: [], customers: [] })))
    expect(r.payload.loadState).toBe('stale')
  })
})
