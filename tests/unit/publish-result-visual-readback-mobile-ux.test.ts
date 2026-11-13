import { describe, it, expect } from 'vitest'
import type { ReceiptVerificationState } from '@/features/publishing/external-action-receipt-engine'

describe('Publish Result, Visual Readback, and Recovery UX (ANI-1088)', () => {
  function formatPublishReceiptBadge(status: ReceiptVerificationState): {
    badgeVariant: 'success' | 'warning' | 'pending' | 'danger'
    userLabel: string
    isFinalGreen: boolean
    canRetry: boolean
  } {
    switch (status) {
      case 'REQUESTED':
        return {
          badgeVariant: 'pending',
          userLabel: '게시 요청 접수됨',
          isFinalGreen: false,
          canRetry: false,
        }
      case 'PROVIDER_ACCEPTED':
        return {
          badgeVariant: 'pending',
          userLabel: '채널 서버 접수 완료 (외부 검증 대기)',
          isFinalGreen: false,
          canRetry: false,
        }
      case 'VERIFICATION_PENDING':
        return {
          badgeVariant: 'warning',
          userLabel: '게시물 및 미디어 일치성 확인 중',
          isFinalGreen: false,
          canRetry: false,
        }
      case 'VERIFIED':
        return {
          badgeVariant: 'success',
          userLabel: '게시 및 시각 정합성 검증 완료',
          isFinalGreen: true,
          canRetry: false,
        }
      case 'RESULT_UNKNOWN':
        return {
          badgeVariant: 'warning',
          userLabel: '외부 확인 지연 (게시 상태 재검증 필요)',
          isFinalGreen: false,
          canRetry: true,
        }
      case 'FAILED':
        return {
          badgeVariant: 'danger',
          userLabel: '게시 실패 (원인 확인 및 복구 필요)',
          isFinalGreen: false,
          canRetry: true,
        }
      default:
        return {
          badgeVariant: 'warning',
          userLabel: '알 수 없음',
          isFinalGreen: false,
          canRetry: true,
        }
    }
  }

  it('prohibits marking PROVIDER_ACCEPTED as final verified green (ANI-1088 False-Green defense)', () => {
    const badge = formatPublishReceiptBadge('PROVIDER_ACCEPTED')
    expect(badge.isFinalGreen).toBe(false)
    expect(badge.badgeVariant).not.toBe('success')
    expect(badge.userLabel).toContain('검증 대기')
  })

  it('marks VERIFIED only when provider readback and perceptual equivalence pass', () => {
    const badge = formatPublishReceiptBadge('VERIFIED')
    expect(badge.isFinalGreen).toBe(true)
    expect(badge.badgeVariant).toBe('success')
    expect(badge.userLabel).toContain('검증 완료')
  })

  it('handles RESULT_UNKNOWN with warning state and retry guidance without fake success', () => {
    const badge = formatPublishReceiptBadge('RESULT_UNKNOWN')
    expect(badge.isFinalGreen).toBe(false)
    expect(badge.badgeVariant).toBe('warning')
    expect(badge.canRetry).toBe(true)
    expect(badge.userLabel).toContain('재검증 필요')
  })

  it('handles FAILED with danger state and recovery workflow', () => {
    const badge = formatPublishReceiptBadge('FAILED')
    expect(badge.isFinalGreen).toBe(false)
    expect(badge.badgeVariant).toBe('danger')
    expect(badge.canRetry).toBe(true)
  })
})
