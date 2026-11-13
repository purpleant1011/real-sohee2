import { beforeEach, describe, expect, it } from 'vitest'
import {
  approveCampaign,
  type ApproveCampaignPorts,
  type ApproveCampaignInput,
  type ProposalRecord,
  type SlotRecord,
} from './approve-campaign'
import { MOBILE_CAMPAIGN_LANE, campaignFingerprint, campaignProposalId } from './proposal-identity'

const NOW = '2026-10-24T12:00:00.000Z'
const WS = 'ws-a'
const OTHER_WS = 'ws-b'
const SLOT = 'slot-1'
const STARTS = '2026-10-24T15:00:00.000Z'
const ENDS = '2026-10-24T16:00:00.000Z'
const VALID_UNTIL = '2026-10-24T12:15:00.000Z'
const CONSENTED = 2

const fingerprintFor = (o: Partial<Parameters<typeof campaignFingerprint>[0]> = {}) => campaignFingerprint({
  workspaceId: WS,
  slotId: SLOT,
  startsAt: STARTS,
  endsAt: ENDS,
  kind: 'empty_slot_rescue',
  consentedCustomerCount: CONSENTED,
  ...o,
})

function slotRecord(o: Partial<SlotRecord> = {}): SlotRecord {
  return {
    id: SLOT,
    workspaceId: WS,
    status: 'AVAILABLE',
    startsAt: STARTS,
    endsAt: ENDS,
    validUntil: VALID_UNTIL,
    confirmedAt: '2026-10-24T11:55:00.000Z',
    ...o,
  }
}

function input(o: Partial<ApproveCampaignInput> = {}): ApproveCampaignInput {
  return {
    workspaceId: WS,
    proposalId: campaignProposalId(WS, SLOT),
    slotId: SLOT,
    expectedFingerprint: fingerprintFor(),
    idempotencyKey: 'key-1',
    ...o,
  }
}

interface Store {
  slots: Map<string, SlotRecord>
  reservations: Set<string>
  proposals: Map<string, ProposalRecord>
  consented: Map<string, number>
  /** CAS 경쟁에서 진 상황을 흉내 내기 위한 테스트 훅. */
  casLose: boolean
  fail: { slot: boolean; reservation: boolean; customer: boolean; proposal: boolean; insert: boolean; update: boolean }
}

const keyOf = (workspaceId: string, id: string) => `${workspaceId}|${id}`

/** 실제 PostgREST 대신 메모리 맵. INSERT 의 PK 경쟁은 check-and-set 한 틱 안에서 원자적으로 흉내 낸다. */
function createStore(): Store {
  return {
    slots: new Map(),
    reservations: new Set(),
    proposals: new Map(),
    consented: new Map(),
    casLose: false,
    fail: { slot: false, reservation: false, customer: false, proposal: false, insert: false, update: false },
  }
}

function createPorts(store: Store): ApproveCampaignPorts {
  return {
    now: () => NOW,
    async getSlot(workspaceId, slotId) {
      if (store.fail.slot) throw new Error('slot_read_failed')
      return store.slots.get(keyOf(workspaceId, slotId)) ?? null
    },
    async hasConfirmedReservation(workspaceId, slotId) {
      if (store.fail.reservation) throw new Error('reservation_read_failed')
      return store.reservations.has(keyOf(workspaceId, slotId))
    },
    async countConsentedCustomers(workspaceId) {
      if (store.fail.customer) throw new Error('customer_read_failed')
      return store.consented.get(workspaceId) ?? 0
    },
    async getProposal(workspaceId, proposalId) {
      if (store.fail.proposal) throw new Error('proposal_read_failed')
      return store.proposals.get(keyOf(workspaceId, proposalId)) ?? null
    },
    async findApprovedProposalForSlot(workspaceId, slotId, excludeProposalId) {
      if (store.fail.proposal) throw new Error('proposal_read_failed')
      for (const [key, row] of store.proposals) {
        if (!key.startsWith(`${workspaceId}|`)) continue
        if (row.proposalId === excludeProposalId) continue
        if (row.status !== 'APPROVED') continue
        if (row.envelope?.lane !== MOBILE_CAMPAIGN_LANE || row.envelope?.slotId !== slotId) continue
        return row
      }
      return null
    },
    async insertApprovedProposal(row) {
      if (store.fail.insert) throw new Error('insert_failed')
      const key = keyOf(row.workspaceId, row.proposalId)
      if (store.proposals.has(key)) return 'duplicate'
      store.proposals.set(key, {
        proposalId: row.proposalId,
        status: 'APPROVED',
        envelope: row.proposedEnvelope,
        createdAt: NOW,
      })
      return 'inserted'
    },
    async transitionToApproved(workspaceId, proposalId, patch) {
      if (store.fail.update) throw new Error('update_failed')
      if (store.casLose) return false
      const key = keyOf(workspaceId, proposalId)
      const row = store.proposals.get(key)
      if (!row || row.status !== 'PROPOSED') return false
      store.proposals.set(key, { ...row, status: 'APPROVED', envelope: patch.proposedEnvelope })
      return true
    },
  }
}

function seed(store: Store, workspaceId = WS, slotId = SLOT) {
  store.slots.set(keyOf(workspaceId, slotId), slotRecord({ workspaceId, id: slotId }))
  store.consented.set(workspaceId, CONSENTED)
}

describe('approveCampaign (ANI-1697)', () => {
  let store: Store
  let ports: ApproveCampaignPorts

  beforeEach(() => {
    store = createStore()
    ports = createPorts(store)
    seed(store)
  })

  it('(a) 정상 승인은 200 이고 work_proposals 상태를 APPROVED 로 남긴다', async () => {
    const out = await approveCampaign(input(), ports)
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ approved: true, decidedAt: NOW, externalPublishCount: 0 })
    const stored = store.proposals.get(keyOf(WS, campaignProposalId(WS, SLOT)))
    expect(stored?.status).toBe('APPROVED')
    expect(stored?.envelope).toMatchObject({
      lane: MOBILE_CAMPAIGN_LANE,
      kind: 'empty_slot_rescue',
      slotId: SLOT,
      fingerprint: fingerprintFor(),
      idempotencyKey: 'key-1',
      decidedAt: NOW,
    })
  })

  it('(b) 같은 슬롯에 다른 제안으로 두 번째 승인하면 409', async () => {
    expect((await approveCampaign(input(), ports)).status).toBe(200)
    const second = await approveCampaign(input({ proposalId: campaignProposalId(WS, `${SLOT}-other`), idempotencyKey: 'key-2' }), ports)
    expect(second.status).toBe(409)
    expect(second.body).toEqual({ error: 'SLOT_ALREADY_RESERVED' })
  })

  it('(c) 동시 승인 2건은 정확히 1건만 성공하고 다른 1건은 409', async () => {
    const results = await Promise.allSettled([approveCampaign(input(), ports), approveCampaign(input(), ports)])
    const values = results.map(r => (r.status === 'fulfilled' ? r.value : null))
    expect(values.filter(v => v?.status === 200)).toHaveLength(1)
    expect(values.filter(v => v?.status === 409)).toHaveLength(1)
    expect(store.proposals.size).toBe(1)
  })

  it('(d) 지문이 다르면 409 + 현재 지문을 돌려준다', async () => {
    const out = await approveCampaign(input({ expectedFingerprint: 'f'.repeat(64) }), ports)
    expect(out.status).toBe(409)
    expect(out.body).toEqual({ error: 'FINGERPRINT_MISMATCH', currentFingerprint: fingerprintFor() })
    expect(store.proposals.size).toBe(0)
  })

  it('(e) 같은 키 재전송은 새 쓰기 없이 200 replayed, 다른 키는 409', async () => {
    expect((await approveCampaign(input(), ports)).status).toBe(200)
    const replay = await approveCampaign(input(), ports)
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ approved: true, replayed: true, decidedAt: NOW, externalPublishCount: 0 })
    const different = await approveCampaign(input({ idempotencyKey: 'key-2' }), ports)
    expect(different.status).toBe(409)
    expect(different.body).toEqual({ error: 'ALREADY_RESOLVED' })
    expect(store.proposals.size).toBe(1)
  })

  it('(f) 슬롯 조회 실패는 빈 결과가 아니라 503', async () => {
    store.fail.slot = true
    const out = await approveCampaign(input(), ports)
    expect(out.status).toBe(503)
    expect(out.body).toEqual({ error: 'SLOT_CHECK_UNAVAILABLE' })
  })

  it('(g) 만료·BOOKED 슬롯은 409', async () => {
    store.slots.set(keyOf(WS, SLOT), slotRecord({ validUntil: '2026-10-24T11:59:00.000Z' }))
    expect((await approveCampaign(input(), ports)).status).toBe(409)
    store.slots.set(keyOf(WS, SLOT), slotRecord({ status: 'BOOKED' }))
    const booked = await approveCampaign(input(), ports)
    expect(booked.status).toBe(409)
    expect(booked.body).toEqual({ error: 'SLOT_ALREADY_RESERVED' })
  })

  it('확정 예약이 이미 있으면 409, 예약 조회 실패는 503', async () => {
    store.reservations.add(keyOf(WS, SLOT))
    expect((await approveCampaign(input(), ports)).status).toBe(409)
    store.reservations.delete(keyOf(WS, SLOT))
    store.fail.reservation = true
    const out = await approveCampaign(input(), ports)
    expect(out.status).toBe(503)
    expect(out.body).toEqual({ error: 'SLOT_CHECK_UNAVAILABLE' })
  })

  it('(h) 다른 워크스페이스의 같은 슬롯 id 승인은 서로 영향을 주지 않는다', async () => {
    seed(store, OTHER_WS, SLOT)
    const a = await approveCampaign(input(), ports)
    const b = await approveCampaign(input({
      workspaceId: OTHER_WS,
      proposalId: campaignProposalId(OTHER_WS, SLOT),
      expectedFingerprint: fingerprintFor({ workspaceId: OTHER_WS }),
      idempotencyKey: 'key-b',
    }), ports)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(store.proposals.size).toBe(2)
  })

  it('동의 고객 수 조회가 실패하면 지문을 지어내지 않고 503', async () => {
    store.fail.customer = true
    const out = await approveCampaign(input(), ports)
    expect(out.status).toBe(503)
    expect(out.body).toEqual({ error: 'FINGERPRINT_CHECK_UNAVAILABLE' })
  })

  it('PROPOSED 행은 CAS 갱신으로 승인되고, 경쟁에서 지면 409', async () => {
    store.proposals.set(keyOf(WS, campaignProposalId(WS, SLOT)), {
      proposalId: campaignProposalId(WS, SLOT),
      status: 'PROPOSED',
      envelope: null,
      createdAt: NOW,
    })
    const out = await approveCampaign(input(), ports)
    expect(out.status).toBe(200)
    expect(store.proposals.get(keyOf(WS, campaignProposalId(WS, SLOT)))?.status).toBe('APPROVED')

    store.proposals.set(keyOf(WS, campaignProposalId(WS, SLOT)), {
      proposalId: campaignProposalId(WS, SLOT),
      status: 'PROPOSED',
      envelope: null,
      createdAt: NOW,
    })
    store.casLose = true
    const loser = await approveCampaign(input({ idempotencyKey: 'key-2' }), ports)
    expect(loser.status).toBe(409)
    expect(loser.body).toEqual({ error: 'ALREADY_RESOLVED' })
  })
})
