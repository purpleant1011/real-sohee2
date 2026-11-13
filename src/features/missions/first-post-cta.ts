/**
 * 첫 포스팅 채널별 CTA 생성 (ANI-1775).
 *
 * ANI-1768 에서 "서버가 만들지 않으므로 미제공"으로 남겨 둔 `copies[channel].cta` 를
 * 서버가 확인한 근거로만 채운다. 근거가 없으면 필드 자체를 만들지 않는다(fail-closed).
 *
 * CTA 를 만들 수 있는 조건 (둘 다 필요):
 * - 채널 근거: 해당 채널이 연결되어 있고 계정 핸들이 확인됨(`connectedChannels`).
 *   연결 근거가 없는 채널에는 CTA 를 붙이지 않는다.
 * - 비즈니스 근거: 확정된 지식베이스의 대표 서비스 또는 영업시간.
 *   매장명만으로는 "무엇을 하러 오라"는 행동을 정할 수 없으므로 만들지 않는다.
 *
 * 문구는 확인된 값만 그대로 쓴다. 가격·할인·예약 가능 여부·후기·긴급성처럼
 * 확인되지 않은 주장은 넣지 않는다(승인 화면에 그대로 노출되는 값이다).
 *
 * 승인 지문(`calculateApprovalFingerprint`)은 CTA 가 있을 때만 canonical 객체에 싣는다.
 * CTA 가 없는 기존 초안의 지문은 이 변경 전과 같다.
 */
import type { ConnectedChannelInfo, ExactApprovalCopies } from './conversational-first-post'
import { composeFirstPostChannelText, fitsChannelTextLimit } from '@/features/publishing/meta-content-text'

/** CTA 한 줄의 최대 길이. 넘으면 다음 근거로 넘어가고, 모두 넘으면 생략한다. */
export const FIRST_POST_CTA_MAX_LENGTH = 60

export type FirstPostCtaChannel = 'instagram' | 'threads'

export interface FirstPostCtaEvidence {
  /** 확정된 매장명. 비어 있으면 비즈니스 근거가 없는 것으로 본다. */
  businessName?: string | null
  /** 확정된 대표 서비스/메뉴. 첫 값만 쓴다. */
  signatureServices?: readonly string[] | null
  /** 확정된 영업시간. */
  operatingHours?: string | null
  /** 연결된 채널. 핸들이 비어 있으면 연결 근거가 없는 것으로 본다. */
  connectedChannels: readonly Pick<ConnectedChannelInfo, 'provider' | 'handle'>[]
}

/** 한 줄짜리 문구로 정규화한다. 줄바꿈·중복 공백을 남기지 않는다. */
function inline(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function firstService(services: readonly string[] | null | undefined): string {
  if (!Array.isArray(services)) return ''
  for (const service of services) {
    const value = inline(service).replace(/[.!?。]+$/, '').trim()
    if (value) return value
  }
  return ''
}

/** 해당 채널의 연결 근거(확인된 핸들)가 있는가. */
function hasConnectedHandle(
  channel: FirstPostCtaChannel,
  channels: readonly Pick<ConnectedChannelInfo, 'provider' | 'handle'>[],
): boolean {
  return channels.some((entry) => entry?.provider === channel && inline(entry.handle).length > 0)
}

/**
 * 채널 1개의 CTA. 근거가 없거나 문구가 길이 제한을 넘으면 `null`(필드 생략).
 * 채널에 따라 다른 문구를 만들지 않는다. 같은 근거에서 같은 문장이 나온다.
 */
export function buildChannelCta(
  channel: FirstPostCtaChannel,
  evidence: FirstPostCtaEvidence,
): string | null {
  if (!hasConnectedHandle(channel, evidence.connectedChannels ?? [])) return null
  if (!inline(evidence.businessName)) return null

  const service = firstService(evidence.signatureServices)
  const hours = inline(evidence.operatingHours)

  const candidates: string[] = []
  if (service) candidates.push(`매장에서 ${service} 만나보세요.`)
  if (hours) candidates.push('영업시간 확인하고 편하게 방문해 주세요.')

  for (const candidate of candidates) {
    if (candidate.length <= FIRST_POST_CTA_MAX_LENGTH) return candidate
  }
  return null
}

/**
 * 채널별 CTA 를 붙인 새 copies 를 돌려준다.
 *
 * - 입력 객체를 변형하지 않는다.
 * - 근거가 없는 채널은 `cta` 키 자체가 없다(빈 문자열도 넣지 않는다 — M07 이 `NO_CTA` 로 막는다).
 * - 입력에 이미 `cta` 가 있어도 근거를 다시 판정해 없으면 제거한다(fail-closed).
 * - CTA 를 붙인 본문이 provider 글자수 제한(인스타 2,200 / 스레드 500)을 넘으면 CTA 를 접는다.
 *   승인한 원고를 깎아서 맞추지 않는다.
 */
export function attachFirstPostCtas(
  copies: ExactApprovalCopies,
  evidence: FirstPostCtaEvidence,
): ExactApprovalCopies {
  // 기존 cta 는 복사하지 않는다. 근거를 다시 판정한 결과만 남긴다.
  const instagram: ExactApprovalCopies['instagram'] = {
    caption: copies.instagram.caption,
    ...(copies.instagram.hashtags ? { hashtags: [...copies.instagram.hashtags] } : {}),
  }
  const threads: ExactApprovalCopies['threads'] = { content: copies.threads.content }

  // CTA 를 붙였을 때 provider 글자수 제한을 넘으면 게시 자체가 거부된다.
  // 그때는 CTA 만 접고 원고는 그대로 둔다(fail-closed — 승인한 본문을 깎지 않는다).
  const instagramCta = buildChannelCta('instagram', evidence)
  const instagramWithCta: ExactApprovalCopies['instagram'] = instagramCta
    ? { ...instagram, cta: instagramCta }
    : instagram
  const instagramFits = fitsChannelTextLimit(
    'instagram',
    composeFirstPostChannelText('instagram', { instagram: instagramWithCta, threads: { content: '' } }),
  )

  const threadsCta = buildChannelCta('threads', evidence)
  const threadsWithCta: ExactApprovalCopies['threads'] = threadsCta
    ? { ...threads, cta: threadsCta }
    : threads
  const threadsFits = fitsChannelTextLimit(
    'threads',
    composeFirstPostChannelText('threads', { instagram: { caption: '' }, threads: threadsWithCta }),
  )

  return {
    instagram: instagramFits ? instagramWithCta : instagram,
    threads: threadsFits ? threadsWithCta : threads,
  }
}
