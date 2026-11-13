import { createHash } from 'node:crypto'

/**
 * M18 캠페인 제안의 식별자 계약(ANI-1697).
 *
 * 제안 저장소는 기존 `work_proposals` 표를 그대로 쓴다(마이그레이션 없음).
 * 다른 lane(자율 실행·성장 제안)과 섞이지 않도록 `lane` 을 envelope 안에 남긴다.
 */
export const MOBILE_CAMPAIGN_LANE = 'mobile_r2_campaigns'
export const MOBILE_CAMPAIGN_ENVELOPE_VERSION = 1
export const MOBILE_CAMPAIGN_KIND = 'empty_slot_rescue'

/**
 * `work_proposals.proposal_id` 는 전역 PK 다. 슬롯 하나에 제안 하나만 존재하도록
 * 워크스페이스·슬롯으로 결정적으로 만든다. 승인 CAS 도 이 문자열을 그대로 쓴다.
 */
export function campaignProposalId(workspaceId: string, slotId: string): string {
  return `campaign:${workspaceId}:${slotId}`
}

export interface CampaignFingerprintInput {
  workspaceId: string
  slotId: string
  startsAt: string
  endsAt: string
  kind: string
  /** 수신 동의가 확인된 고객 수. 제안 승인 직전에 다시 세어 같은 값이어야 한다. */
  consentedCustomerCount: number
}

/**
 * 제안 지문. 같은 슬롯·같은 대상이면 항상 같은 64자 소문자 hex 가 나온다.
 * 화면이 들고 있던 지문과 승인 직전 재계산 값이 다르면 승인을 닫는다(409).
 * 입력 순서를 바꾸지 말 것 — 바꾸면 기존 제안의 지문이 전부 달라진다.
 */
export function campaignFingerprint(input: CampaignFingerprintInput): string {
  const canonical = [
    'campaign-fingerprint:v1',
    input.workspaceId,
    input.slotId,
    input.startsAt,
    input.endsAt,
    input.kind,
    String(input.consentedCustomerCount),
  ].join('\n')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
