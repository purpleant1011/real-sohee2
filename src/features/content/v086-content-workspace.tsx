'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import styles from './v086-content-workspace.module.css'

export interface ContentItem {
  id: string
  icon: string
  pillar: string
  channel: 'Instagram' | 'Threads' | '당근' | '네이버 블로그'
  stage: '아이디어' | '초안' | '승인 대기' | '예약 완료' | '게시 완료'
  title: string
  scheduledDate: string
  estimatedCredits: number
  previewSnippet: string
}

const DEFAULT_CONTENTS: ContentItem[] = [
  {
    id: 'cnt-01',
    icon: '◎',
    pillar: '매장 이야기',
    channel: 'Instagram',
    stage: '승인 대기',
    title: '자연스러움은 더하는 게 아니라, 나답게 정돈하는 것',
    scheduledDate: '오늘 18:00',
    estimatedCredits: 6,
    previewSnippet: '자연스러움은 억지로 더하는 게 아니라, 나답게 정돈하는 것 🌿 25년 경력 사장님의 1:1 맞춤 서비스로 일상 속 가장 편안한 라인을 찾아드려요.',
  },
  {
    id: 'cnt-02',
    icon: 'T',
    pillar: '사장님 관점',
    channel: 'Threads',
    stage: '초안',
    title: '작은 변화로 또렷해지는 첫인상, 과하지 않게',
    scheduledDate: '내일 11:30',
    estimatedCredits: 2,
    previewSnippet: '작은 변화로 또렷해지는 첫인상, 과하지 않게. 일상 속에서 편안함을 더하는 가장 자연스러운 방법.',
  },
  {
    id: 'cnt-03',
    icon: '당',
    pillar: '예약 유도',
    channel: '당근',
    stage: '예약 완료',
    title: '첫 방문 고객을 위한 매장 맞춤 상담 안내',
    scheduledDate: '9월 1일',
    estimatedCredits: 4,
    previewSnippet: '동네 이웃분들을 위한 1:1 맞춤 첫 방문 상담 혜택 안내입니다.',
  },
  {
    id: 'cnt-04',
    icon: '네',
    pillar: '전문성',
    channel: '네이버 블로그',
    stage: '아이디어',
    title: '나에게 꼭 맞는 스타일을 찾는 상담 과정',
    scheduledDate: '9월 3일',
    estimatedCredits: 8,
    previewSnippet: '사장님의 오랜 노하우가 담긴 맞춤 스타일 분석 가이드.',
  },
]

export function V086ContentWorkspace() {
  const [stageFilter, setStageFilter] = useState<'전체' | '아이디어' | '초안' | '승인 대기' | '예약 완료'>('전체')
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null)

  const filteredList = stageFilter === '전체'
    ? DEFAULT_CONTENTS
    : DEFAULT_CONTENTS.filter((c) => c.stage === stageFilter)

  return (
    <div className={styles.workspaceWrapper}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>콘텐츠 운영실</h1>
          <p className={styles.subtitle}>
            우리 매장의 진솔한 이야기를 꾸준히 전해요. 채널별 초안, 승인, 게시 일정을 한곳에서 관리하고 최종 버전을 안전하게 잠가요.
          </p>
        </div>

        <div className={styles.headerActions}>
          <Link href="/app/schedule" className={styles.calendarBtn}>
            📅 캘린더 보기
          </Link>
          <button type="button" className={styles.createBtn} onClick={() => alert('소희에게 새 콘텐츠 요청 모달이 열립니다.')}>
            + 새 콘텐츠 만들기
          </button>
        </div>
      </header>

      {/* Stage Tabs */}
      <div className={styles.stageTabsRow}>
        {(['전체', '아이디어', '초안', '승인 대기', '예약 완료'] as const).map((stage) => (
          <button
            key={stage}
            type="button"
            className={`${styles.stageTab} ${stageFilter === stage ? styles.stageTabActive : ''}`}
            onClick={() => setStageFilter(stage)}
          >
            {stage}
          </button>
        ))}
      </div>

      {/* Content Cards Grid */}
      <section className={styles.cardsGrid} aria-label="콘텐츠 목록">
        {filteredList.map((item) => (
          <article key={item.id} className={styles.contentCard}>
            <div className={styles.cardHeader}>
              <div className={styles.channelMeta}>
                <span className={styles.channelIcon}>{item.icon}</span>
                <span className={styles.pillarTag}>{item.pillar}</span>
                <span className={styles.channelName}>{item.channel}</span>
              </div>
              <span className={`${styles.stageBadge} ${item.stage === '승인 대기' ? styles.stageApproval : styles.stageNormal}`}>
                {item.stage}
              </span>
            </div>

            <h3 className={styles.cardTitle}>{item.title}</h3>
            <p className={styles.snippetText}>{item.previewSnippet}</p>

            <div className={styles.cardFooter}>
              <span className={styles.dateMeta}>{item.scheduledDate}</span>
              <button
                type="button"
                className={styles.openDetailBtn}
                onClick={() => setSelectedContent(item)}
              >
                열어보기 →
              </button>
            </div>
          </article>
        ))}
      </section>

      {/* Weekly Content Flow */}
      <section className={styles.weeklyFlowSection} aria-labelledby="weekly-flow-title">
        <div className={styles.flowHeader}>
          <h2 id="weekly-flow-title" className={styles.flowHeading}>
            이번 주 게시 흐름
          </h2>
          <span className={styles.flowSub}>채널 사이의 역할이 겹치지 않게 운영해요.</span>
        </div>

        <div className={styles.flowDaysGrid}>
          <div className={styles.dayCol}>
            <span className={styles.dayLabel}>월요일</span>
            <div className={styles.dayCard}>
              <span className={styles.dayChannel}>Instagram</span>
              <strong>게시 완료</strong>
            </div>
          </div>
          <div className={styles.dayCol}>
            <span className={styles.dayLabel}>화요일</span>
            <div className={styles.dayCard}>
              <span className={styles.dayChannel}>Threads</span>
              <strong>작성 중</strong>
            </div>
          </div>
          <div className={styles.dayCol}>
            <span className={styles.dayLabel}>목요일</span>
            <div className={styles.dayCard}>
              <span className={styles.dayChannel}>당근</span>
              <strong>예정</strong>
            </div>
          </div>
          <div className={styles.dayCol}>
            <span className={styles.dayLabel}>금요일</span>
            <div className={styles.dayCard}>
              <span className={styles.dayChannel}>Instagram</span>
              <strong>준비 중</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Content Detail Drawer */}
      {selectedContent && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="content-modal-title">
          <div className={styles.modalBody}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.modalTag}>{selectedContent.channel} · {selectedContent.pillar}</span>
                <h3 id="content-modal-title" className={styles.modalTitle}>{selectedContent.title}</h3>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setSelectedContent(null)}>✕</button>
            </div>

            <div className={styles.modalContentBox}>
              <pre className={styles.fullSnippet}>{selectedContent.previewSnippet}</pre>
              <div className={styles.modalMetaRow}>
                <span>예정 시각: <strong>{selectedContent.scheduledDate}</strong></span>
              </div>
            </div>

            <div className={styles.modalActions}>
              <Link href="/app/conversations" className={styles.editWithSoheeBtn}>
                소희에게 수정 부탁하기
              </Link>
              <button
                type="button"
                className={styles.approveModalBtn}
                onClick={() => {
                  alert('승인되었습니다. 예약된 시간에 안전하게 발행됩니다.')
                  setSelectedContent(null)
                }}
              >
                ✓ 이대로 승인하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
