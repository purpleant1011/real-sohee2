'use client'

import React, { useState } from 'react'
import styles from './budget-guardian.module.css'

export interface BudgetGuardianProps {
  currentCredits?: number
  totalCredits?: number
  remainingDays?: number
  projectedDeficit?: number
}

export function BudgetGuardian({}: BudgetGuardianProps = {}) {
  const [proposalApplied, setProposalApplied] = useState(false)

  const handleApplyProposal = () => {
    setProposalApplied(true)
  }

  return (
    <section className={styles.guardianCard} aria-labelledby="budget-guardian-title">
      <div className={styles.cardHeader}>
        <div className={styles.titleGroup}>
          <span className={styles.tag}>🛡️ 소희 Budget Guardian</span>
          <h2 id="budget-guardian-title" className={styles.title}>
            이번 달 소희 업무 예산 & 지출 방어
          </h2>
          <p className={styles.subtitle}>
            단순 충전량이 아니라, 소희가 주어진 예산 범위 내에서 마케팅 우선순위를 스스로 조율해요.
          </p>
        </div>
      </div>

      {/* AI Budget Optimization Proposal */}
      <div className={styles.proposalBox}>
        <div className={styles.proposalHeader}>
          <span className={styles.proposalBadge}>💡 소희의 예산 방어 제안</span>
          <h3>핵심 고객 응대와 필수 일정은 100% 유지하고, 비핵심 작업을 절약해요</h3>
        </div>

        <div className={styles.proposalGrid}>
          <div className={styles.maintainCol}>
            <strong>✓ 100% 정상 유지 (최우선 업무)</strong>
            <ul>
              <li>예약 문의 및 DM 실시간 응대</li>
              <li>고객 불만 및 리뷰 안전 감지</li>
              <li>주요 주간 피드 게시 일정</li>
            </ul>
          </div>

          <div className={styles.adjustCol}>
            <strong>↓ 절약 조정 항목</strong>
            <ul>
              <li>경쟁사 분석 빈도: 주 3회 → 주 1회 축소</li>
              <li>AI 이미지 생성 후보: 4개 → 2개로 압축</li>
              <li>실험적 바이럴 콘텐츠: 다음 달로 자동 연기</li>
            </ul>
          </div>
        </div>

        {proposalApplied ? (
          <div className={styles.appliedAlert}>
            ✓ 소희의 예산 방어 제안이 적용되었습니다! 이번 달 추가 과금 없이 안정적으로 완주합니다.
          </div>
        ) : (
          <div className={styles.proposalActions}>
            <button
              type="button"
              className={styles.applyBtn}
              onClick={handleApplyProposal}
            >
              ✓ 소희 절약 제안 즉시 적용 (추가 비용 0원)
            </button>
          </div>
        )}
      </div>

      {/* Standard Budget Distribution Policy */}
      <div className={styles.distributionPolicy}>
        <h4>권고 업무 예산 표준 배분 원칙</h4>
        <div className={styles.policyPills}>
          <div className={styles.pillItem}>
            <strong>50%</strong> <span>핵심 정기 업무</span>
          </div>
          <div className={styles.pillItem}>
            <strong>25%</strong> <span>실시간 고객 대응</span>
          </div>
          <div className={styles.pillItem}>
            <strong>15%</strong> <span>콘텐츠 / 이미지 생성</span>
          </div>
          <div className={styles.pillItem}>
            <strong>10%</strong> <span>성과 분석 & 실험</span>
          </div>
        </div>
      </div>
    </section>
  )
}
