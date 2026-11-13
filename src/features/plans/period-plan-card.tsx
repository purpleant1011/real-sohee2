'use client'

import { ArrowRight, Check, ShieldCheck, Target } from 'lucide-react'
import { CreditEstimate } from '@/components/cards/credit-estimate'
import { StatusBadge } from '@/components/status/status-badge'
import type { PeriodPlanChannel } from './types'
import styles from './period-plan-card.module.css'

export type PeriodPlanCardArtifact = Readonly<{
  id: string
  originalRequest: string
  periodStart: string
  periodEnd: string
  timezone: string
  goal: string
  channels: readonly Readonly<{ channel: PeriodPlanChannel; postCount: number; imagesPerPost: number }>[]
  catalogVersion: number
  estimatedCredits: number
  expectedRemainingCredits: number
  status: 'ready' | 'insufficient'
}>

export type PeriodPlanAction = 'reduce' | 'confirm'

const channelDetails: Readonly<Record<PeriodPlanChannel, { label: string; mark: string; mode: string }>> = {
  instagram: { label: '인스타그램', mark: 'I', mode: '공식 연결형' },
  threads: { label: '스레드', mark: 'T', mode: '공식 연결형' },
  naver_blog: { label: '네이버 블로그', mark: 'N', mode: '최종 확인형' },
  naver_place: { label: '네이버 플레이스', mark: 'P', mode: '감독형 확인' },
  daangn: { label: '당근 비즈프로필', mark: 'D', mode: '감독형 확인' },
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
}

function periodDays(start: string, end: string) {
  const duration = parseDate(end).getTime() - parseDate(start).getTime()
  return Math.max(1, Math.round(duration / 86_400_000) + 1)
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(parseDate(value))
}

function objectParticle(value: string) {
  const last = value.trim().at(-1)
  if (!last) return '를'
  const code = last.charCodeAt(0)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  return isHangul && ((code - 0xac00) % 28 !== 0) ? '을' : '를'
}

export function PeriodPlanCard({ artifact, disabled = false, onAction }: Readonly<{
  artifact: PeriodPlanCardArtifact
  disabled?: boolean
  onAction?: (action: PeriodPlanAction) => void
}>) {
  const postCount = artifact.channels.reduce((total, item) => total + item.postCount, 0)
  const imageCount = artifact.channels.reduce((total, item) => total + (item.postCount * item.imagesPerPost), 0)
  const availableCredits = artifact.estimatedCredits + artifact.expectedRemainingCredits
  const insufficient = artifact.status === 'insufficient' || artifact.expectedRemainingCredits < 0
  const days = periodDays(artifact.periodStart, artifact.periodEnd)

  return (
    <section aria-label="기간별 계획 제안" className={styles.card}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>계획 제안</span>
          <h2>{artifact.goal}{objectParticle(artifact.goal)} 위한 {days}일 계획</h2>
          <p>{displayDate(artifact.periodStart)} - {displayDate(artifact.periodEnd)}</p>
        </div>
        <StatusBadge
          label={insufficient ? '범위 조정 필요' : '확인이 필요해요'}
          tone="review"
        />
      </header>

      <section aria-label="계획 목표" className={styles.goal}>
        <span aria-hidden="true"><Target /></span>
        <div>
          <small>이번 계획의 목표</small>
          <strong>{artifact.goal}</strong>
          <p>{artifact.originalRequest}</p>
        </div>
      </section>

      <section aria-label="선택한 채널" className={styles.channels}>
        <div className={styles.sectionHeading}>
          <strong>선택한 채널 {artifact.channels.length}개</strong>
          <span>게시물 {postCount}개 · 이미지 {imageCount}장</span>
        </div>
        <ul>
          {artifact.channels.map((item) => {
            const detail = channelDetails[item.channel]
            const channelImages = item.postCount * item.imagesPerPost
            return (
              <li data-channel={item.channel} key={item.channel}>
                <span aria-hidden="true" className={styles.channelMark}>{detail.mark}</span>
                <div>
                  <strong>{detail.label}</strong>
                  <small>{detail.mode}</small>
                </div>
                <p>게시물 {item.postCount}개<span>이미지 {channelImages}장</span></p>
                <Check aria-hidden="true" className={styles.channelCheck} />
              </li>
            )
          })}
        </ul>
      </section>

      <div className={styles.creditBlock}>
        <CreditEstimate
          availableCredits={availableCredits}
          compact
          estimatedCredits={artifact.estimatedCredits}
        />
      </div>

      <p className={styles.boundary}>
        <ShieldCheck aria-hidden="true" />
        계획 승인 전에는 저장하거나 크레딧을 확보하지 않아요.
        <span>단가 정책 v{artifact.catalogVersion}</span>
      </p>

      <footer className={styles.actions}>
        <button disabled={disabled || !onAction} onClick={() => onAction?.('reduce')} type="button">
          범위 줄이기
        </button>
        <button
          className={styles.primary}
          disabled={disabled || insufficient || !onAction}
          onClick={() => onAction?.('confirm')}
          type="button"
        >
          이 계획으로 시작
          <ArrowRight aria-hidden="true" />
        </button>
      </footer>
    </section>
  )
}
