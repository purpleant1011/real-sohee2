'use client'

import React from 'react'
import { Sparkles, Building2, ExternalLink } from 'lucide-react'
import { sanitizeCustomerFacingCopy } from '@/features/ux/canonical-ia'
import styles from './mobile-first-outcome.module.css'

export interface BusinessContextCardProps {
  businessName?: string | null
  industry?: string | null
  location?: string | null
  featuredProducts?: readonly string[]
  brandVoice?: string | null
  onEditClick?: () => void
}

export function BusinessContextCard({
  businessName,
  industry,
  location,
  featuredProducts = [],
  brandVoice,
  onEditClick,
}: Readonly<BusinessContextCardProps>) {
  const displayBusinessName = businessName ? sanitizeCustomerFacingCopy(businessName) : '매장 정보 설정 대기'
  const displayIndustry = industry ? sanitizeCustomerFacingCopy(industry) : '업종 설정 대기'
  const displayLocation = location ? sanitizeCustomerFacingCopy(location) : '위치 미설정'
  const displayVoice = brandVoice ? sanitizeCustomerFacingCopy(brandVoice) : '기본 친근한 말투'

  return (
    <section aria-label="소희가 알고 있는 매장 정보" className={styles.contextCard}>
      <div className={styles.contextHeader}>
        <div className={styles.contextTitle}>
          <Sparkles aria-hidden="true" size={18} />
          <span>소희가 파악한 매장 정보</span>
        </div>
        {onEditClick ? (
          <button
            type="button"
            className={`${styles.accessibleButton} ${styles.secondaryButton}`}
            onClick={onEditClick}
            aria-label="매장 정보 수정하기"
          >
            <span>정보 변경</span>
            <ExternalLink aria-hidden="true" size={14} style={{ marginLeft: 4 }} />
          </button>
        ) : null}
      </div>

      <ul className={styles.contextList}>
        <li className={styles.contextItem}>
          <span className={styles.contextLabel}>매장명</span>
          <strong className={styles.contextValue}>{displayBusinessName}</strong>
        </li>
        <li className={styles.contextItem}>
          <span className={styles.contextLabel}>업종</span>
          <span className={styles.contextValue}>{displayIndustry}</span>
        </li>
        <li className={styles.contextItem}>
          <span className={styles.contextLabel}>위치</span>
          <span className={styles.contextValue}>{displayLocation}</span>
        </li>
        {featuredProducts.length > 0 ? (
          <li className={styles.contextItem}>
            <span className={styles.contextLabel}>대표 상품/메뉴</span>
            <span className={styles.contextValue}>{featuredProducts.join(', ')}</span>
          </li>
        ) : null}
        <li className={styles.contextItem}>
          <span className={styles.contextLabel}>브랜드 보이스</span>
          <span className={styles.contextValue}>{displayVoice}</span>
        </li>
      </ul>
    </section>
  )
}
