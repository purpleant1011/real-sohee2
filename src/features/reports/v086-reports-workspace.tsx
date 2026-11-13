'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import styles from './v086-reports-workspace.module.css'

export interface ReportsMetricsData {
  inquiries?: number | null
  consultations?: number | null
  bookings?: number | null
  conversionRate?: number | null
  isLiveEvidence?: boolean
}

export interface V086ReportsWorkspaceProps {
  metrics?: ReportsMetricsData
}

export function V086ReportsWorkspace({ metrics }: V086ReportsWorkspaceProps = {}) {
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter'>('week')
  const hasData = metrics?.isLiveEvidence === true

  const inquiries = metrics?.inquiries ?? null
  const consultations = metrics?.consultations ?? null
  const bookings = metrics?.bookings ?? null
  const conversionRate = metrics?.conversionRate ?? null

  return (
    <div className={styles.workspaceWrapper}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>사업 성과</h1>
          <p className={styles.subtitle}>
            소희가 만든 변화를 근거와 함께 보여드려요. 문의에서 상담, 예약, 재방문까지 바이름의 실제 성장 흐름을 확인해요.
          </p>
        </div>

        <div className={styles.periodTabs}>
          <button
            type="button"
            className={`${styles.periodBtn} ${period === 'week' ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('week')}
          >
            이번 주
          </button>
          <button
            type="button"
            className={`${styles.periodBtn} ${period === 'month' ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('month')}
          >
            4주
          </button>
          <button
            type="button"
            className={`${styles.periodBtn} ${period === 'quarter' ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('quarter')}
          >
            3개월
          </button>
        </div>
      </header>

      {/* 4 Core Metrics Grid */}
      <section className={styles.metricsGrid} aria-label="4대 핵심 성과 지표">
        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>신규 문의</span>
            <span className={styles.tagActual}>{hasData ? '실측' : '측정 대기'}</span>
          </div>
          <strong className={styles.metricNum}>{inquiries !== null ? `${inquiries}건` : '-'}</strong>
          <span className={styles.metricSub}>{hasData ? '실시간 인입 집계' : '측정 데이터 준비 중'}</span>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>유효 상담</span>
            <span className={styles.tagActual}>{hasData ? '실측' : '측정 대기'}</span>
          </div>
          <strong className={styles.metricNum}>{consultations !== null ? `${consultations}건` : '-'}</strong>
          <span className={styles.metricSub}>{hasData ? '상담 전환 추적 중' : '측정 데이터 준비 중'}</span>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>예약 확정</span>
            <span className={styles.tagActual}>{hasData ? '실측' : '측정 대기'}</span>
          </div>
          <strong className={styles.metricNum} style={{ color: '#0284c7' }}>
            {bookings !== null ? `${bookings}건` : '-'}
          </strong>
          <span className={styles.metricSub}>{hasData ? '확정 예약 집계' : '측정 데이터 준비 중'}</span>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>예약 전환율</span>
            <span className={styles.tagCalc}>{hasData ? '계산' : '산출 대기'}</span>
          </div>
          <strong className={styles.metricNum} style={{ color: '#059669' }}>
            {conversionRate !== null ? `${conversionRate.toFixed(1)}%` : '-'}
          </strong>
          <span className={styles.metricSub}>{hasData ? '실시간 산출 완료' : '충분한 모수 확보 후 산출'}</span>
        </div>
      </section>

      {/* Booking Conversion Flow & Weekly Trend */}
      <div className={styles.twoColGrid}>
        {/* Weekly Trend Chart Mock */}
        <section className={styles.cardBox} aria-labelledby="conversion-trend-title">
          <div className={styles.boxHeader}>
            <div>
              <h2 id="conversion-trend-title" className={styles.boxTitle}>예약 전환 흐름</h2>
              <span className={styles.boxSubtitle}>빠른 답변이 실제 예약으로 이어지고 있어요.</span>
            </div>
            <span className={styles.tagActual}>실측 데이터</span>
          </div>

          <div className={styles.barChartContainer}>
            <div className={styles.chartLegend}>
              <span><span className={styles.legendDotThis} /> 이번 주 예약</span>
              <span><span className={styles.legendDotLast} /> 지난주 평균</span>
            </div>

            <div className={styles.barsRow}>
              {['월', '화', '수', '목', '금', '토', '일'].map((day, i) => (
                <div key={day} className={styles.barGroup}>
                  <div className={styles.barsVisual}>
                    <div
                      className={styles.barThis}
                      style={{ height: `${[40, 60, 50, 80, 90, 100, 70][i]}%` }}
                    />
                    <div
                      className={styles.barLast}
                      style={{ height: `${[30, 45, 40, 65, 75, 80, 55][i]}%` }}
                    />
                  </div>
                  <span className={styles.barLabel}>{day}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Customer Journey Funnel */}
        <section className={styles.cardBox} aria-labelledby="funnel-title">
          <div className={styles.boxHeader}>
            <div>
              <h2 id="funnel-title" className={styles.boxTitle}>고객 여정</h2>
              <span className={styles.boxSubtitle}>
                {hasData
                  ? `문의 ${inquiries ?? 0}건 중 ${bookings ?? 0}건이 예약됐어요.`
                  : '실시간 고객 여정 유입 및 전환 추적 중'}
              </span>
            </div>
          </div>

          <div className={styles.funnelList}>
            <div className={styles.funnelRow}>
              <div className={styles.funnelLabel}>
                <span>1. 문의 인입</span>
                <strong>{inquiries !== null ? `${inquiries}건` : '-'}</strong>
              </div>
              <div className={styles.funnelTrack}>
                <div className={styles.funnelBar} style={{ width: inquiries ? '100%' : '0%' }} />
              </div>
            </div>

            <div className={styles.funnelRow}>
              <div className={styles.funnelLabel}>
                <span>2. 유효 상담</span>
                <strong>{consultations !== null ? `${consultations}건` : '-'}</strong>
              </div>
              <div className={styles.funnelTrack}>
                <div
                  className={styles.funnelBar}
                  style={{
                    width: inquiries && consultations ? `${Math.min(100, Math.round((consultations / inquiries) * 100))}%` : '0%',
                  }}
                />
              </div>
            </div>

            <div className={styles.funnelRow}>
              <div className={styles.funnelLabel}>
                <span>3. 예약 확정</span>
                <strong style={{ color: '#0284c7' }}>{bookings !== null ? `${bookings}건` : '-'}</strong>
              </div>
              <div className={styles.funnelTrack}>
                <div
                  className={styles.funnelBar}
                  style={{
                    width: inquiries && bookings ? `${Math.min(100, Math.round((bookings / inquiries) * 100))}%` : '0%',
                    backgroundColor: '#0284c7',
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Sohee Operating Insights */}
      <section className={styles.insightSection} aria-labelledby="sohee-insight-title">
        <div className={styles.insightHeader}>
          <span className={styles.insightTag}>💡 소희의 해석</span>
          <h2 id="sohee-insight-title" className={styles.insightHeading}>
            다음 주 운영에 반영할 변화
          </h2>
        </div>

        <div className={styles.insightCardsGrid}>
          <div className={styles.insightItemCard}>
            <h3>오후 6시 전 답변이 상담 전환에 도움이 될 수 있어요.</h3>
            <p>퇴근 시간 전 문의에 바로 응대하면 예약으로 이어지기 쉽습니다. 다만 이 매장의 전환율 변화는 아직 측정 전이에요.</p>
            <div className={styles.insightActionRow}>
              <Link href="/app/automation" className={styles.applyAutomationBtn}>
                자동화 설정으로 이동 →
              </Link>
            </div>
          </div>

          <div className={styles.insightItemCard}>
            <h3>사장님의 상담 과정 콘텐츠가 저장 반응을 만들어요.</h3>
            <p>단순 매장 사진보다 1:1 맞춤형 대화형 콘텐츠가 반응을 얻는 경우가 많습니다. 다만 이 매장의 저장 반응 배수는 아직 측정 전이에요.</p>
            <div className={styles.insightActionRow}>
              <Link href="/app/content" className={styles.applyContentBtn}>
                콘텐츠 준비하기 →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
