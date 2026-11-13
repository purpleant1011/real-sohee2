'use client'

import React from 'react'
import Link from 'next/link'
import styles from './v085-morning-briefing.module.css'

export interface MorningBriefingProps {
  dateStr?: string
  ownerName?: string
  primaryGoalTitle?: string
  primaryGoalDesc?: string
  goalProgress?: {
    secured: number
    target: number
    remainingDays: number
  }
  currentActionText?: string
  currentActionMeta?: string
}

export function V085MorningBriefing({
  dateStr = '8월 30일 · 오늘의 브리핑',
  ownerName = '사장님',
  primaryGoalTitle = '이번 주 빈 예약 3자리를 채울게요.',
  primaryGoalDesc = '최근 문의 고객과 반응이 좋았던 홍보 콘텐츠를 연결해 예약 전환을 만들고 있어요.',
  goalProgress = {
    secured: 3,
    target: 5,
    remainingDays: 2,
  },
  currentActionText = '미예약 문의 4명에게 재접촉 중',
  currentActionMeta = 'Instagram · 다음 실행 10:30',
}: MorningBriefingProps) {
  return (
    <section className={styles.briefingSection} aria-labelledby="briefing-title">
      {/* Date & Greeting */}
      <div className={styles.greetingHeader}>
        <span className={styles.dateLabel}>{dateStr}</span>
        <h2 id="briefing-title" className={styles.greetingTitle}>
          좋은 아침이에요, {ownerName}.
        </h2>
        <p className={styles.greetingSubtitle}>
          소희가 어제의 반응을 읽고 오늘 해야 할 일을 정리했어요.
        </p>
      </div>

      {/* Primary Goal Card (Decision Unit) */}
      <div className={styles.primaryGoalCard}>
        <div className={styles.cardTop}>
          <span className={styles.goalBadge}>오늘의 최우선 목표</span>
          <span className={styles.inProgressPill}>● 진행 중</span>
        </div>

        <h3 className={styles.goalHeading}>{primaryGoalTitle}</h3>
        <p className={styles.goalDescription}>{primaryGoalDesc}</p>

        <div className={styles.goalMetaRow}>
          <div className={styles.progressItem}>
            <span>목표 <strong>{goalProgress.target}건</strong> 중 <strong>{goalProgress.secured}건</strong> 확보</span>
            <span className={styles.metaDivider}>·</span>
            <span>남은 기간 <strong>{goalProgress.remainingDays}일</strong></span>
          </div>
        </div>

        {/* What Sohee is doing right now */}
        <div className={styles.currentActionBox}>
          <div className={styles.actionInfo}>
            <span className={styles.actionTag}>소희가 지금 하는 일</span>
            <p className={styles.actionMainText}>{currentActionText}</p>
            <span className={styles.actionMetaText}>{currentActionMeta}</span>
          </div>
          <Link href="/app/automation" className={styles.planLink}>
            운영 계획 보기 →
          </Link>
        </div>
      </div>
    </section>
  )
}
