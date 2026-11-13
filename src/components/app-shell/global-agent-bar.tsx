'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Bell, PanelsRightBottom, X } from 'lucide-react'
import { AccountMenu } from './account-menu'
import { SoheeBrandMark } from '@/components/brand/sohee-avatar'
import styles from './global-agent-bar.module.css'

export type AgentStatusType = 'working' | 'waiting_approval' | 'paused'

export interface GlobalAgentBarProps {
  workspaceName?: string
  /** false면 서버에서 확인된 이름이 아님(미연결·미확인). 안내 문구로만 표시한다. */
  workspaceNameVerified?: boolean
  agentStatus?: AgentStatusType
  pendingApprovalCount?: number
  currentCredits?: number
  totalCredits?: number
  unreadCount?: number
  isRightRailOpen?: boolean
  onToggleRightRail?: () => void
  onTogglePause?: (paused: boolean) => void
}

export function GlobalAgentBar(props: GlobalAgentBarProps) {
  const {
    workspaceName = '작업공간 확인 중',
    workspaceNameVerified = true,
    agentStatus = 'working',
    pendingApprovalCount = 0,
    unreadCount = 0,
    isRightRailOpen = false,
    onToggleRightRail,
    onTogglePause,
  } = props
  const [isPaused, setIsPaused] = useState(agentStatus === 'paused')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)

  const handlePauseToggle = () => {
    const nextPaused = !isPaused
    setIsPaused(nextPaused)
    if (onTogglePause) {
      onTogglePause(nextPaused)
    }
  }

  return (
    <header className={styles.agentBar} role="banner" aria-label="글로벌 에이전트 헤더 바">
      {/* Left: Workspace & Agent Live Status */}
      <div className={styles.leftSection}>
        {/* Mobile Brand Mark */}
        <span aria-hidden="true" className={styles.mobileHeaderBrand} data-mobile-sohee-logo>
          <SoheeBrandMark size="small" />
        </span>

        {/* Workspace Selector */}
        <div className={styles.workspaceSelector}>
          <button
            type="button"
            className={styles.workspaceButton}
            onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            aria-expanded={workspaceMenuOpen}
            aria-haspopup="true"
            aria-label={`작업공간 선택: ${workspaceName}`}
          >
            {workspaceNameVerified ? <span className={styles.storeIcon} aria-hidden="true">💈</span> : null}
            <span className={styles.workspaceName}>{workspaceName}</span>
            <span className={styles.chevron} aria-hidden="true">▼</span>
          </button>

          {workspaceMenuOpen && (
            <div className={styles.workspaceDropdown} role="menu">
              {workspaceNameVerified ? (
                <button
                  type="button"
                  className={`${styles.dropdownItem} ${styles.dropdownItemActive}`}
                  role="menuitem"
                  onClick={() => setWorkspaceMenuOpen(false)}
                >
                  <strong>{workspaceName}</strong>
                </button>
              ) : (
                <div className={styles.dropdownItem} role="menuitem" aria-disabled="true">
                  {workspaceName}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agent Status Pill */}
        <div className={styles.statusIndicator}>
          <span className={styles.agentAvatar} aria-hidden="true">👩🏻</span>
          <span className={styles.agentLabel}>소희</span>
          <div
            className={`${styles.statusPill} ${
              isPaused
                ? styles.statusPaused
                : pendingApprovalCount > 0
                ? styles.statusPending
                : styles.statusWorking
            }`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <span className={styles.statusText}>
              {isPaused ? '중지됨' : pendingApprovalCount > 0 ? '확인 대기 중' : '일하는 중'}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Actions, Budget, Context Toggle, Notifications, Account */}
      <div className={styles.rightSection}>
        {/* 1. Pending Approvals CTA */}
        {pendingApprovalCount > 0 && (
          <Link
            href="/app#approvals"
            className={styles.approvalBadge}
            aria-label={`${pendingApprovalCount}건의 승인 확인 필요`}
          >
            <span className={styles.approvalIcon} aria-hidden="true">⚠️</span>
            <span className={styles.approvalCount}>{pendingApprovalCount}건 확인 필요</span>
          </Link>
        )}

        {/* 2. Emergency Kill Switch */}
        <button
          type="button"
          onClick={handlePauseToggle}
          className={`${styles.emergencyButton} ${isPaused ? styles.emergencyButtonActive : ''}`}
          aria-pressed={isPaused}
          aria-label={isPaused ? '소희 업무 재개하기' : '소희 긴급 일시정지'}
        >
          <span className={styles.emergencyIcon} aria-hidden="true">{isPaused ? '▶' : '⏸'}</span>
          <span>{isPaused ? '업무 재개' : '긴급 일시정지'}</span>
        </button>

        {/* 3. [사용자 요청] 우측 업무 문맥 / 성과 레일 토글 버튼 */}
        <button
          type="button"
          onClick={onToggleRightRail}
          className={`${styles.contextToggleButton} ${isRightRailOpen ? styles.contextToggleActive : ''}`}
          aria-expanded={isRightRailOpen}
          aria-label={isRightRailOpen ? '업무 문맥 패널 닫기' : '업무 문맥 패널 열기'}
          title="소희 업무 문맥 열기/닫기"
        >
          {isRightRailOpen ? (
            <X size={15} aria-hidden="true" />
          ) : (
            <PanelsRightBottom size={15} aria-hidden="true" />
          )}
          <span className={styles.contextButtonText}>업무 문맥</span>
        </button>

        {/* 5. Notifications Bell Button */}
        <Link
          aria-label="알림 열기"
          className={styles.headerIconButton}
          href="/app/notifications"
          prefetch={false}
        >
          <Bell size={18} strokeWidth={1.8} aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className={styles.unreadBadge}>{Math.min(unreadCount, 99)}</span>
          ) : null}
        </Link>

        {/* 6. Account Menu Dropdown */}
        <AccountMenu />
      </div>
    </header>
  )
}
