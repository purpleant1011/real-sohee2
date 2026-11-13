'use client'

import React from 'react'
import {
  CustomerFacingOutcomeStatus,
  formatCustomerStatusBadge,
} from '@/features/ux/canonical-ia'
import { BusinessContextCard } from './business-context-card'
import { Check, Clock, Loader2, Send, HelpCircle, AlertCircle } from 'lucide-react'
import styles from './mobile-first-outcome.module.css'

export interface MobileFirstOutcomeProps {
  businessName?: string | null
  industry?: string | null
  location?: string | null
  featuredProducts?: readonly string[]
  brandVoice?: string | null
  status: CustomerFacingOutcomeStatus
  currentStepIndex: number // 1: 요청, 2: 초안, 3: 승인, 4: 게시, 5: 완료
  onApproveAndPublish?: () => void
  onReconcileRetry?: () => void
  isLoading?: boolean
}

export function MobileFirstOutcomeView({
  businessName,
  industry,
  location,
  featuredProducts,
  brandVoice,
  status,
  currentStepIndex,
  onApproveAndPublish,
  onReconcileRetry,
  isLoading = false,
}: Readonly<MobileFirstOutcomeProps>) {
  const badge = formatCustomerStatusBadge(status)

  const getBadgeClass = (variant: typeof badge.colorVariant) => {
    switch (variant) {
      case 'info':
        return styles.statusInfo
      case 'warning':
        return styles.statusWarning
      case 'success':
        return styles.statusSuccess
      case 'danger':
        return styles.statusDanger
      default:
        return styles.statusNeutral
    }
  }

  const renderBadgeIcon = (iconName: string) => {
    switch (iconName) {
      case 'Loader2':
        return <Loader2 className="animate-spin" aria-hidden="true" size={14} />
      case 'Clock':
        return <Clock aria-hidden="true" size={14} />
      case 'Send':
        return <Send aria-hidden="true" size={14} />
      case 'CheckCircle2':
        return <Check aria-hidden="true" size={14} />
      case 'HelpCircle':
        return <HelpCircle aria-hidden="true" size={14} />
      case 'AlertCircle':
        return <AlertCircle aria-hidden="true" size={14} />
      default:
        return null
    }
  }

  const steps = [
    { num: 1, label: '마케팅 요청 접수' },
    { num: 2, label: '맞춤 원고 초안' },
    { num: 3, label: '정확한 버전 승인' },
    { num: 4, label: 'SNS 자동 게시' },
    { num: 5, label: '게시 영수증 확인' },
  ]

  return (
    <div className={styles.mobileContainer}>
      <BusinessContextCard
        businessName={businessName}
        industry={industry}
        location={location}
        featuredProducts={featuredProducts}
        brandVoice={brandVoice}
      />

      <section aria-label="진행 상태" className={styles.contextCard}>
        <div className={styles.contextHeader}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>현재 작업 상태</span>
          <div
            role={badge.ariaRole}
            aria-label={badge.accessibleText}
            className={`${styles.statusBadge} ${getBadgeClass(badge.colorVariant)}`}
          >
            {renderBadgeIcon(badge.iconName)}
            <span>{badge.label}</span>
          </div>
        </div>

        {/* 5-Step Work Timeline */}
        <div className={styles.timeline}>
          {steps.map((step) => {
            const isCompleted = step.num < currentStepIndex
            const isActive = step.num === currentStepIndex
            return (
              <div key={step.num} className={styles.timelineStep}>
                <span
                  className={`${styles.stepNumber} ${
                    isCompleted ? styles.stepCompleted : isActive ? styles.stepActive : ''
                  }`}
                  aria-hidden="true"
                >
                  {isCompleted ? <Check size={14} /> : step.num}
                </span>
                <span style={{ fontSize: 14, fontWeight: isActive ? 600 : 400 }}>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Primary Action Button (Touch Target >= 44px) */}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status === 'APPROVAL_PENDING' && onApproveAndPublish ? (
            <button
              type="button"
              disabled={isLoading}
              onClick={onApproveAndPublish}
              className={`${styles.accessibleButton} ${styles.primaryButton}`}
              aria-label="원고 승인하고 인스타그램에 바로 게시하기"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" size={16} style={{ marginRight: 6 }} />
                  <span>게시 요청 중...</span>
                </>
              ) : (
                <span>원고 승인하고 게시하기</span>
              )}
            </button>
          ) : null}

          {badge.isRecoverable && onReconcileRetry ? (
            <button
              type="button"
              disabled={isLoading}
              onClick={onReconcileRetry}
              className={`${styles.accessibleButton} ${styles.secondaryButton}`}
              aria-label={badge.recoveryActionLabel ?? '다시 시도하기'}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" size={16} style={{ marginRight: 6 }} />
                  <span>확인 중...</span>
                </>
              ) : (
                <span>{badge.recoveryActionLabel ?? '다시 시도하기'}</span>
              )}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
