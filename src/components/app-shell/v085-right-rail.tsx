'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import styles from './v085-right-rail.module.css'

export type V085RightRailProps = Readonly<{
  className?: string
  onClose?: () => void
  currentCredits?: number | null
  totalCredits?: number | null
  newInquiries?: number | null
  validConsultations?: number | null
  confirmedBookings?: number | null
  conversionRate?: number | null
  hasMetricsEvidence?: boolean
}>

export function V085RightRail(props: V085RightRailProps) {
  const {
    className,
    onClose,
    newInquiries = null,
    validConsultations = null,
    confirmedBookings = null,
    conversionRate = null,
    hasMetricsEvidence = false,
  } = props
  return (
    <aside className={`${styles.railContainer} ${className ?? ''}`} aria-label="운영 보조 문맥 패널">
      {/* Panel Top Header with Close Button */}
      <div className={styles.panelTopHeader}>
        <div className={styles.panelTitleGroup}>
          <h2 className={styles.panelTitle}>업무 문맥 & 사업 성과</h2>
          <span className={styles.panelSubtitle}>소희가 실시간 추적 중인 지표예요</span>
        </div>
        {onClose && (
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="문맥 패널 닫기"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* 1. Weekly Business Results (KPIs) */}
      <section className={styles.railCard} aria-label="이번 주 사업 결과">
        <div className={styles.cardHeader}>
          <h3>이번 주 사업 성과</h3>
          <small>{hasMetricsEvidence ? '실측 데이터' : '측정 준비 중'}</small>
        </div>
        <div className={styles.kpiList}>
          <div className={styles.kpiItem}>
            <div className={styles.kpiMeta}>
              <span className={styles.kpiLabel}>신규 문의</span>
              <span className={styles.kpiValue}>
                {newInquiries !== null ? `${newInquiries}건` : '-'}
              </span>
            </div>
          </div>
          <div className={styles.kpiItem}>
            <div className={styles.kpiMeta}>
              <span className={styles.kpiLabel}>유효 상담</span>
              <span className={styles.kpiValue}>
                {validConsultations !== null ? `${validConsultations}건` : '-'}
              </span>
            </div>
          </div>
          <div className={styles.kpiItem}>
            <div className={styles.kpiMeta}>
              <span className={styles.kpiLabel}>예약 확정</span>
              <span className={styles.kpiValue}>
                {confirmedBookings !== null ? `${confirmedBookings}건` : '-'}
              </span>
            </div>
          </div>
          <div className={styles.kpiItem}>
            <div className={styles.kpiMeta}>
              <span className={styles.kpiLabel}>예약 전환율</span>
              <span className={styles.kpiValue} style={{ color: '#0284c7', fontWeight: 800 }}>
                {conversionRate !== null ? `${conversionRate.toFixed(1)}%` : '-'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. 소희의 운영 인사이트 */}
      <section className={styles.railCard} aria-label="오늘의 인사이트">
        <div className={styles.cardHeader}>
          <h3>소희의 운영 인사이트</h3>
          <small>최근 7일</small>
        </div>
        <div className={styles.insightList}>
          <div className={styles.insightItem}>
            <span className={styles.insightBullet} aria-hidden="true">•</span>
            <span>오후 6시 이전에 빠르게 답변하면 상담 전환에 도움이 됩니다. 전환율 변화는 아직 측정 전이에요.</span>
          </div>
          <div className={styles.insightItem}>
            <span className={styles.insightBullet} aria-hidden="true">•</span>
            <span>화·목 오후 시간대 스토리 콘텐츠가 예약 유도에 유리한 경우가 많아요. 매장별 효과는 측정 전이에요.</span>
          </div>
        </div>
      </section>

      {/* 4. Main CTA Button */}
      <Link
        href="/app/reports"
        className={styles.growthCtaBtn}
        aria-label="소희와 전체 성과 리포트 보기"
        onClick={onClose}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>전체 성과 리포트 보기</span>
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </aside>
  )
}
