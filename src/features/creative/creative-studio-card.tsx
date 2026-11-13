'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Pencil,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import styles from './creative-studio-card.module.css'
import type { VisualBrief } from './visual-brief-types'
import type { MediaAsset } from '../media/media-asset-types'
import type { VisualSemanticQCResult } from './visual-semantic-qc'
import type { CreativeBundle } from './creative-bundle-types'

export interface CreativeStudioCardProps {
  bundle?: CreativeBundle
  brief: VisualBrief
  mediaAsset?: MediaAsset | null
  qcResult?: VisualSemanticQCResult
  rightsConfirmed?: boolean
  onApprove?: () => void | Promise<void>
  onRegenerateImage?: () => void | Promise<void>
  onEditCaption?: () => void
  onPublishNow?: () => void | Promise<void>
  isProcessing?: boolean
}

export function CreativeStudioCard({
  bundle,
  brief,
  mediaAsset,
  qcResult,
  rightsConfirmed = true,
  onApprove,
  onRegenerateImage,
  onEditCaption,
  onPublishNow,
  isProcessing = false,
}: CreativeStudioCardProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'brief'>('preview')

  const isApproved = bundle?.approvalStatus === 'APPROVED'
  const isQcPassed = qcResult?.decision === 'PASS'
  const isQcFailed = qcResult?.decision === 'FAIL'
  const hasMedia = Boolean(mediaAsset)

  // Preflight validation for approval
  const canApprove = hasMedia && isQcPassed && rightsConfirmed && !isApproved

  const getQcBadge = () => {
    if (!qcResult) {
      return (
        <span className={`${styles.qcBadge} ${styles.qcReview}`} role="status">
          <AlertTriangle size={14} />
          QC 검토 대기
        </span>
      )
    }

    if (qcResult.decision === 'PASS') {
      return (
        <span className={`${styles.qcBadge} ${styles.qcPass}`} role="status">
          <CheckCircle2 size={14} />
          시각 정합성 통과
        </span>
      )
    }

    if (qcResult.decision === 'REVIEW_REQUIRED') {
      return (
        <span className={`${styles.qcBadge} ${styles.qcReview}`} role="status">
          <AlertTriangle size={14} />
          정합성 수동 검토 필요
        </span>
      )
    }

    return (
      <span className={`${styles.qcBadge} ${styles.qcFail}`} role="status">
        <XCircle size={14} />
        정합성 불일치
      </span>
    )
  }

  return (
    <article
      aria-label="Creative Asset Truth Studio"
      className={styles.container}
      data-testid="creative-studio-card"
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h3>
            {brief.channelSpec.channel === 'instagram' ? 'Instagram' : 'Threads'} 크리에이티브 스튜디오
          </h3>
          <p>비즈니스·원고 정본에 기반하여 GPT Image 2로 생성된 단일 진실 자산</p>
        </div>
        {getQcBadge()}
      </header>

      {isQcFailed && (
        <div className={styles.qcWarningBox} role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>이미지-원고 불일치 감지:</strong> {qcResult?.reasons.join(', ')}
            <br />
            원고 내용과 일치하지 않는 이미지는 승인 및 게시가 차단됩니다. 이미지를 다시 생성해 주세요.
          </div>
        </div>
      )}

      <div className={styles.contentGrid}>
        {/* Left: Media Preview & Provenance */}
        <section aria-label="생성 미디어 프리뷰" className={styles.mediaPreviewSection}>
          <div className={styles.imageFrame}>
            {mediaAsset ? (
              <Image
                alt={brief.creativeDirection.heroSubject}
                className={styles.image}
                height={mediaAsset.height || 1024}
                src={`/api/workspaces/${brief.workspaceId}/media/${mediaAsset.id}`}
                unoptimized
                width={mediaAsset.width || 1024}
              />
            ) : (
              <div className={styles.emptyState}>
                <Sparkles size={32} />
                <p>생성된 이미지가 없습니다.</p>
                <small>GPT Image 2로 실제 이미지를 생성해 주세요.</small>
              </div>
            )}
          </div>

          {mediaAsset && (
            <dl className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <dt>생성 모델</dt>
                <dd>OpenAI gpt-image-2</dd>
              </div>
              <div className={styles.metaItem}>
                <dt>출처 성격</dt>
                <dd>{mediaAsset.source_type}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt>규격 / 비율</dt>
                <dd>
                  {mediaAsset.width}×{mediaAsset.height} ({brief.channelSpec.aspectRatio})
                </dd>
              </div>
              <div className={styles.metaItem}>
                <dt>파일 확인값</dt>
                <dd title={mediaAsset.sha256_digest}>
                  {mediaAsset.sha256_digest.slice(0, 12)}...{mediaAsset.sha256_digest.slice(-8)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {/* Right: Copy & Visual Brief Context */}
        <section aria-label="원고 및 Visual Brief" className={styles.briefSection}>
          <div className={styles.briefCard}>
            <h4>제안 문안 (Caption 요약)</h4>
            <div className={styles.captionBox}>{brief.captionSummary}</div>
          </div>

          <div className={styles.briefCard}>
            <h4>Visual Brief 세부 스펙</h4>
            <dl className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <dt>핵심 대상 / 상품</dt>
                <dd>{brief.creativeDirection.heroSubject}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt>공간 / 환경</dt>
                <dd>{brief.creativeDirection.environment}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt>구도 및 앵글</dt>
                <dd>{brief.creativeDirection.composition}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt>톤 & 무드</dt>
                <dd>{brief.creativeDirection.lighting} ({brief.creativeDirection.colorPalette.join(', ')})</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* Footer Actions: In-Chat & Mobile Dual Decision Making */}
      <footer aria-label="의사결정 작업" className={styles.actionDock}>
        <button
          className={`${styles.buttonBase} ${styles.secondaryButton}`}
          disabled={isProcessing}
          onClick={onEditCaption}
          type="button"
        >
          <Pencil size={16} />
          문구 다듬기
        </button>

        <button
          className={`${styles.buttonBase} ${styles.secondaryButton}`}
          disabled={isProcessing}
          onClick={onRegenerateImage}
          type="button"
        >
          <RefreshCw size={16} />
          이미지 다시 생성 (gpt-image-2)
        </button>

        {!isApproved ? (
          <button
            className={`${styles.buttonBase} ${styles.primaryApproveButton}`}
            disabled={!canApprove || isProcessing}
            onClick={onApprove}
            type="button"
          >
            <ShieldCheck size={16} />
            이 원고 + 이 이미지 승인
          </button>
        ) : (
          <button
            className={`${styles.buttonBase} ${styles.publishButton}`}
            disabled={isProcessing}
            onClick={onPublishNow}
            type="button"
          >
            <Send size={16} />
            지금 바로 채널에 게시
          </button>
        )}
      </footer>
    </article>
  )
}
