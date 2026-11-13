'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import styles from './v085-customer-opportunities.module.css'

export interface CustomerOpportunity {
  id: string
  channel: string
  timeAgo: string
  customerMessage: string
  soheeRationale: string
  opportunityBadge: string
  provenance: string
  actionLabel: string
  recommendedReply: string
}

const DEFAULT_OPPORTUNITIES: CustomerOpportunity[] = [
  {
    id: 'opp-01',
    channel: 'Instagram',
    timeAgo: '12분 전',
    customerMessage: '“다음 주 토요일 맞춤 상담 가능할까요?”',
    soheeRationale: '예약 의도와 날짜가 명확해요. 가능한 시간 2개를 제안할게요.',
    opportunityBadge: '예약 가능성 높음',
    provenance: '계산 · 유사 문의 38건 기준',
    actionLabel: '소희 답변 확인',
    recommendedReply: '안녕하세요 고객님! 다음 주 토요일(9/6) 14:00, 16:30에 상담 및 서비스 예약 가능합니다. 편하신 시간으로 바로 잡아드릴까요? 😊',
  },
  {
    id: 'opp-02',
    channel: '네이버 플레이스',
    timeAgo: '2시간 전',
    customerMessage: '“너무 꼼꼼하고 친절하게 봐주셨어요.”',
    soheeRationale: '감사 답글과 함께 재방문 안내를 제안할게요.',
    opportunityBadge: '재방문 기회',
    provenance: '실측 · 연결 채널',
    actionLabel: '재방문 만들기',
    recommendedReply: '소중한 후기 감사드립니다! 다음 재방문 시기에 맞춰 연락 주시면 정성껏 준비해 드리겠습니다 💖',
  },
]

export function V085CustomerOpportunities() {
  const [repliedStatus, setRepliedStatus] = useState<Record<string, boolean>>({})

  const handleAction = (id: string) => {
    setRepliedStatus((prev) => ({ ...prev, [id]: true }))
  }

  return (
    <section className={styles.opportunitiesSection} aria-labelledby="opportunities-heading">
      <div className={styles.sectionHeader}>
        <div className={styles.titleGroup}>
          <h2 id="opportunities-heading" className={styles.sectionTitle}>
            오늘의 고객 기회
          </h2>
          <span className={styles.sectionSubtitle}>
            지금 응답하면 예약으로 이어질 가능성이 높아요
          </span>
        </div>
        <Link href="/app/customers" className={styles.viewAllLink}>
          고객함 보기 →
        </Link>
      </div>

      <div className={styles.cardsGrid}>
        {DEFAULT_OPPORTUNITIES.map((opp) => {
          const isReplied = repliedStatus[opp.id]

          return (
            <article key={opp.id} className={styles.oppCard}>
              <div className={styles.cardHeader}>
                <span className={styles.channelTag}>{opp.channel}</span>
                <span className={styles.timeText}>{opp.timeAgo}</span>
              </div>

              <blockquote className={styles.quoteMessage}>
                {opp.customerMessage}
              </blockquote>

              <div className={styles.soheeBox}>
                <span className={styles.soheeLabel}>소희:</span>
                <p className={styles.soheeText}>{opp.soheeRationale}</p>
              </div>

              <div className={styles.cardFooter}>
                <div className={styles.badgeCol}>
                  <span className={styles.oppBadge}>{opp.opportunityBadge}</span>
                  <span className={styles.provenanceText}>{opp.provenance}</span>
                </div>

                {isReplied ? (
                  <span className={styles.repliedTag}>✓ 답변 완료</span>
                ) : (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => handleAction(opp.id)}
                  >
                    {opp.actionLabel}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
