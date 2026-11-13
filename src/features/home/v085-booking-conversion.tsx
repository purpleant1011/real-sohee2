'use client'

import React from 'react'
import Link from 'next/link'
import styles from './v085-booking-conversion.module.css'

export interface BookingConversionProps {
  currentBookings?: number | null
  targetBookings?: number | null
  increaseOverLastWeek?: number | null
  inquiriesCount?: number | null
  consultationsCount?: number | null
  memos?: string[]
}

export function V085BookingConversion({
  currentBookings = null,
  targetBookings = null,
  increaseOverLastWeek = null,
  inquiriesCount = null,
  consultationsCount = null,
  memos = [
    '소희가 채널 반응과 문의를 실시간 관찰하고 있어요.',
    '고객 문의 발생 시 즉각 응대하여 예약 전환을 유도합니다.',
  ],
}: BookingConversionProps) {
  const hasData = currentBookings !== null

  return (
    <section className={styles.sectionGrid} aria-label="이번 주 예약 전환 및 소희 운영 메모">
      {/* 1. Booking Conversion Card */}
      <div className={styles.conversionCard}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>이번 주 예약 전환</h3>
          <span className={styles.provenanceBadge}>{hasData ? '실측' : '측정 대기'}</span>
        </div>

        <div className={styles.numberRow}>
          <strong className={styles.mainNumber}>{hasData ? currentBookings : '-'}</strong>
          <span className={styles.targetNumber}>
            {targetBookings !== null ? `/ ${targetBookings}건` : ''}
          </span>
        </div>

        <p className={styles.trendText}>
          {increaseOverLastWeek !== null ? (
            <>지난주보다 <strong>{increaseOverLastWeek}건 더 많아요</strong></>
          ) : (
            <span>실시간 주간 지표 집계 중</span>
          )}
        </p>

        <div className={styles.funnelSnippet}>
          <div className={styles.funnelItem}>
            <span>문의</span>
            <strong>{inquiriesCount !== null ? `${inquiriesCount}건` : '-'}</strong>
          </div>
          <span className={styles.funnelArrow}>→</span>
          <div className={styles.funnelItem}>
            <span>상담</span>
            <strong>{consultationsCount !== null ? `${consultationsCount}건` : '-'}</strong>
          </div>
          <span className={styles.funnelArrow}>→</span>
          <div className={styles.funnelItem}>
            <span>예약</span>
            <strong style={{ color: '#0284c7' }}>{hasData ? `${currentBookings}건` : '-'}</strong>
          </div>
        </div>
      </div>

      {/* 2. Sohee Operating Memos */}
      <div className={styles.memoCard}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>소희의 운영 메모</h3>
          <span className={styles.aiTag}>소희 AI 관찰</span>
        </div>

        <ul className={styles.memoList}>
          {memos.map((memo, idx) => (
            <li key={idx} className={styles.memoItem}>
              <span className={styles.bulletDot}>·</span>
              <span>{memo}</span>
            </li>
          ))}
        </ul>

        <div className={styles.memoFooter}>
          <Link href="/app/reports" className={styles.detailLink}>
            인사이트 자세히 →
          </Link>
        </div>
      </div>
    </section>
  )
}
