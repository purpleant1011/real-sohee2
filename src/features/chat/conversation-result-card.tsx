'use client'

import { reloadOnceForStaleDeploy } from './reload-once-for-stale-deploy'
import Image from 'next/image'
import { AppLink as Link } from '@/components/navigation/app-link'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { saveArtifactToWork, type SavedArtifactWork } from '@/features/content/actions/save-artifact-to-work'
import { loadConversationPublishingAction, type ConversationPublishingState } from './actions/load-conversation-publishing'
import { ConversationPublishingWorkflow } from './conversation-publishing-workflow'
import { WorkflowErrorBoundary } from './workflow-error-boundary'
import { NAVER_VISIBILITY_LABELS } from '@/features/naver-publish/types'
import type { ConversationArtifact, ConversationArtifactSlide } from './types'
import styles from './channel-result-card.module.css'
import { channelArtifactLabel } from './channel-artifact-label'

const roleLabels: Record<ConversationArtifactSlide['role'], string> = {
  cover: '표지',
  detail: '상세',
  proof: '근거',
  action: '행동 유도',
}

type ConversationResultCardProps = Readonly<{
  artifact: ConversationArtifact
  replyToMessageId: string
  onRetrySlides?: (replyToMessageId: string, artifactId: string, selectedSlideIds: readonly string[]) => void | Promise<void>
}>

function saveAvailability(artifact: ConversationArtifact) {
  if (artifact.status === 'preparing') return '이미지 준비가 끝나면 검토를 계속할 수 있어요.'
  if (artifact.status === 'failed') return '완료된 이미지가 없어 검토를 계속할 수 없어요.'
  if (artifact.status === 'archived') return '보관된 결과물은 검토를 계속할 수 없어요.'
  return null
}

function channelLabel(artifact: ConversationArtifact) {
  return channelArtifactLabel(artifact.type).channel
}

function naverImage(artifact: ConversationArtifact, position: number, altText: string) {
  const slide = artifact.slides.find((candidate) => candidate.position === position)
  if (!slide || slide.status !== 'succeeded' || !slide.mediaAssetId) {
    return <div className={styles.failedSlide} data-naver-block="image" key={`image-${position}`}>
      <p>{position}번 이미지를 준비하지 못했어요.</p>
    </div>
  }
  return <figure data-naver-block="image" key={`image-${position}`}>
    <Image
      alt={altText || slide.altText}
      height={1360}
      src={`/api/workspaces/${artifact.workspaceId}/media/${slide.mediaAssetId}`}
      unoptimized
      width={1088}
    />
    <figcaption>{altText || slide.altText}</figcaption>
  </figure>
}

function renderNaverConversationBlocks(artifact: ConversationArtifact) {
  const blog = artifact.naverBlog
  if (!blog) return null
  if (blog.editorBlueprint && blog.editorBlueprint.length > 0) {
    return blog.editorBlueprint.map((block, index) => {
      const key = `${block.kind}-${index}`
      if (block.kind === 'image_slot') return naverImage(artifact, block.position, block.altText)
      if (block.kind === 'heading') return <h5 data-naver-block="heading" key={key}>{block.text}</h5>
      if (block.kind === 'paragraph') return <p data-naver-block="paragraph" key={key}>{block.text}</p>
      if (block.kind === 'quote') return <blockquote data-naver-block="quote" key={key}>{block.text}</blockquote>
      if (block.kind === 'link') return <a data-naver-block="link" href={block.url} key={key} rel="noreferrer" target="_blank">{block.title}</a>
      if (block.kind === 'map') return <div data-naver-block="map" key={key}>📍 {block.placeName}</div>
      return <p data-naver-block="cta" key={key}>{block.text}</p>
    })
  }

  const slides = [...artifact.slides].sort((left, right) => left.position - right.position)
  const blocks = [
    <p data-naver-block="paragraph" key="introduction">{blog.introduction}</p>,
    ...blog.sections.flatMap((section, index) => [
      slides[index] ? naverImage(artifact, slides[index].position, slides[index].altText) : null,
      <h5 data-naver-block="heading" key={`heading-${index}`}>{section.heading}</h5>,
      <p data-naver-block="paragraph" key={`paragraph-${index}`}>{section.body}</p>,
    ]),
    ...slides.slice(blog.sections.length).map((slide) => naverImage(artifact, slide.position, slide.altText)),
  ]
  return blocks
}

export function ConversationResultCard({ artifact, onRetrySlides, replyToMessageId }: ConversationResultCardProps) {
  const [requestKey] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState<SavedArtifactWork | null>(null)
  const [contentId, setContentId] = useState<string | null>(artifact.contentItemId ?? null)
  const [publishingState, setPublishingState] = useState<ConversationPublishingState | null>(null)
  const [loadingPublishing, setLoadingPublishing] = useState(Boolean(artifact.contentItemId))
  const [message, setMessage] = useState('')
  const [automaticSaveFailed, setAutomaticSaveFailed] = useState(false)
  const [publishingLoadFailed, setPublishingLoadFailed] = useState(false)
  const [pending, startTransition] = useTransition()
  const automaticSaveArtifactId = useRef<string | null>(null)
  const unavailableReason = saveAvailability(artifact)
  const retryableSlides = artifact.slides.filter((slide) => slide.status === 'failed' && slide.retryable)
  const retryBatch = retryableSlides

  useEffect(() => {
    if (artifact.status !== 'ready_for_review' || contentId || automaticSaveArtifactId.current === artifact.id) return
    automaticSaveArtifactId.current = artifact.id
    setMessage('완성된 결과물을 검토 화면에 자동으로 준비하고 있어요.')
    setLoadingPublishing(true)
    startTransition(async () => {
      const result = await saveArtifactToWork({ artifactId: artifact.id, requestKey })
      if (result.error) {
        setLoadingPublishing(false)
        setAutomaticSaveFailed(true)
        automaticSaveArtifactId.current = null
        setMessage(result.error.message)
        return
      }
      setAutomaticSaveFailed(false)
      setSaved(result.data)
      setContentId(result.data.contentItemId)
      setMessage(`v${result.data.versionNumber} 검토 기록을 자동으로 만들었어요. 최종 미리보기를 준비하고 있어요.`)
    })
  }, [artifact.id, artifact.status, contentId, requestKey])

  const requestPublishing = useCallback((nextContentId: string) => {
    let active = true
    void loadConversationPublishingAction({ workspaceId: artifact.workspaceId, contentId: nextContentId })
      .then((result) => {
        if (!active) return
        setLoadingPublishing(false)
        if (result.error) {
          setPublishingLoadFailed(true)
          setMessage(`저장된 결과물은 안전하게 보존했어요. ${result.error.message}`)
          return
        }
        setPublishingState(result.data)
        setMessage('')
      })
      .catch(() => {
        if (!active) return
        if (reloadOnceForStaleDeploy()) return
        setLoadingPublishing(false)
        setPublishingLoadFailed(true)
        setMessage('저장된 결과물은 안전하게 보존했어요. 검토 화면만 다시 불러와 주세요.')
      })
    return () => {
      active = false
    }
  }, [artifact.workspaceId])

  useEffect(() => {
    if (!contentId) return
    const cancel = requestPublishing(contentId)
    return () => {
      cancel()
    }
  }, [contentId, requestPublishing])

  function retryPublishing() {
    if (!contentId) return
    setLoadingPublishing(true)
    setPublishingLoadFailed(false)
    requestPublishing(contentId)
  }

  function save() {
    if (unavailableReason || contentId) return
    setMessage('')
    setLoadingPublishing(true)
    startTransition(async () => {
      const result = await saveArtifactToWork({ artifactId: artifact.id, requestKey })
      if (result.error) {
        setLoadingPublishing(false)
        setAutomaticSaveFailed(true)
        setMessage(result.error.message)
        return
      }
      setAutomaticSaveFailed(false)
      setSaved(result.data)
      setLoadingPublishing(true)
      setContentId(result.data.contentItemId)
      setMessage(`v${result.data.versionNumber} 검토 기록을 만들었어요. 최종 미리보기를 준비하고 있어요.`)
    })
  }

  function retry() {
    if (!onRetrySlides || retryBatch.length === 0) return
    setMessage(`${retryBatch.length}장의 실패 이미지를 이 결과물 안에서 다시 준비하고 있어요.`)
    startTransition(async () => {
      try {
        await onRetrySlides(replyToMessageId, artifact.id, retryBatch.map((slide) => slide.id))
        setMessage('실패했던 이미지 전체를 같은 결과물에 반영했어요.')
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '이미지를 다시 만들지 못했어요. 완료된 이미지는 그대로 보존했습니다.')
      }
    })
  }

  return (
    <article aria-labelledby={`artifact-title-${artifact.id}`} className={styles.resultCard}>
      <header className={styles.resultHeader}>
        <div>
          <p>채널에 올라갈 최종 결과물</p>
          <h3 id={`artifact-title-${artifact.id}`}>{channelLabel(artifact)} 게시물 제안</h3>
        </div>
        <span data-partial={artifact.status === 'partial'}>
          {artifact.status === 'partial' ? '일부 완료' : '검토 준비됨'}
        </span>
      </header>

      {publishingState ? (
        <WorkflowErrorBoundary onRetry={retryPublishing}>
          <ConversationPublishingWorkflow
            initialState={publishingState}
            reviewContext={{
              evidence: artifact.evidence,
              limitations: artifact.limitations,
              unresolvedQuestions: artifact.unresolvedQuestions,
            }}
          />
        </WorkflowErrorBoundary>
      ) : (
        <>
          <section aria-label="게시물 문안" className={styles.resultCopy}>
            {artifact.type === 'naver_blog_post' && artifact.naverBlog ? (
              <>
                <span>{artifact.naverBlog.visibility === 'public' ? '공개 게시' : `${NAVER_VISIBILITY_LABELS[artifact.naverBlog.visibility] ?? '비공개'} 게시`}</span>
                <h4>{artifact.title}</h4>
                {renderNaverConversationBlocks(artifact)}
                <p>{artifact.naverBlog.keywords.map((keyword) => `#${keyword.replace(/^#+/u, '')}`).join(' ')}</p>
              </>
            ) : (
              <>
                <h4>문안</h4>
                <p>{artifact.caption}</p>
                {artifact.hashtags.length > 0 ? <p>{artifact.hashtags.join(' ')}</p> : null}
              </>
            )}
            {artifact.cta ? <><h4>행동 유도</h4><p>{artifact.cta}</p></> : null}
            {artifact.disclosure ? <><h4>공개 문구</h4><p>{artifact.disclosure}</p></> : null}
          </section>

          {artifact.type !== 'naver_blog_post' ? <section aria-label="게시물 이미지" className={styles.resultSlides}>
            <div className={styles.resultSlidesHeading}>
              <div>
                <h4>이미지</h4>
                {retryableSlides.length > 0 ? <p>완료된 이미지는 그대로 두고 실패한 이미지만 같은 글 흐름으로 다시 만듭니다.</p> : null}
              </div>
              {retryBatch.length > 0 && onRetrySlides ? (
                <button disabled={pending} onClick={retry} type="button">
                  {pending ? '이미지 전체 생성 중' : `실패 이미지 ${retryBatch.length}장 한 번에 다시 생성`}
                </button>
              ) : null}
            </div>
            <ol>
              {artifact.slides.map((slide) => (
                <li key={slide.id}>
                  {slide.status === 'succeeded' && slide.mediaAssetId ? (
                    <figure>
                      <Image
                        alt={slide.altText}
                        height={1360}
                        src={`/api/workspaces/${artifact.workspaceId}/media/${slide.mediaAssetId}`}
                        unoptimized
                        width={1088}
                      />
                      <figcaption>{slide.position}번 · {roleLabels[slide.role]} · {slide.altText}</figcaption>
                    </figure>
                  ) : (
                    <div className={styles.failedSlide}>
                      <p>{slide.position}번 이미지를 만들지 못했어요.</p>
                      <small>{slide.status === 'failed' && slide.retryable ? '위 버튼에서 묶어서 다시 생성할 수 있어요.' : '다시 생성할 수 없는 이미지입니다.'}</small>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section> : retryBatch.length > 0 && onRetrySlides ? (
            <section aria-label="실패한 네이버 이미지 복구" className={styles.resultSlides}>
              <p>완료된 이미지는 보존하고 실패한 이미지 전체만 다시 만듭니다.</p>
              <button disabled={pending} onClick={retry} type="button">
                {pending ? '이미지 전체 생성 중' : `실패 이미지 ${retryBatch.length}장 한 번에 다시 생성`}
              </button>
            </section>
          ) : null}

          <div className={styles.resultFacts}>
            <section aria-label="관찰">
              <h4>관찰</h4>
              <ul>{artifact.observations.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section aria-label="해석의 한계">
              <h4>해석의 한계</h4>
              <ul>{artifact.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section aria-label="사용한 근거">
              <h4>사용한 근거</h4>
              <ul>{artifact.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <section aria-label="확인이 필요한 항목">
              <h4>확인이 필요한 항목</h4>
              <ul>{artifact.unresolvedQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          </div>
        </>
      )}

      {!publishingState ? (
        <div aria-live="polite" className={styles.resultStatus} role="status">
          {message || unavailableReason}
        </div>
      ) : null}
      <div className={styles.resultActions}>
        {contentId ? (
          <>
            {publishingLoadFailed ? (
              <button disabled={loadingPublishing} onClick={retryPublishing} type="button">
                {loadingPublishing ? '검토 화면 불러오는 중' : '검토 화면 다시 불러오기'}
              </button>
            ) : null}
            <Link className={styles.detailTextLink} href={saved?.next ?? `/app/work/${contentId}`}>상세 작업 기록 보기</Link>
          </>
        ) : artifact.status === 'ready_for_review' ? (
          automaticSaveFailed ? (
            <button disabled={pending || loadingPublishing} onClick={save} type="button">
              {pending || loadingPublishing ? '검토 화면 준비 중' : '검토 화면 다시 준비'}
            </button>
          ) : <span>{pending || loadingPublishing ? '검토 화면 자동 준비 중' : '검토 화면을 준비하고 있어요.'}</span>
        ) : (
          <button disabled={Boolean(unavailableReason) || pending} onClick={save} type="button">
            {pending || loadingPublishing ? '검토 준비 중' : '선택한 결과물로 검토·승인'}
          </button>
        )}
      </div>
    </article>
  )
}
