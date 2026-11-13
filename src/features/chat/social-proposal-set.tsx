'use client'

import Image from 'next/image'
import { CheckCircle2, GalleryHorizontalEnd, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import { ConversationResultCard } from './conversation-result-card'
import type { ConversationArtifact } from './types'
import styles from './channel-result-card.module.css'
import { channelArtifactLabel } from './channel-artifact-label'

function channelLabel(artifact: ConversationArtifact) {
  return channelArtifactLabel(artifact.type).channel
}

function candidateMedia(artifact: ConversationArtifact) {
  return artifact.slides.find((slide) => slide.status === 'succeeded' && slide.mediaAssetId !== null) ?? null
}

export function SocialProposalSet({ artifacts, onRetrySlides, replyToMessageId }: Readonly<{
  artifacts: readonly ConversationArtifact[]
  replyToMessageId: string
  onRetrySlides?: (replyToMessageId: string, artifactId: string, selectedSlideIds: readonly string[]) => void | Promise<void>
}>) {
  const saved = artifacts.find((artifact) => artifact.contentItemId && artifact.versionId)
  const savedByType = new Map(artifacts
    .filter((artifact) => artifact.contentItemId && artifact.versionId)
    .map((artifact) => [artifact.type, artifact] as const))
  const hasMultipleChannels = new Set(artifacts.map((artifact) => artifact.type)).size > 1
  const [selectedId, setSelectedId] = useState(() => saved?.id ?? artifacts[0]?.id ?? '')
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? saved ?? artifacts[0]

  if (!selected) return null

  function selectFromKeyboard(artifactId: string, key: string) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    const available = artifacts.filter((artifact) => {
      const savedForType = savedByType.get(artifact.type)
      return !savedForType || savedForType.id === artifact.id
    })
    const currentIndex = available.findIndex((artifact) => artifact.id === artifactId)
    if (currentIndex < 0) return
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? available.length - 1
        : (currentIndex + (key === 'ArrowRight' ? 1 : -1) + available.length) % available.length
    const next = available[nextIndex]
    if (!next) return
    setSelectedId(next.id)
    document.getElementById(`proposal-tab-${next.id}`)?.focus()
  }

  return (
    <section aria-label="포스팅 방향 제안" className={styles.proposalSet}>
      {artifacts.length > 1 ? (
        <>
          <header className={styles.proposalSetHeader}>
            <small>채널에 올라갈 결과물 제안 {artifacts.length}개</small>
            <h3>{hasMultipleChannels ? '채널별 결과물을 각각 검토하세요' : '완성된 게시물 형태로 비교하고 선택하세요'}</h3>
          </header>
          <div aria-label="채널별 결과물" className={styles.proposalCandidates} role="tablist">
            {artifacts.map((artifact) => {
              const media = candidateMedia(artifact)
              const ChannelIcon = artifact.type === 'threads_post' ? MessagesSquare : GalleryHorizontalEnd
              const pressed = artifact.id === selected.id
              const savedForType = savedByType.get(artifact.type)
              const locked = Boolean(savedForType) && artifact.id !== savedForType?.id
              return (
                <button
                  aria-label={`${channelLabel(artifact)} · ${artifact.caption}`}
                  aria-controls={`proposal-panel-${artifact.id}`}
                  aria-selected={pressed}
                  className={styles.proposalCandidate}
                  data-selected={pressed}
                  disabled={locked}
                  id={`proposal-tab-${artifact.id}`}
                  key={artifact.id}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    selectFromKeyboard(artifact.id, event.key)
                  }}
                  onClick={() => setSelectedId(artifact.id)}
                  role="tab"
                  type="button"
                >
                  {media?.mediaAssetId ? (
                    <span className={styles.proposalMedia}>
                      <Image
                        alt={media.altText}
                        fill
                        sizes="(max-width: 759px) 84vw, 190px"
                        src={`/api/workspaces/${artifact.workspaceId}/media/${media.mediaAssetId}`}
                        unoptimized
                      />
                      <b>{artifact.type === 'threads_post' ? 'Threads' : `1 / ${artifact.slides.length}`}</b>
                    </span>
                  ) : null}
                  <span className={styles.proposalChannel}><ChannelIcon aria-hidden="true" />{channelLabel(artifact)}</span>
                  <strong>{artifact.caption}</strong>
                  <p>{artifact.cta}</p>
                  <small>{artifact.hashtags.join(' ')} · 이미지 {artifact.slides.length}장</small>
                </button>
              )
            })}
          </div>
          <p className={styles.proposalSelection}>
            <CheckCircle2 aria-hidden="true" />
            {hasMultipleChannels
              ? '채널별 결과물을 각각 선택해 검토·승인할 수 있어요.'
              : saved
                ? `${channelLabel(saved)} 결과물이 검토 버전에 연결됨 · 다른 제안은 중복 저장되지 않아요`
                : `${channelLabel(selected)} 결과물 선택됨 · 아래에서 최종 검토`}
          </p>
        </>
      ) : null}
      <div
        aria-labelledby={artifacts.length > 1 ? `proposal-tab-${selected.id}` : undefined}
        id={`proposal-panel-${selected.id}`}
        role={artifacts.length > 1 ? 'tabpanel' : undefined}
      >
        <ConversationResultCard
          artifact={selected}
          key={selected.id}
          onRetrySlides={onRetrySlides}
          replyToMessageId={replyToMessageId}
        />
      </div>
    </section>
  )
}
