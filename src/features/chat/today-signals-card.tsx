'use client'

import React from 'react'
import { AppLink as Link } from '@/components/navigation/app-link'
import { Users, Sparkles, CalendarDays, ArrowRight, Clock } from 'lucide-react'
import styles from './today-signals-card.module.css'

export function TodaySignalsCard() {
  return (
    <div className={styles.todayCardContainer} data-testid="today-signals-card">
      <div className={styles.header}>
        <span className={styles.eyebrow}>
          <Sparkles size={14} color="#7c3aed" /> 오늘의 핵심 마케팅 신호
        </span>
        <h3 className={styles.title}>사장님, 지금 확인하면 좋은 항목이에요</h3>
      </div>

      <div className={styles.signalsGrid}>
        {/* 1. 미응답 고객 신호 */}
        <Link href="/app/customers" className={styles.signalItem} data-testid="signal-customer">
          <div className={styles.iconBox} style={{ background: '#fee2e2', color: '#ef4444' }}>
            <Users size={18} />
          </div>
          <div className={styles.signalContent}>
            <div className={styles.signalTitleRow}>
              <strong className={styles.signalTitle}>미응답 고객 문의</strong>
              <span className={styles.urgentBadge}>
                <Clock size={11} /> 대기 시간 측정 전
              </span>
            </div>
            <p className={styles.signalDesc}>
              인스타 DM 및 네이버 플레이스로 들어온 예약 문의를 확인해 보세요. 실제 대기 건수는 고객함에서 확인할 수 있어요.
            </p>
            <span className={styles.actionLink}>
              고객 응대 및 예약 확정하기 <ArrowRight size={13} />
            </span>
          </div>
        </Link>

        {/* 2. 콘텐츠 디렉션 신호 */}
        <Link href="/app/content" className={styles.signalItem} data-testid="signal-content">
          <div className={styles.iconBox} style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            <Sparkles size={18} />
          </div>
          <div className={styles.signalContent}>
            <div className={styles.signalTitleRow}>
              <strong className={styles.signalTitle}>시즌 콘텐츠 디렉션 검토</strong>
              <span className={styles.readyBadge}>검토 필요</span>
            </div>
            <p className={styles.signalDesc}>
              스튜디오에서 원고와 이미지를 검토하고 제작을 승인하세요. 아직 만들어진 시안은 없어요.
            </p>
            <span className={styles.actionLink}>
              콘텐츠 스튜디오 열기 <ArrowRight size={13} />
            </span>
          </div>
        </Link>

        {/* 3. 주간 일정 및 예약 신호 */}
        <Link href="/app/schedule" className={styles.signalItem} data-testid="signal-schedule">
          <div className={styles.iconBox} style={{ background: '#e0e7ff', color: '#4f46e5' }}>
            <CalendarDays size={18} />
          </div>
          <div className={styles.signalContent}>
            <div className={styles.signalTitleRow}>
              <strong className={styles.signalTitle}>이번 주 빈 예약 시간</strong>
              <span className={styles.infoBadge}>일정 확인</span>
            </div>
            <p className={styles.signalDesc}>
              통합 달력에서 실제 빈 시간을 확인하고 예약 유도 일정을 세워보세요.
            </p>
            <span className={styles.actionLink}>
              통합 달력 확인하기 <ArrowRight size={13} />
            </span>
          </div>
        </Link>
      </div>
    </div>
  )
}
