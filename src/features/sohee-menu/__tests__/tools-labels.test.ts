import { describe, expect, it } from 'vitest'
import { ACTION_CAPABILITY_REGISTRY } from '@/lib/agent-os/action-capability-registry'
import {
  CATEGORY_LABELS,
  RISK_TIER_LABELS,
  getCategoryLabel,
  getRiskTierLabel,
} from '../tools-labels'

describe('tools-labels', () => {
  describe('getRiskTierLabel', () => {
    it('R0, R1, R2를 사장님용 문구로 변환한다', () => {
      expect(getRiskTierLabel('R0')).toBe('바로 해요')
      expect(getRiskTierLabel('R1')).toBe('물어보고 해요')
      expect(getRiskTierLabel('R2')).toBe('하지 않아요')
    })

    it('레지스트리의 모든 riskTier 값을 적절한 사장님용 문구로 매핑한다', () => {
      const allRegisteredTiers = new Set(
        Object.values(ACTION_CAPABILITY_REGISTRY).map((act) => act.riskTier),
      )

      for (const tier of allRegisteredTiers) {
        const label = getRiskTierLabel(tier)
        expect(['바로 해요', '물어보고 해요', '하지 않아요']).toContain(label)
        expect(label).not.toBe('확인 후 해요')
      }
    })

    it('알 수 없는 riskTier 값은 "확인 후 해요" 기본값을 반환한다', () => {
      expect(getRiskTierLabel('UNKNOWN')).toBe('확인 후 해요')
      expect(getRiskTierLabel(undefined)).toBe('확인 후 해요')
      expect(getRiskTierLabel('')).toBe('확인 후 해요')
    })
  })

  describe('getCategoryLabel', () => {
    it('레지스트리의 모든 category 값을 한국어 라벨로 매핑한다', () => {
      const allRegisteredCategories = new Set(
        Object.values(ACTION_CAPABILITY_REGISTRY).map((act) => act.category),
      )

      for (const cat of allRegisteredCategories) {
        const label = getCategoryLabel(cat)
        expect(label).toBeDefined()
        expect(label).not.toBe('기타')
        expect(label).not.toMatch(/[A-Za-z]/) // 영문 노출 금지
        expect(label).not.toContain('하네스') // 내부 용어 노출 금지
      }
    })

    it('미지정되거나 알 수 없는 카테고리는 "기타"를 반환한다', () => {
      expect(getCategoryLabel('UNKNOWN_CATEGORY')).toBe('기타')
      expect(getCategoryLabel(undefined)).toBe('기타')
      expect(getCategoryLabel('')).toBe('기타')
    })
  })
})
