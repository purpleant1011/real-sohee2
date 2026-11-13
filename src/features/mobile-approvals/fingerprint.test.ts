import { describe, expect, it } from 'vitest'
import {
  approvalFingerprint,
  bookingApprovalFingerprint,
  type ApprovalBindingInput,
  type BookingApprovalBindingInput,
} from '@/features/booking-recovery/approval-binding'
import { computeApprovalFingerprint as computeCommentApprovalFingerprint } from '@/features/engagement/draft'
import { computeDmApprovalFingerprint } from '@/features/engagement/dm/options-generator'
import {
  calculateApprovalFingerprint,
  type CanonicalApprovalInput,
} from '@/lib/evidence/approval-fingerprint'
import {
  MOBILE_APPROVAL_FINGERPRINT_KINDS,
  UNSUPPORTED_MOBILE_APPROVAL_FINGERPRINT_KINDS,
  computeMobileApprovalFingerprint,
  isMobileApprovalFingerprintKind,
  type MobileApprovalFingerprintInput,
  type MobileApprovalFingerprintKind,
} from './fingerprint'

const SHA256_HEX = /^[a-f0-9]{64}$/

const dmInput = {
  kind: 'dm' as const,
  workspaceId: 'ws-1',
  threadId: 'th-1',
  draftText: '안녕하세요, 예약 도와드릴게요.',
}

const commentInput = {
  kind: 'comment' as const,
  workspaceId: 'ws-1',
  commentId: 'cm-1',
  draftText: '감사합니다! 내일 뵙겠습니다.',
}

const bookingSendBinding: ApprovalBindingInput = {
  workspaceId: 'ws-1',
  caseId: 'case-1',
  recipientRef: 'ref-1',
  sourceInboundMessageId: 'msg-1',
  replyText: '예약 가능한 시간 안내드립니다.',
  catalogVersion: 'cat-7',
  slotVersion: 3,
}

const bookingConfirmBinding: BookingApprovalBindingInput = {
  workspaceId: 'ws-1',
  caseId: 'case-1',
  slotId: 'slot-1',
  serviceId: 'service-1',
  totalAmountKrw: 120000,
  depositKrw: 30000,
  customerRef: 'customer-1',
  acceptedMessageId: 'msg-2',
  proposalRevision: 4,
  catalogVersion: 'cat-7',
  slotVersion: 3,
}

const bookingSendInput = { kind: 'booking_send' as const, binding: bookingSendBinding }
const bookingConfirmInput = { kind: 'booking_confirm' as const, binding: bookingConfirmBinding }

const postPayload: CanonicalApprovalInput = {
  workspaceId: 'ws-1',
  missionId: 'mission-1',
  channels: [{ provider: 'instagram', handle: '@sohee_test' }],
  copies: {
    instagram: { caption: '오늘의 시술 후기', hashtags: ['#뷰티', '#바이름'] },
    threads: { content: '오늘의 시술 후기' },
  },
  imageIds: ['img-2', 'img-1'],
  boundVersions: {
    knowledgeVersion: 11,
    textHarnessVersion: 12,
    imageHarnessVersion: 13,
    operatingPolicyVersion: 14,
  },
  rights: { rightsStatus: 'GRANTED', consentStatus: 'GRANTED' },
}

const postInput = { kind: 'post' as const, payload: postPayload }

/** 지원 종류 → 디스패처 입력. 변경-감지 테스트에서 원본 조회에도 쓴다. */
const ORIGINAL_INPUTS: Record<MobileApprovalFingerprintKind, MobileApprovalFingerprintInput> = {
  dm: dmInput,
  comment: commentInput,
  booking_send: bookingSendInput,
  booking_confirm: bookingConfirmInput,
  post: postInput,
}

describe('mobile approval fingerprint dispatcher', () => {
  describe('delegates to the existing canonical function', () => {
    it('dm → computeDmApprovalFingerprint', () => {
      expect(computeMobileApprovalFingerprint(dmInput)).toBe(
        computeDmApprovalFingerprint(dmInput.workspaceId, dmInput.threadId, dmInput.draftText)
      )
    })

    it('comment → computeApprovalFingerprint', () => {
      expect(computeMobileApprovalFingerprint(commentInput)).toBe(
        computeCommentApprovalFingerprint(
          commentInput.workspaceId,
          commentInput.commentId,
          commentInput.draftText
        )
      )
    })

    it('booking_send → approvalFingerprint', () => {
      expect(computeMobileApprovalFingerprint(bookingSendInput)).toBe(
        approvalFingerprint(bookingSendBinding)
      )
    })

    it('booking_confirm → bookingApprovalFingerprint', () => {
      expect(computeMobileApprovalFingerprint(bookingConfirmInput)).toBe(
        bookingApprovalFingerprint(bookingConfirmBinding)
      )
    })

    it('post → calculateApprovalFingerprint', () => {
      expect(computeMobileApprovalFingerprint(postInput)).toBe(
        calculateApprovalFingerprint(postPayload)
      )
    })

    it.each(MOBILE_APPROVAL_FINGERPRINT_KINDS)('%s produces a single 64-hex fingerprint', (kind) => {
      expect(computeMobileApprovalFingerprint(ORIGINAL_INPUTS[kind])).toMatch(SHA256_HEX)
    })
  })

  describe('deterministic binding (no time, no randomness)', () => {
    it.each(MOBILE_APPROVAL_FINGERPRINT_KINDS)('%s is stable across calls', (kind) => {
      const input = ORIGINAL_INPUTS[kind]
      expect(computeMobileApprovalFingerprint(input)).toBe(computeMobileApprovalFingerprint(input))
    })

    it.each<[MobileApprovalFingerprintKind, MobileApprovalFingerprintInput]>([
      ['dm', { ...dmInput, draftText: `${dmInput.draftText} (수정)` }],
      ['comment', { ...commentInput, draftText: `${commentInput.draftText} (수정)` }],
      [
        'booking_send',
        { ...bookingSendInput, binding: { ...bookingSendBinding, slotVersion: 4 } },
      ],
      [
        'booking_confirm',
        { ...bookingConfirmInput, binding: { ...bookingConfirmBinding, totalAmountKrw: 130000 } },
      ],
      ['post', { ...postInput, payload: { ...postPayload, imageIds: ['img-2'] } }],
    ])('%s changes when the approved content changes', (kind, changed) => {
      expect(computeMobileApprovalFingerprint(changed)).not.toBe(
        computeMobileApprovalFingerprint(ORIGINAL_INPUTS[kind])
      )
    })
  })

  describe('unsupported kinds fail closed', () => {
    it('supports exactly the five approved kinds', () => {
      expect(MOBILE_APPROVAL_FINGERPRINT_KINDS).toEqual([
        'dm',
        'comment',
        'booking_send',
        'booking_confirm',
        'post',
      ])
    })

    it.each(MOBILE_APPROVAL_FINGERPRINT_KINDS)('accepts %s', (kind) => {
      expect(isMobileApprovalFingerprintKind(kind)).toBe(true)
    })

    it.each([...UNSUPPORTED_MOBILE_APPROVAL_FINGERPRINT_KINDS, '', 'DM', 'dm ', 'unknown'])(
      'rejects %j',
      (kind) => {
        expect(isMobileApprovalFingerprintKind(kind)).toBe(false)
      }
    )

    it.each(UNSUPPORTED_MOBILE_APPROVAL_FINGERPRINT_KINDS)(
      '%s never produces a fingerprint',
      (kind) => {
        const input = { kind, workspaceId: 'ws-1' } as unknown as MobileApprovalFingerprintInput
        expect(() => computeMobileApprovalFingerprint(input)).toThrow(
          /Unsupported approval fingerprint kind/
        )
      }
    )

    it('an unknown kind never produces a fingerprint', () => {
      const input = { kind: 'nope' } as unknown as MobileApprovalFingerprintInput
      expect(() => computeMobileApprovalFingerprint(input)).toThrow(
        /Unsupported approval fingerprint kind/
      )
    })
  })
})
