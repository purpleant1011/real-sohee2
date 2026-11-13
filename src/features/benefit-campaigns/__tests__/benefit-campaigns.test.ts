import { describe, it, expect } from 'vitest'
import {
  createBenefitCampaignDraft,
  executeBatchBenefitGrant,
  generateGrantIdempotencyKey,
  ESTIMATED_COGS_KRW_PER_1000_SC,
} from '../lifecycle'

describe('Benefit Campaign Lifecycle & Batch Execution (ANI-403, ANI-429)', () => {
  it('creates draft campaign and computes estimated COGS accurately', () => {
    const draft = createBenefitCampaignDraft({
      type: 'PROMO_CREDIT',
      title: '9월 오픈 기념 전사 1,000 SC 선물 🎁',
      message: '소희팀에서 마케팅 응원을 위해 1,000 SC를 선물합니다.',
      audienceRule: { target: 'ALL_ACTIVE' },
      perWorkspaceSc: 1000,
      estimatedAudienceCount: 200,
      createdBy: 'admin-1',
    })

    expect(draft.status).toBe('DRAFT')
    expect(draft.perWorkspaceSc).toBe(1000)
    expect(draft.totalRecipientsCount).toBe(200)
    // 200명 * 1,000 SC = 200,000 SC -> (200,000 / 1,000) * 150원 = 30,000원 COGS
    expect(draft.estimatedCogsKrw).toBe(30000)
  })

  it('guarantees 100% idempotency during bulk grants (10,000 recipients test)', () => {
    const campaign = createBenefitCampaignDraft({
      type: 'WELCOME_GIFT',
      title: '가입 축하 선물',
      message: '반갑습니다!',
      audienceRule: { target: 'ALL_ACTIVE' },
      perWorkspaceSc: 500,
      estimatedAudienceCount: 10000,
      createdBy: 'admin-1',
    })

    // 10,000개 워크스페이스 ID 생성
    const targetWorkspaceIds = Array.from({ length: 10000 }, (_, i) => `ws-${i}`)

    // 1차 실행
    const firstRun = executeBatchBenefitGrant(campaign, targetWorkspaceIds)
    expect(firstRun.successfulGrants.length).toBe(10000)
    expect(firstRun.failedGrants.length).toBe(0)
    expect(firstRun.totalGrantedSc).toBe(5000000)

    // 2차 재실행 (동일 입력 및 1차 결과 전달 -> 중복 지급 0건 확인)
    const secondRun = executeBatchBenefitGrant(campaign, targetWorkspaceIds, firstRun.successfulGrants)
    expect(secondRun.successfulGrants.length).toBe(10000)
    expect(secondRun.failedGrants.length).toBe(0)
    // 총 누적 지급액이 증가하지 않고 동일하게 유지됨
    expect(secondRun.totalGrantedSc).toBe(5000000)
  })

  it('replays existing grants without per-recipient linear scans', () => {
    const campaign = createBenefitCampaignDraft({
      type: 'WELCOME_GIFT',
      title: '인덱스 멱등성 검증',
      message: '반갑습니다!',
      audienceRule: { target: 'ALL_ACTIVE' },
      perWorkspaceSc: 500,
      estimatedAudienceCount: 3,
      createdBy: 'admin-1',
    })
    const targetWorkspaceIds = ['ws-a', 'ws-b', 'ws-c']
    const firstRun = executeBatchBenefitGrant(campaign, targetWorkspaceIds)

    Object.defineProperty(firstRun.successfulGrants, 'find', {
      value: () => {
        throw new Error('linear scan forbidden')
      },
    })

    const replay = executeBatchBenefitGrant(campaign, targetWorkspaceIds, firstRun.successfulGrants)
    expect(replay.successfulGrants).toHaveLength(3)
    expect(replay.failedGrants).toHaveLength(0)
    expect(replay.totalGrantedSc).toBe(1500)
  })

  it('enforces budget cap and halts further grants when exceeded', () => {
    const campaign = createBenefitCampaignDraft({
      type: 'COMPENSATION',
      title: '네이버 자동화 지연 보상',
      message: '불편을 드려 죄송합니다.',
      audienceRule: { target: 'INCIDENT_AFFECTED' },
      perWorkspaceSc: 1000,
      budgetCapSc: 3000, // 최대 3명까지만 지급 가능
      estimatedAudienceCount: 5,
      createdBy: 'admin-1',
    })

    const targetWorkspaceIds = ['ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5']
    const result = executeBatchBenefitGrant(campaign, targetWorkspaceIds)

    expect(result.successfulGrants.length).toBe(3)
    expect(result.failedGrants.length).toBe(2)
    expect(result.totalGrantedSc).toBe(3000)
    expect(result.failedGrants[0].error).toContain('예산 상한(Budget Cap)을 초과')
  })
})
