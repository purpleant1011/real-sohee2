'use client'

import { useState } from 'react'
import { PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { ConversationArtifact, ConversationNaverEditorBlueprintBlock } from './types'
import { dispatchNaverBlockSelect } from './naver-block-select-event'
import { BlogArtifactCopyBar } from './blog-artifact-copy-bar'
import styles from './blog-artifact-preview.module.css'

export type BlogBlockSelection = Readonly<{ index: number; text: string }>

type BlogArtifactPreviewProps = Readonly<{
  artifact: ConversationArtifact
  selectedIndex?: number | null
  onSelectBlock?: (selection: BlogBlockSelection) => void
  selectable?: boolean
}>
type TextBlock = Extract<ConversationNaverEditorBlueprintBlock, { kind: 'paragraph' | 'heading' | 'quote' | 'cta' }>
function isTextBlock(block: ConversationNaverEditorBlueprintBlock): block is TextBlock { return 'text' in block }

/** 저장된 블록이 없을 때도 복사 내용과 같은 도입·섹션·CTA 순서로 보여 준다. */
export function blogBlocks(artifact: ConversationArtifact): readonly ConversationNaverEditorBlueprintBlock[] {
  const blog = artifact.naverBlog
  if (!blog) return []
  if (blog.editorBlueprint?.length) return blog.editorBlueprint
  return [
    { kind: 'paragraph', text: blog.introduction },
    ...blog.sections.flatMap((section) => [
      { kind: 'heading' as const, text: section.heading },
      { kind: 'paragraph' as const, text: section.body },
    ]),
    ...(artifact.cta ? [{ kind: 'cta' as const, text: artifact.cta }] : []),
  ]
}

function ManuscriptPhoto({ workspaceId, mediaId, altText }: { workspaceId: string; mediaId: string; altText: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <p>사진을 불러오지 못했어요. 저장된 원고와 사진을 다시 확인해 주세요.</p>
  return <img className={styles.manuscriptPhoto} width={960} height={720} loading="lazy" alt={altText}
    src={`/api/workspaces/${encodeURIComponent(workspaceId)}/media/${encodeURIComponent(mediaId)}`}
    onError={() => setFailed(true)} />
}

export function BlogArtifactPreview(props: BlogArtifactPreviewProps) {
  const identity = JSON.stringify([props.artifact.workspaceId, props.artifact.id, props.artifact.versionId])
  return <BlogArtifactPreviewSession key={identity} {...props} />
}

function BlogArtifactPreviewSession({ artifact, selectedIndex = null, onSelectBlock, selectable = true }: BlogArtifactPreviewProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  if (artifact.type !== 'naver_blog_post' || !artifact.naverBlog) return null
  const blocks = blogBlocks(artifact)
  const hasEvidence = artifact.evidence.length > 0 || artifact.limitations.length > 0 || artifact.unresolvedQuestions.length > 0
  const canSelect = selectable && Boolean(onSelectBlock) && artifact.status === 'ready_for_review'

  function document() {
    return <>
      <ol aria-label="원고 문단" className={styles.blocks}>
        {blocks.map((block, index) => {
          const selected = selectedIndex === index
          if (isTextBlock(block)) return (
            <li data-selected={selected} data-block-kind={block.kind} key={`${block.kind}-${index}`}>
              {block.kind === 'heading' ? <h3>{block.text}</h3> : block.kind === 'quote' || block.kind === 'cta'
                ? <blockquote>{block.text}</blockquote> : <p>{block.text}</p>}
              {canSelect ? <div className={styles.editActions}>
                <Button variant="outline" aria-label={`${index + 1}번 문단 수정 요청`} aria-pressed={selected}
                  onClick={() => { setReviewOpen(false); onSelectBlock?.({ index, text: block.text }) }} type="button">
                  <PencilLine data-icon="inline-start" aria-hidden="true" />이 문단 수정
                </Button>
                {artifact.contentItemId ? <Button variant="ghost" aria-label={`${index + 1}번 문단 직접 수정`}
                  onClick={() => { setReviewOpen(false); dispatchNaverBlockSelect({ contentId: artifact.contentItemId!, index }) }} type="button">직접 고치기</Button> : null}
              </div> : null}
            </li>
          )
          if (block.kind === 'image_slot') {
            const photo = artifact.slides.find(slide => slide.position === block.position && slide.status === 'succeeded' && slide.mediaAssetId)
            return <li data-block-kind="image" key={`image-${index}`}>
              {photo?.mediaAssetId ? <ManuscriptPhoto key={photo.mediaAssetId} workspaceId={artifact.workspaceId} mediaId={photo.mediaAssetId} altText={block.altText} /> : null}
              <p>사진 {block.position}번 · {block.altText}</p>
            </li>
          }
          if (block.kind === 'link') return <li data-block-kind="link" key={`link-${index}`}><p>{block.title}<br />{block.url}</p></li>
          return <li data-block-kind="map" key={`map-${index}`}><p>{block.placeName}</p></li>
        })}
      </ol>
      {artifact.naverBlog!.keywords.length > 0 || artifact.disclosure ? <div className={styles.manuscriptMeta}>
        {artifact.disclosure ? <p>{artifact.disclosure}</p> : null}
        {artifact.naverBlog!.keywords.length > 0 ? <p>태그: {artifact.naverBlog!.keywords.map(keyword => `#${keyword.replace(/^#+/u, '')}`).join(' ')}</p> : null}
      </div> : null}
      {hasEvidence ? <section aria-label="근거">
        <Button variant="outline" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen(open => !open)} type="button">근거와 확인 필요 {evidenceOpen ? '접기' : '펼치기'}</Button>
        {evidenceOpen ? <div className={styles.evidence}>
          {artifact.evidence.length > 0 ? <><h4>사용한 근거</h4><ul>{artifact.evidence.map(item => <li key={item}>{item}</li>)}</ul></> : null}
          {artifact.limitations.length > 0 ? <><h4>한계</h4><ul>{artifact.limitations.map(item => <li key={item}>{item}</li>)}</ul></> : null}
          {artifact.unresolvedQuestions.length > 0 ? <><h4>확인이 필요한 항목</h4><ul>{artifact.unresolvedQuestions.map(item => <li key={item}>{item}</li>)}</ul></> : null}
        </div> : null}
      </section> : null}
    </>
  }

  return (
    <aside aria-label="네이버 블로그 원고 미리보기" className={styles.preview} data-blog-artifact-preview>
      <header>
        <small>네이버 블로그 원고</small>
        <h2>{artifact.title || '블로그 원고'}</h2>
        <p>{artifact.status === 'ready_for_review' ? '검토 준비됨 · 승인 전에는 게시되지 않아요.' : '아직 검토할 수 있는 상태가 아니에요.'}</p>
      </header>
      <Button className={styles.reviewTrigger} variant="outline" onClick={() => setReviewOpen(true)} type="button">원고 전체 보기</Button>
      {!reviewOpen ? <BlogArtifactCopyBar artifact={artifact} /> : null}
      <div className={styles.desktopDocument} hidden={reviewOpen}>{document()}</div>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen} title="네이버 원고 검토" restoreFocusFallbackSelector="[data-blog-artifact-preview] button">
        <div className={styles.focusedLayout}>
          <p className={styles.focusHint}>{artifact.title || '블로그 원고'} · 실제 네이버 게시 화면과 다를 수 있어요.</p>
          <div className={styles.focusedDocument}>{document()}</div>
          <footer className={styles.focusFooter}><BlogArtifactCopyBar artifact={artifact} /></footer>
        </div>
      </Dialog>
    </aside>
  )
}
