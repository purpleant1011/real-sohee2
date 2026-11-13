'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  buildNaverPlainTextContent,
  copyNaverPostWithResult,
  type NaverCopyPart,
  type NaverCopyResult,
  type NaverPostForCopy,
} from '@/features/channel-studio/naver/copy-naver-post'
import { copyNaverPostWithImages } from '@/features/channel-studio/naver/inline-clipboard-images'
import { downloadNaverHandoff } from '@/features/channel-studio/naver/naver-handoff'
import { ManualHandoffPanel } from '@/features/first-value/manual-handoff-panel'
import type { ConversationPublishingState } from './actions/load-conversation-publishing'
import type { ConversationArtifact } from './types'
import styles from './blog-artifact-preview.module.css'

const NAVER_WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver'

/** 검토 가능한 네이버 원고만 복사용 글로 바꾼다. 사진 자리는 복사되지 않으므로 뺀다. */
export function artifactToCopyPost(artifact: ConversationArtifact, includeImages = false): NaverPostForCopy | null {
  const blog = artifact.naverBlog
  if (artifact.type !== 'naver_blog_post' || !blog || artifact.status !== 'ready_for_review') return null
  const slots = (blog.editorBlueprint ?? []).filter(block => block.kind === 'image_slot')
  const available = (position: number) => artifact.slides.find(slide => slide.position === position && slide.status === 'succeeded' && slide.mediaAssetId)
  if (includeImages && (slots.some(block => !available(block.position)) || (artifact.slides.length > 0 && !blog.editorBlueprint?.length))) return null
  const blocks = (blog.editorBlueprint ?? []).flatMap<NonNullable<NaverPostForCopy['editorBlocks']>[number]>((block) => block.kind === 'image_slot'
    ? includeImages ? [{ kind: 'image' as const, mediaId: available(block.position)!.mediaAssetId!, altText: block.altText }] : []
    : [block])
  return {
    title: artifact.title || '블로그 원고', introduction: blog.introduction, sections: blog.sections,
    keywords: blog.keywords, cta: artifact.cta || undefined, disclosure: artifact.disclosure || undefined,
    editorBlocks: blocks.length > 0 ? blocks : undefined,
    ...(includeImages ? { media: slots.map(block => ({ id: available(block.position)!.mediaAssetId!, src: `/api/workspaces/${artifact.workspaceId}/media/${available(block.position)!.mediaAssetId!}` })) } : {}),
  }
}

export function countImageSlots(artifact: ConversationArtifact): number {
  return (artifact.naverBlog?.editorBlueprint ?? []).filter((block) => block.kind === 'image_slot').length
}

const failed = new Set<NaverCopyResult>(['failed', 'permission_denied', 'clipboard_unavailable'])
const partLabels: Record<NaverCopyPart, string> = { all: '전체', title: '제목', body: '본문', tags: '태그' }
const partObjects: Record<NaverCopyPart, string> = { all: '글 전체를', title: '제목을', body: '본문을', tags: '태그를' }

function resultMessage(result: NaverCopyResult, part: NaverCopyPart, images: number): string {
  if (result === 'permission_denied') return '브라우저가 클립보드 접근을 막았어요. 브라우저 설정에서 클립보드 권한을 허용해 주세요.'
  if (result === 'clipboard_unavailable') return '이 브라우저에서는 복사 기능을 쓸 수 없어요.'
  if (result === 'failed') return '복사하지 못했어요. 잠시 후 다시 시도해 주세요.'
  const how = result === 'html' ? '글과 서식을 복사했어요.' : result === 'html_unsupported'
    ? 'HTML 서식 복사를 지원하지 않는 브라우저여서 텍스트만 복사했어요.' : `${partObjects[part]} 텍스트로 복사했어요.`
  const photo = part === 'all' || part === 'body' ? images > 0 ? ` 사진 ${images}장은 복사되지 않아요. 네이버에서 직접 올려 주세요.` : ' 사진은 복사되지 않아요.' : ''
  return `${how}${photo} 복사만으로는 게시되지 않아요. 게시 완료가 아니에요.`
}

export function BlogArtifactCopyBar({ artifact }: Readonly<{ artifact: ConversationArtifact }>) {
  const identity = JSON.stringify([artifact.workspaceId, artifact.id, artifact.contentItemId, artifact.versionId, artifact.status])
  return <CopyBarSession key={identity} artifact={artifact} />
}

function CopyBarSession({ artifact }: Readonly<{ artifact: ConversationArtifact }>) {
  const [copying, setCopying] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [zip, setZip] = useState<'idle' | 'busy' | 'done' | { error: string }>('idle')
  const [outcome, setOutcome] = useState<{ result: NaverCopyResult; part: NaverCopyPart; imagesIncluded?: boolean } | null>(null)
  const manualField = useRef<HTMLTextAreaElement>(null)
  const manualId = useId()
  const active = useRef(true)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; request.current?.abort() }
  }, [])
  const imagePost = artifactToCopyPost(artifact, true)
  const post = artifactToCopyPost(artifact)
  if (!post) return null
  const images = countImageSlots(artifact)
  const contentId = artifact.contentItemId

  async function copy(part: NaverCopyPart, format: 'text' | 'html' | 'images' = 'text') {
    if (copying || !post) return
    setCopying(true)
    setOutcome(null)
    try {
      if (format === 'images' && !imagePost) { setOutcome({ result: 'failed', part }); return }
      const result = format === 'images' ? await copyNaverPostWithImages(imagePost!, part) : await copyNaverPostWithResult(post, part, format)
      if (active.current) setOutcome({ result, part, imagesIncluded: format === 'images' && result === 'html' })
    } catch {
      if (active.current) setOutcome({ result: 'failed', part })
    } finally {
      if (active.current) setCopying(false)
    }
  }

  async function downloadZip() {
    if (zip === 'busy' || !contentId) return
    if (!artifact.versionId) { setZip({ error: '원고의 저장 버전을 확인하지 못했어요. 원고를 다시 열어 주세요.' }); return }
    setZip('busy')
    const controller = new AbortController()
    request.current = controller
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(artifact.workspaceId)}/naver-posts/${encodeURIComponent(contentId)}`, {
        cache: 'no-store', signal: controller.signal,
      })
      const json = response.ok ? await response.json() as { data?: ConversationPublishingState } : null
      if (!active.current) return
      const state = json?.data
      if (!state?.preview.naverCopy) { setZip({ error: '저장된 원고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }); return }
      const preview = state.preview
      if (preview.workspaceId !== artifact.workspaceId || preview.contentId !== contentId || preview.versionId !== artifact.versionId
        || preview.channel !== 'naver_blog' || !/^[a-f0-9]{64}$/i.test(preview.fingerprint ?? '')) {
        setZip({ error: '저장된 원고가 이 화면의 원고와 달라요. 최신 원고를 다시 열어 확인해 주세요.' }); return
      }
      if (state.receipt || preview.approval.status !== 'unreviewed') {
        setZip({ error: '이미 승인되었거나 게시 절차가 진행 중인 원고예요. 중복 게시를 피하려면 게시 상태부터 확인해 주세요.' }); return
      }
      await downloadNaverHandoff(artifact.workspaceId, {
        ...state.preview.naverCopy!,
        sourceVersion: { workspaceId: preview.workspaceId, contentId: preview.contentId, versionId: preview.versionId, fingerprint: preview.fingerprint },
        editorBlocks: preview.naverBlocks, media: preview.media, disclosure: preview.disclosure,
      })
      if (active.current) setZip('done')
    } catch {
      if (active.current) setZip({ error: '파일을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.' })
    }
  }

  return (
    <section aria-label="네이버에 붙여넣기" className={styles.copyBar}>
      <Button className={styles.copyPrimary} disabled={copying || !imagePost} onClick={() => void copy('body', 'images')} type="button"><ClipboardCopy data-icon="inline-start" aria-hidden="true" />본문·사진 복사</Button>
      <Button variant="outline" disabled={copying} onClick={() => void copy('all')} type="button">
        <ClipboardCopy data-icon="inline-start" aria-hidden="true" />{copying ? '복사 중…' : '전체 복사'}
      </Button>
      <p className={styles.copyHint}>제목은 네이버 제목 칸에, 본문·사진은 본문 칸에 붙여넣으세요. 태그는 따로 복사할 수 있어요. 네이버가 이미지 붙여넣기를 제한하면 사진을 직접 올려 주세요.</p>
      <details className={styles.copyOptions}>
        <summary>부분 복사·사진 받기</summary>
        <div className={styles.copyParts}>
          {(['title', 'body', 'tags'] as const).map((part) => (
            <Button variant="outline" disabled={copying} key={part} onClick={() => void copy(part)} type="button">{partLabels[part]} 복사</Button>
          ))}
          <Button variant="outline" disabled={copying} onClick={() => void copy('all', 'html')} type="button">서식 포함 복사</Button>
          {contentId ? <Button variant="outline" disabled={zip === 'busy'} onClick={() => void downloadZip()} type="button">{zip === 'busy' ? '파일 준비 중…' : '사진·원고 ZIP 받기'}</Button> : null}
        </div>
        <p className={styles.copyHint}>ZIP은 이 화면과 같은 저장 버전인지 다시 확인해요. 수정된 원고나 게시 진행 상태가 감지되면 내려받지 않아요.</p>
      </details>
      <Button variant="link" asChild><a href={NAVER_WRITE_URL} rel="noreferrer" target="_blank">네이버 글쓰기 열기</a></Button>
      {zip === 'done' ? <p role="status">사진 한꺼번에 저장을 요청했어요. 브라우저의 다운로드 목록을 확인해 주세요. 게시 완료가 아니에요.</p> : null}
      {typeof zip === 'object' ? <Alert variant="destructive"><AlertDescription>{zip.error}</AlertDescription></Alert> : null}
      {outcome ? (
        <Alert role={failed.has(outcome.result) ? 'alert' : 'status'} variant={failed.has(outcome.result) ? 'destructive' : 'default'}>
          <AlertDescription>{outcome.imagesIncluded ? `본문 서식과 사진 ${images}장을 클립보드에 담았어요. 네이버 편집기에 붙여넣은 뒤 사진·소제목·순서를 확인해 주세요. 복사만으로 게시되지는 않아요.` : resultMessage(outcome.result, outcome.part, images)}</AlertDescription>
        </Alert>
      ) : null}
      {outcome && failed.has(outcome.result) ? <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${manualId}-text`}>직접 선택할 원고</Label>
        <Textarea id={`${manualId}-text`} ref={manualField} readOnly rows={6}
          aria-describedby={`${manualId}-help`} value={buildNaverPlainTextContent(post, outcome.part)} />
        <p id={`${manualId}-help`} className={styles.copyHint}>{partLabels[outcome.part]} 텍스트를 직접 선택한 뒤 기기의 복사 명령을 사용해 주세요. 텍스트 선택만으로 복사하거나 게시한 것은 아니에요.</p>
        <Button variant="outline" type="button" onClick={() => { manualField.current?.focus(); manualField.current?.select() }}>텍스트 전체 선택</Button>
      </div> : null}
      {contentId && artifact.versionId ? (
        reporting
          ? <ManualHandoffPanel workspaceId={artifact.workspaceId} contentId={contentId} versionId={artifact.versionId} channel="naver_blog" allowVaultSave />
          : <Button variant="ghost" onClick={() => setReporting(true)} type="button">네이버에 올렸어요</Button>
      ) : null}
    </section>
  )
}
