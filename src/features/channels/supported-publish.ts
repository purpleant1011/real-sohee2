/**
 * [ANI-1707] "연결됨"과 "소희가 대신 게시할 수 있음"은 다른 축이다.
 *
 * 이 모듈은 채널별로 **게시(외부 write) 기능 자체가 열려 있는지**만 판정한다.
 * 지금 게시가 가능한지(연결·검증·심사 상태)는 `verified`·`status` 가 따로 답한다.
 *
 * 판정 근거는 보관 승인 정책(`features/vault/approval-policy`) 한 곳에서만 가져온다.
 * 화면·매퍼가 채널 목록을 따로 들고 있으면 정책이 바뀔 때 조용히 어긋나기 때문이다.
 *
 * - instagram / threads: Meta 검증 경로가 있고, 정책상 게시가 허용된다(연결·검증은 별도 조건).
 * - naver_blog / daangn: 정책이 "연동 준비 중"으로 외부 게시를 막는다 → false.
 * - naver_place: 서버에 발행 경로 자체가 없다 → false.
 */
import { evaluateApprovalActions } from '@/features/vault/approval-policy'
import type { ChannelType } from '@/features/vault/channel-spec/types'

export type PublishSupportChannelId = 'instagram' | 'threads' | 'naver_blog' | 'naver_place' | 'daangn'

/** 모바일 채널 id → 승인 정책 채널 타입. 매핑이 없는 채널(플레이스)은 발행 경로가 없다. */
const CHANNEL_TYPE: Partial<Record<PublishSupportChannelId, ChannelType>> = {
  instagram: 'instagram',
  threads: 'threads',
  naver_blog: 'naver_blog',
  daangn: 'daangn_business',
}

/**
 * 연결·검증·앱 심사가 모두 완벽하다고 가정해도 게시가 막히면 "기능 자체가 없다"로 본다.
 * 그래서 실제 연결 상태가 아니라 최선의 조건을 넣어 정책만 확인한다.
 */
export function isPublishSupported(channel: PublishSupportChannelId): boolean {
  const channelType = CHANNEL_TYPE[channel]
  if (!channelType) return false

  return evaluateApprovalActions({
    channel: channelType,
    readiness: 'PUBLISH_READY',
    connection: 'VERIFIED',
    providerReviewStatus: 'APPROVED',
    specResult: { blocksVault: false },
    targetTime: null,
  }).PUBLISH.allowed
}
