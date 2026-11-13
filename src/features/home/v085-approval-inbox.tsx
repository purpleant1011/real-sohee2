'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import styles from './v085-approval-inbox.module.css'

export interface ApprovalItem {
  id: string
  icon: string
  channel: string
  scheduledTime: string
  title: string
  reasonForApproval: string
  version: string
  estimatedCredits: number
  provenance: string
  previewText?: string
  hashtags?: string[]
}

const DEFAULT_APPROVAL_ITEMS: ApprovalItem[] = [
  {
    id: 'appr-01',
    icon: '◎',
    channel: 'Instagram 게시물',
    scheduledTime: '오늘 18:00',
    title: '“자연스러움은 더하는 게 아니라, 나답게 정돈하는 것”',
    reasonForApproval: '새로운 예약 유도 문구가 포함되어 최종 확인이 필요해요.',
    version: '최종 버전 v4',
    estimatedCredits: 6,
    provenance: '계산 · 최근 반응 기준',
    previewText: '자연스러움은 억지로 더하는 게 아니라, 나답게 정돈하는 것 🌿\n대표 사장님의 1:1 맞춤 서비스로 일상 속 가장 편안한 라인을 찾아드려요.\n\n✨ 9월 한정: 인스타 문의 후 첫 방문 시 15% 혜택\n📍 프로필 링크에서 간편하게 예약 가능합니다.',
    hashtags: ['#우리매장', '#인기메뉴', '#고객만족', '#1대1맞춤상담'],
  },
  {
    id: 'appr-02',
    icon: 'N',
    channel: '네이버 플레이스 리뷰 답글',
    scheduledTime: '1시간 전',
    title: '첫 방문 고객의 꼼꼼한 상담 후기',
    reasonForApproval: '별점 5점 감사 인사와 함께 재방문 예약 안내가 포함되어 있어요.',
    version: '최종 버전 v2',
    estimatedCredits: 2,
    provenance: '실측 · 신규 리뷰',
    previewText: '안녕하세요 고객님, 사장입니다. 저희 맞춤 서비스에 만족하셨다니 정말 보람되고 기쁩니다 💖 다음 방문 시기에도 편안하게 모시겠습니다. 감사합니다!',
  },
]

export function V085ApprovalInbox() {
  const [items] = useState<ApprovalItem[]>(DEFAULT_APPROVAL_ITEMS)
  const [approvedStatus, setApprovedStatus] = useState<Record<string, boolean>>({})
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({})
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const handleApprove = (id: string, time: string) => {
    setApprovedStatus((prev) => ({ ...prev, [id]: true }))
    setToastMessage(`✓ 승인했어요! ${time}에 안전하게 실행할게요.`)
    setTimeout(() => setToastMessage(null), 3000)
  }

  const togglePreview = (id: string) => {
    setPreviewOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const pendingCount = items.filter((item) => !approvedStatus[item.id]).length

  return (
    <section className={styles.approvalSection} id="approvals" aria-labelledby="approval-heading">
      <div className={styles.sectionHeader}>
        <div className={styles.titleGroup}>
          <h2 id="approval-heading" className={styles.sectionTitle}>
            사장님 확인 필요
          </h2>
          <span className={styles.pendingSubtitle}>
            소희가 <strong>{pendingCount}건</strong>을 기다리고 있어요
          </span>
        </div>
        <Link href="/app/work" className={styles.viewAllLink}>
          모두 보기 →
        </Link>
      </div>

      {toastMessage && (
        <div className={styles.toastAlert} aria-live="polite">
          {toastMessage}
        </div>
      )}

      {pendingCount === 0 ? (
        <div className={styles.emptyState}>
          <span>✓ 모든 승인 항목을 확인하셨습니다. 소희가 계획대로 실행합니다.</span>
        </div>
      ) : (
        <div className={styles.cardsGrid}>
          {items.map((item) => {
            const isApproved = approvedStatus[item.id]
            const isPreviewing = previewOpen[item.id]

            if (isApproved) {
              return (
                <div key={item.id} className={styles.approvedCard}>
                  <span>✓ <strong>{item.title}</strong> 승인 완료 (실행 예약됨)</span>
                </div>
              )
            }

            return (
              <article key={item.id} className={styles.itemCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.channelMeta}>
                    <span className={styles.channelIcon}>{item.icon}</span>
                    <span className={styles.channelName}>{item.channel}</span>
                    <span className={styles.timeBadge}>{item.scheduledTime}</span>
                  </div>
                  <div className={styles.creditMeta}>
                    <span>{item.version}</span>
                    <span className={styles.metaDivider}>·</span>
                    <span className={styles.creditValue}>예상 {item.estimatedCredits} C</span>
                  </div>
                </div>

                <h3 className={styles.itemTitle}>{item.title}</h3>
                <p className={styles.reasonText}>{item.reasonForApproval}</p>

                {/* Preview Drawer / Expand */}
                {isPreviewing && item.previewText && (
                  <div className={styles.previewBox}>
                    <pre className={styles.previewContent}>{item.previewText}</pre>
                    {item.hashtags && (
                      <p className={styles.hashtagRow}>{item.hashtags.join(' ')}</p>
                    )}
                  </div>
                )}

                <div className={styles.cardFooter}>
                  <span className={styles.provenanceTag}>{item.provenance}</span>
                  <div className={styles.actionsGroup}>
                    {item.previewText && (
                      <button
                        type="button"
                        className={styles.previewBtn}
                        onClick={() => togglePreview(item.id)}
                      >
                        {isPreviewing ? '미리보기 닫기' : '미리보기'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.approveBtn}
                      onClick={() => handleApprove(item.id, item.scheduledTime)}
                    >
                      승인
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
