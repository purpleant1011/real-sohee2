import type { CampaignsViewSnapshot } from '@/features/mobile-campaigns/campaigns-view'
import type { MobileCustomerDto } from '@/features/mobile-customers/customer-model'

/**
 * M18 캠페인 제안 승인 카드 육안 검수용 고정 픽스처.
 *
 * 실제 매장 데이터가 아니다. 로그인이 없는 개발 환경에서 승인 카드와
 * '승인했어요' 문구 노출 시점을 보기 위한 값이며, 운영 증거로 쓰지 않는다.
 */
export const FIXTURE_WORKSPACE_ID = '00000000-0000-4000-8000-0000000000c1'
export const FIXTURE_SLOT_ID = 'slot-fixture-1'
export const FIXTURE_PROPOSAL_ID = `campaign:${FIXTURE_WORKSPACE_ID}:${FIXTURE_SLOT_ID}`
export const FIXTURE_FINGERPRINT = 'f'.repeat(64)

/** 승인 쓰기 응답을 늦춰 '응답 전 문구 없음'을 눈으로 볼 수 있게 한다. */
export const FIXTURE_APPROVE_DELAY_MS = 3000

const customer: MobileCustomerDto = {
  id: 'customer-fixture-1',
  workspaceId: FIXTURE_WORKSPACE_ID,
  displayName: '김민지',
  segment: 'revisit',
  consent: { status: 'granted', checkedAt: null, source: '예약 시 동의' },
  verifiedContacts: ['message'],
  lastAction: null,
  sourceLabel: null,
}

export function buildCampaignsPayload(now = new Date()): Record<string, unknown> {
  const nowIso = now.toISOString()
  const startsAt = new Date(now.getTime() + 26 * 60 * 60 * 1000).toISOString()
  const candidate: CampaignsViewSnapshot['candidates'][number] = {
    proposal: {
      id: FIXTURE_PROPOSAL_ID,
      workspaceId: FIXTURE_WORKSPACE_ID,
      kind: 'empty_slot_rescue',
      slotId: FIXTURE_SLOT_ID,
      message: '내일 오후 3시 자리가 비었어요. 오랜만에 들러 주세요.',
      audienceIds: [customer.id],
      estimatedConversions: 1,
      sentTo: [],
      approvedAt: null,
      dispatchIdempotencyKey: 'dispatch-fixture-1',
    },
    slot: {
      id: FIXTURE_SLOT_ID,
      workspaceId: FIXTURE_WORKSPACE_ID,
      serviceLabel: '속눈썹 연장',
      startsAt,
      availability: 'confirmed_open',
      observedAt: nowIso,
      sourceLabel: '예약표',
    },
    channel: { channelLabel: '인스타그램', publishable: true, reason: null, next: null },
    ledger: { available: 100, reserved: 0, consumed: 0, refunded: 0, observedAt: nowIso },
    estimate: 5,
    actualConversions: null,
    actualSource: null,
    fingerprint: FIXTURE_FINGERPRINT,
  }

  return {
    workspaceId: FIXTURE_WORKSPACE_ID,
    loadState: 'ready',
    candidates: [candidate],
    customers: [customer],
    now: nowIso,
    checkedAt: nowIso,
    sourceConnected: true,
  }
}

/** 증거 스크립트가 읽는 승인 요청/응답 시각(ms, 페이지 기준). */
export interface CampaignFixtureTiming {
  approveCalls: number
  requestAt: number
  responseAt: number
  delayMs: number
}

type FixtureGlobal = typeof globalThis & { __campaignFixture?: CampaignFixtureTiming }

const LIST_PATH = /\/api\/workspaces\/[^/]+\/mobile-campaigns$/
const APPROVE_PATH = /\/api\/workspaces\/[^/]+\/mobile-campaigns\/approve$/

function toPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return new URL(raw, globalThis.location.origin).pathname
  } catch {
    return null
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * 개발 하네스 전용 fetch 대역. 우리 매장 캠페인 API 두 개만 가로채고 나머지는 원래 fetch 로 넘긴다.
 * 승인 POST 는 일부러 늦게 응답하며, 요청·응답 시각을 window 에 남겨 '문구 노출 시점'을 대조한다.
 */
export function createCampaignFixtureFetch(original: typeof fetch, delayMs = FIXTURE_APPROVE_DELAY_MS): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = toPath(input)

    if (path && APPROVE_PATH.test(path) && init?.method === 'POST') {
      const scope = globalThis as FixtureGlobal
      const requestAt = performance.now()
      scope.__campaignFixture = {
        approveCalls: (scope.__campaignFixture?.approveCalls ?? 0) + 1,
        requestAt,
        responseAt: Number.POSITIVE_INFINITY,
        delayMs,
      }
      await new Promise(resolve => setTimeout(resolve, delayMs))
      scope.__campaignFixture = { ...scope.__campaignFixture, responseAt: performance.now() }
      return jsonResponse({ approved: true, decidedAt: new Date().toISOString(), externalPublishCount: 0 })
    }

    if (path && LIST_PATH.test(path)) return jsonResponse(buildCampaignsPayload())

    return original(input, init)
  }
}
