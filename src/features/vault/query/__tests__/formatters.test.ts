import { describe, expect, it } from 'vitest'
import type { VaultItem } from '../../types'
import {
  formatChannelLabel,
  formatHoldReasonLabel,
  formatStatusLabel,
  toAdminVaultItemDto,
  toUserVaultItemDto,
} from '../formatters'

describe('formatters (사용자 DTO / 관리자 뷰 DTO 변환 및 불변식 검증)', () => {
  const sampleVaultItem: VaultItem = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    workspaceId: '223e4567-e89b-12d3-a456-426614174001',
    contentId: '323e4567-e89b-12d3-a456-426614174002',
    versionId: '423e4567-e89b-12d3-a456-426614174003',
    channel: 'instagram',
    releaseGate: 'HELD_PROVIDER_PENDING',
    holdReason: 'META_REVIEW_PENDING',
    heldAt: '2026-10-07T05:00:00.000Z',
    heldBy: '523e4567-e89b-12d3-a456-426614174004',
    targetDate: '2026-10-09',
    approvedFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    fingerprintSchemaVersion: 1,
    policyVersion: 'v1.0.0',
    specVersion: 'v1.0.0',
    approvalState: 'APPROVED',
    approvedBy: '623e4567-e89b-12d3-a456-426614174005',
    bundleId: '723e4567-e89b-12d3-a456-426614174006',
    idempotencyKey: 'idemp-key-1234',
    deletedAt: null,
    createdAt: '2026-10-07T04:30:00.000Z',
    updatedAt: '2026-10-07T04:30:00.000Z',
  }

  describe('라벨 생성 순수 함수', () => {
    it('status_label: APPROVED는 "발행 준비 완료 · 외부 게시 전", "예약됨" 문구는 포함되지 않는다', () => {
      const label = formatStatusLabel('APPROVED')
      expect(label).toBe('발행 준비 완료 · 외부 게시 전')
      expect(label).not.toContain('예약됨')
    })

    it('status_label: NEEDS_REAPPROVAL은 "재확인 필요"', () => {
      expect(formatStatusLabel('NEEDS_REAPPROVAL')).toBe('재확인 필요')
    })

    it('status_label: INVALIDATED는 "승인이 풀렸어요"', () => {
      expect(formatStatusLabel('INVALIDATED')).toBe('승인이 풀렸어요')
    })

    it('hold_reason_label: 각 보류 사유별 한국어 라벨 매핑', () => {
      expect(formatHoldReasonLabel('META_REVIEW_PENDING')).toBe('Meta 앱 심사 대기')
      expect(formatHoldReasonLabel('CHANNEL_NOT_CONNECTED')).toBe('채널 연결 필요')
      expect(formatHoldReasonLabel('USER_HELD')).toBe('사용자 보류')
      expect(formatHoldReasonLabel('RELEASE_REQUESTED')).toBe('게시 대기 중')
      expect(formatHoldReasonLabel('REAPPROVAL_REQUIRED')).toBe('재승인 필요')
      expect(formatHoldReasonLabel(null)).toBeNull()
    })

    it('channel_label: 각 채널별 한국어 라벨 매핑', () => {
      expect(formatChannelLabel('instagram')).toBe('인스타그램')
      expect(formatChannelLabel('threads')).toBe('스레드')
      expect(formatChannelLabel('naver_blog')).toBe('네이버 블로그')
      expect(formatChannelLabel('daangn_business')).toBe('당근 비즈니스')
    })
  })

  describe('toUserVaultItemDto (사용자 노출 DTO 불변식 검증)', () => {
    const userDto = toUserVaultItemDto(sampleVaultItem)

    it('사용자 DTO 필드에 UUID 문자열이 직접 포함되지 않는다', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      for (const [key, value] of Object.entries(userDto)) {
        if (typeof value === 'string') {
          expect(uuidRegex.test(value), `Field "${key}" must not contain raw UUID: ${value}`).toBe(false)
        }
      }
    })

    it('사용자 DTO에 approvedFingerprint(64자리 SHA)가 누출되지 않는다', () => {
      const jsonStr = JSON.stringify(userDto)
      expect(jsonStr).not.toContain(sampleVaultItem.approvedFingerprint!)
      expect((userDto as any).approvedFingerprint).toBeUndefined()
    })

    it('사용자 DTO에 영문 상태 코드(APPROVED, HELD_PROVIDER_PENDING 등)가 노출되지 않는다', () => {
      expect((userDto as any).approvalState).toBeUndefined()
      expect((userDto as any).releaseGate).toBeUndefined()
      expect((userDto as any).holdReason).toBeUndefined()
      const jsonStr = JSON.stringify(userDto)
      expect(jsonStr).not.toContain('APPROVED')
      expect(jsonStr).not.toContain('HELD_PROVIDER_PENDING')
      expect(jsonStr).not.toContain('META_REVIEW_PENDING')
    })

    it('"예약됨" 문구가 절대 포함되지 않는다', () => {
      const jsonStr = JSON.stringify(userDto)
      expect(jsonStr).not.toContain('예약됨')
    })

    it('올바른 사용자용 라벨들을 제공한다', () => {
      expect(userDto.status_label).toBe('발행 준비 완료 · 외부 게시 전')
      expect(userDto.hold_reason_label).toBe('Meta 앱 심사 대기')
      expect(userDto.channel_label).toBe('인스타그램')
      expect(userDto.target_date).toBe('2026-10-09')
    })

    it('채널 키는 화면 동작 선택용으로만 내려가고 화면 문구는 channel_label이다', () => {
      expect(userDto.channel).toBe('instagram')
      expect(userDto.channel_label).not.toBe(userDto.channel)
    })
  })

  describe('toAdminVaultItemDto (관리자 뷰 DTO)', () => {
    const adminDto = toAdminVaultItemDto(sampleVaultItem)

    it('관리자 DTO는 원본 DB 필드와 라벨을 모두 포함한다', () => {
      expect(adminDto.id).toBe(sampleVaultItem.id)
      expect(adminDto.workspaceId).toBe(sampleVaultItem.workspaceId)
      expect(adminDto.approvedFingerprint).toBe(sampleVaultItem.approvedFingerprint)
      expect(adminDto.approvalState).toBe('APPROVED')
      expect(adminDto.statusLabel).toBe('발행 준비 완료 · 외부 게시 전')
      expect(adminDto.holdReasonLabel).toBe('Meta 앱 심사 대기')
      expect(adminDto.channelLabel).toBe('인스타그램')
    })
  })
})
