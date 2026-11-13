'use client'

import React from 'react'
import Link from 'next/link'
import styles from './v085-today-schedule.module.css'

export interface ScheduleItem {
  id: string
  time: string
  title: string
  tag: string
  statusType: 'completed' | 'scheduled' | 'approval_pending'
}

const DEFAULT_SCHEDULE_ITEMS: ScheduleItem[] = [
  {
    id: 'sc-01',
    time: '09:00',
    title: '밤사이 문의 분류',
    tag: '4건 완료',
    statusType: 'completed',
  },
  {
    id: 'sc-02',
    time: '10:30',
    title: '미예약 고객 재접촉',
    tag: 'Instagram DM',
    statusType: 'scheduled',
  },
  {
    id: 'sc-03',
    time: '18:00',
    title: '자연눈썹 콘텐츠 게시',
    tag: '승인 대기',
    statusType: 'approval_pending',
  },
]

export function V085TodaySchedule() {
  return (
    <section className={styles.scheduleCard} aria-labelledby="today-schedule-title">
      <div className={styles.cardHeader}>
        <div>
          <h3 id="today-schedule-title" className={styles.cardTitle}>
            오늘 일정
          </h3>
          <span className={styles.cardSubtitle}>소희의 근무표</span>
        </div>
        <Link href="/app/automation" className={styles.scheduleLink}>
          전체 근무표 보기 →
        </Link>
      </div>

      <div className={styles.timelineList}>
        {DEFAULT_SCHEDULE_ITEMS.map((item) => (
          <div key={item.id} className={styles.timelineItem}>
            <div className={styles.timeBadge}>{item.time}</div>
            <div className={styles.itemBody}>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={`${styles.statusBadge} ${styles[item.statusType]}`}>
                {item.tag}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
