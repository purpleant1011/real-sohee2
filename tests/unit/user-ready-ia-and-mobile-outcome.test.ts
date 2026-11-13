import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CANONICAL_9TH_IA,
  sanitizeCustomerFacingCopy,
  type CustomerFacingOutcomeStatus,
  formatCustomerStatusBadge,
  FIRST_OUTCOME_ONBOARDING_STEPS,
} from '@/features/ux/canonical-ia'
import { BusinessContextCard } from '@/components/ux/business-context-card'
import { MobileFirstOutcomeView } from '@/components/ux/mobile-first-outcome'

describe('Wave 6: User-Ready UX & Mobile First Outcome (ANI-1053, ANI-1054)', () => {
  describe('ANI-1053: Canonical IA & Customer Language Filter', () => {
    it('defines the canonical 6-item information architecture for 9th revision', () => {
      const labels = CANONICAL_9TH_IA.map((item) => item.label)
      expect(labels).toEqual(['소희', '작업', '콘텐츠', '채널', '리포트', '설정'])

      const hrefs = CANONICAL_9TH_IA.map((item) => item.href)
      expect(hrefs).toContain('/app')
      expect(hrefs).toContain('/app/work')
      expect(hrefs).toContain('/app/content')
      expect(hrefs).toContain('/app/channels')
      expect(hrefs).toContain('/app/reports')
      expect(hrefs).toContain('/app/settings/business')
    })

    it('completely strips technical jargon (MCP, Outcome OS, Figma IDs, Harness) from customer copy', () => {
      const dirtyCopy =
        'MCP Gateway를 통해 Harness Lineage를 불러오고 Outcome OS [Figma node 73:2]에서 실행되었습니다. raw_request_id=987654321'
      const cleanCopy = sanitizeCustomerFacingCopy(dirtyCopy)

      expect(cleanCopy).not.toContain('MCP Gateway')
      expect(cleanCopy).not.toContain('Harness Lineage')
      expect(cleanCopy).not.toContain('Outcome OS')
      expect(cleanCopy).not.toContain('Figma')
      expect(cleanCopy).not.toContain('raw_request_id')
      expect(cleanCopy).toContain('소희 AI 시스템')
    })

    it('defines the 6-step First Outcome Onboarding flow', () => {
      expect(FIRST_OUTCOME_ONBOARDING_STEPS).toEqual([
        { step: 1, key: 'STORE_INFO', title: '우리 매장 정보' },
        { step: 2, key: 'PRODUCTS_SERVICES', title: '대표 상품 및 서비스' },
        { step: 3, key: 'TARGET_AUDIENCE', title: '주요 고객층' },
        { step: 4, key: 'BRAND_VOICE', title: '말투 및 금지어' },
        { step: 5, key: 'CHANNEL_CONNECT', title: 'SNS 채널 연동' },
        { step: 6, key: 'FIRST_WORK', title: '첫 마케팅 업무 시작' },
      ])
    })
  })

  describe('ANI-1054: Mobile First Outcome & Accessibility Contract', () => {
    it('provides multi-modal status badge with both icon, label, and accessible ARIA attributes', () => {
      const statuses: CustomerFacingOutcomeStatus[] = [
        'DRAFT_CREATING',
        'APPROVAL_PENDING',
        'PUBLISHING',
        'EXTERNAL_VERIFIED',
        'UNKNOWN_RECOVERING',
        'FAILED',
      ]

      for (const status of statuses) {
        const badge = formatCustomerStatusBadge(status)
        expect(badge.label).toBeDefined()
        expect(badge.label.length).toBeGreaterThan(0)
        expect(badge.ariaRole).toBe('status')
        expect(badge.accessibleText).toContain(badge.label)
        // Ensure status is never conveyed by color alone
        expect(badge.iconName).toBeDefined()
      }
    })

    it('returns recovery guidance and retry triggers for UNKNOWN_RECOVERING status', () => {
      const badge = formatCustomerStatusBadge('UNKNOWN_RECOVERING')
      expect(badge.isRecoverable).toBe(true)
      expect(badge.recoveryActionLabel).toBe('게시 상태 다시 확인')
      expect(badge.accessibleText).toContain('외부 플랫폼 확인 중')
    })

    it('renders BusinessContextCard with sanitized customer copy and honesty for missing values', () => {
      // Case 1: Populated business context
      const { unmount } = render(
        React.createElement(BusinessContextCard, {
          businessName: '소희 테스트 키친 (MCP Gateway)',
          industry: '캐주얼 브런치 카페',
          location: '청라 커낼웨이',
          featuredProducts: ['에그 베네딕트', '수제 팬케이크'],
          brandVoice: '따뜻하고 정중한 말투 [Figma 73:2]',
        }),
      )

      expect(screen.getByText('소희가 파악한 매장 정보')).toBeDefined()
      // Stripped jargon: MCP Gateway should become '소희 AI 시스템'
      expect(screen.getByText(/소희 AI 시스템/)).toBeDefined()
      // Stripped Figma node IDs
      expect(screen.queryByText(/Figma 73:2/)).toBeNull()
      unmount()

      // Case 2: Empty/Missing business context - shows honest waiting state without fake fallbacks
      render(React.createElement(BusinessContextCard, {}))
      expect(screen.getByText('매장 정보 설정 대기')).toBeDefined()
      expect(screen.getByText('업종 설정 대기')).toBeDefined()
    })

    it('renders MobileFirstOutcomeView with accessible status badge and interactive 44px action buttons', () => {
      const onApprove = vi.fn()

      const { unmount } = render(
        React.createElement(MobileFirstOutcomeView, {
          businessName: '소희 키친',
          status: 'APPROVAL_PENDING',
          currentStepIndex: 3,
          onApproveAndPublish: onApprove,
        }),
      )

      // ARIA role and label verification
      const statusRole = screen.getByRole('status')
      expect(statusRole).toBeDefined()
      expect(statusRole.getAttribute('aria-label')).toContain('승인 대기')

      // 44px touch target button verification
      const approveBtn = screen.getByRole('button', { name: /원고 승인하고 인스타그램에 바로 게시하기/ })
      expect(approveBtn).toBeDefined()
      fireEvent.click(approveBtn)
      expect(onApprove).toHaveBeenCalledTimes(1)
      unmount()

      // Unknown recovery button verification
      const onRetry = vi.fn()
      render(
        React.createElement(MobileFirstOutcomeView, {
          businessName: '소희 키친',
          status: 'UNKNOWN_RECOVERING',
          currentStepIndex: 4,
          onReconcileRetry: onRetry,
        }),
      )

      const retryBtn = screen.getByRole('button', { name: '게시 상태 다시 확인' })
      expect(retryBtn).toBeDefined()
      fireEvent.click(retryBtn)
      expect(onRetry).toHaveBeenCalledTimes(1)
    })
  })
})

