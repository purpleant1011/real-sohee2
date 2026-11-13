'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentDetail, ContentMediaAsset } from './types'
import { NAVER_VISIBILITY_LABELS, type NaverVisibility } from '@/features/naver-publish/types'
import { createVersionAction } from './actions/create-version'
import { generateContentImageAction } from './actions/generate-content-image'
import { reviseContentAction } from './actions/revise-content'
import { uploadContentMediaAction } from './actions/upload-content-media'
import styles from './content.module.css'

function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`
  return `${Math.round(size / 1024)} KB`
}

function mimeLabel(mime: string) {
  return mime.replace('image/', '').toUpperCase()
}

export function ContentEditor({
  detail,
  media,
  workspaceId,
}: Readonly<{
  detail: ContentDetail
  media: readonly ContentMediaAsset[]
  workspaceId: string
}>) {
  const router = useRouter()
  const current = detail.versions.find((version) => version.id === detail.currentVersionId)
  const currentNaverPayload = current?.structuredPayload?.channel === 'naver_blog'
    ? current.structuredPayload
    : null
  const [caption, setCaption] = useState(current?.caption ?? '')
  const [hashtags, setHashtags] = useState(current?.hashtags.join(' ') ?? '')
  const [disclosure, setDisclosure] = useState(current?.disclosure ?? '')
  const [revisionReason, setRevisionReason] = useState('')
  const [instruction, setInstruction] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<readonly string[]>(() =>
    detail.channel === 'naver_blog'
      ? [...(current?.media ?? [])].sort((left, right) => left.position - right.position).map((item) => item.id)
      : [],
  )
  const [naverVisibility, setNaverVisibility] = useState<NaverVisibility>(
    currentNaverPayload?.visibility ?? 'public',
  )
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [evidenceConfirmed, setEvidenceConfirmed] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadRights, setUploadRights] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const aiAvailable =
    Boolean(current)
    && (detail.channel === 'instagram' || detail.channel === 'threads' || detail.channel === 'naver_blog')
  const parsedHashtags = useMemo(
    () => hashtags.split(/\s+/u).filter(Boolean),
    [hashtags],
  )

  function toggleMedia(id: string, checked: boolean) {
    setSelectedMedia((currentIds) =>
      checked ? [...currentIds, id] : currentIds.filter((currentId) => currentId !== id),
    )
  }

  function runAIRevision() {
    if (!current || !aiAvailable) return
    setMessage('')
    startTransition(async () => {
      const result = await reviseContentAction({
        workspaceId,
        contentId: detail.id,
        versionId: current.id,
        channel: detail.channel,
        instruction,
        inputType: 'full',
        currentVersionFingerprint: current.fingerprint,
        currentCaption: caption,
        currentHashtags: parsedHashtags,
        currentDisclosure: disclosure,
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setCaption(result.data.caption)
      setHashtags(result.data.hashtags.join(' '))
      setDisclosure(result.data.disclosure)
      setRevisionReason(result.data.revisionReason)
      setMessage('소희 AI 수정 결과를 입력했습니다. 검토 후 새 버전으로 저장해 주세요.')
    })
  }

  function generateImage() {
    if (!current || !aiAvailable) return
    setMessage('')
    startTransition(async () => {
      const result = await generateContentImageAction({
        workspaceId,
        contentId: detail.id,
        versionId: current.id,
        currentVersionFingerprint: current.fingerprint,
        prompt: imagePrompt,
        channel: detail.channel,
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setImagePrompt('')
      setMessage('소희 이미지를 안전하게 준비했습니다. 새로 표시된 미디어 목록에서 선택해 주세요.')
      router.refresh()
    })
  }

  function uploadMedia() {
    if (!uploadFile || !uploadRights) return
    setMessage('')
    startTransition(async () => {
      const data = new FormData()
      data.set('workspaceId', workspaceId)
      data.set('file', uploadFile)
      data.set('rightsAcknowledged', 'true')
      const result = await uploadContentMediaAction(data)
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setUploadFile(null)
      setUploadRights(false)
      setMessage('미디어 검증과 사용권 확인을 완료했습니다. 목록에서 선택해 주세요.')
      router.refresh()
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    startTransition(async () => {
      const result = await createVersionAction({
        workspaceId,
        contentId: detail.id,
        channel: detail.channel,
        caption,
        hashtags: parsedHashtags,
        disclosure,
        revisionReason,
        rightsConfirmed,
        generationEvidenceConfirmed: evidenceConfirmed,
        mediaIds: selectedMedia,
        structuredPayload: currentNaverPayload
          ? { ...currentNaverPayload, visibility: naverVisibility }
          : undefined,
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      router.push(`/app/work/${detail.id}`)
      router.refresh()
    })
  }

  return (
    <form className={styles.editor} onSubmit={submit}>
      <header>
        <p className={styles.eyebrow}>글 확인하기</p>
        <h1>{current ? `현재 v${current.versionNumber}에서 새 버전 만들기` : '첫 버전 만들기'}</h1>
        <p className={styles.pageIntro}>저장하면 기존 내용은 그대로 남고 다음 번호의 새 버전이 생성됩니다.</p>
      </header>

      <section className={`${styles.editorSection} ${styles.mockPanel}`}>
        <div className={styles.versionHeading}>
          <h2>소희 AI 생성</h2>
          <span className={styles.mockBadge}>자동 승인·게시 없음</span>
        </div>
        <p className={styles.muted}>AI 결과는 검토 후 새 버전으로 저장됩니다.</p>
        <label className={styles.field}>
          수정 지시
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="예: 더 따뜻하고 간결한 말투로 다듬어 줘."
            maxLength={2000}
          />
        </label>
        <div className={styles.formActions}>
          <button
            className={styles.mockButton}
            type="button"
            onClick={runAIRevision}
            disabled={pending || !aiAvailable || instruction.trim().length === 0}
          >
            소희 AI 수정
          </button>
        </div>
        <label className={styles.field}>
          이미지 생성 지시
          <textarea
            value={imagePrompt}
            onChange={(event) => setImagePrompt(event.target.value)}
            placeholder="예: 따뜻한 가을 캠페인의 정사각형 이미지. 글자는 넣지 말아 줘."
            maxLength={1500}
          />
        </label>
        <div className={styles.formActions}>
          <button
            className={styles.mockButton}
            type="button"
            onClick={generateImage}
            disabled={pending || !aiAvailable || imagePrompt.trim().length === 0}
          >
            소희 이미지 생성
          </button>
        </div>
        {!aiAvailable ? <p className={styles.muted}>첫 버전을 저장한 뒤 인스타그램·스레드 콘텐츠에서 사용할 수 있습니다.</p> : null}
      </section>

      {currentNaverPayload ? <section className={styles.editorSection}>
        <h2>네이버 게시 상태</h2>
        <p className={styles.pageIntro}>선택한 공개 범위가 이 새 버전에 저장되고, 승인 후 네이버 게시 설정에 그대로 적용됩니다.</p>
        <div className={styles.checkboxList} role="radiogroup" aria-label="네이버 게시 상태">
          <label className={styles.checkboxCard}>
            <input
              type="radio"
              name="naver-visibility"
              value="public"
              checked={naverVisibility === 'public'}
              onChange={() => setNaverVisibility('public')}
            />
            <span><strong>공개</strong> · 네이버 블로그 방문자가 게시물을 볼 수 있습니다.</span>
          </label>
          {(['neighbor', 'mutual_neighbor'] as const).map((visibility) => <label className={styles.checkboxCard} key={visibility}>
            <input
              type="radio"
              name="naver-visibility"
              value={visibility}
              checked={naverVisibility === visibility}
              onChange={() => setNaverVisibility(visibility)}
            />
            <span><strong>{NAVER_VISIBILITY_LABELS[visibility]}</strong> · 네이버에서 해당 이웃만 게시물을 볼 수 있습니다.</span>
          </label>)}
          <label className={styles.checkboxCard}>
            <input
              type="radio"
              name="naver-visibility"
              value="private"
              checked={naverVisibility === 'private'}
              onChange={() => setNaverVisibility('private')}
            />
            <span><strong>비공개</strong> · 네이버 계정 소유자만 게시물을 볼 수 있습니다.</span>
          </label>
        </div>
      </section> : null}

      <section className={styles.editorSection}>
        <h2>콘텐츠 내용</h2>
        <label className={styles.field}>
          본문 문구
          <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} required />
        </label>
        <label className={styles.field}>
          해시태그
          <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} placeholder="#소희 #캠페인" />
        </label>
        <label className={styles.field}>
          필수 고지
          <textarea value={disclosure} onChange={(event) => setDisclosure(event.target.value)} maxLength={500} />
        </label>
        <label className={styles.field}>
          수정 이유
          <input value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} maxLength={500} required />
        </label>
      </section>

      <section className={styles.editorSection}>
        <h2>사용할 미디어</h2>
        <div className={styles.mockPanel}>
          <h3>새 미디어 업로드</h3>
          <label className={styles.field}>
            새 미디어 파일
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={uploadRights}
              onChange={(event) => setUploadRights(event.target.checked)}
            />
            <span>이 파일을 사용할 권리가 있음을 확인합니다.</span>
          </label>
          <div className={styles.formActions}>
            <button
              className={styles.mockButton}
              type="button"
              disabled={pending || !uploadFile || !uploadRights}
              onClick={uploadMedia}
            >
              검증하고 업로드
            </button>
          </div>
        </div>
        {media.length === 0 ? (
          <p className={styles.muted}>권리 확인이 끝난 콘텐츠 미디어가 없습니다. 파일 업로드와 권리 확인을 먼저 완료해 주세요.</p>
        ) : (
          <ul className={styles.checkboxList}>
            {media.map((asset, index) => (
              <li key={asset.id}>
                <label className={styles.checkboxCard}>
                  <input
                    type="checkbox"
                    checked={selectedMedia.includes(asset.id)}
                    onChange={(event) => toggleMedia(asset.id, event.target.checked)}
                  />
                  <span>{mimeLabel(asset.mimeType)} · {sizeLabel(asset.sizeBytes)} · 미디어 {index + 1}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.editorSection}>
        <h2>저장 전 확인</h2>
        <label className={`${styles.confirmation} flex min-h-11 items-center gap-3 cursor-pointer select-none py-2 text-sm`}>
          <input type="checkbox" className="size-5 shrink-0 rounded border border-border accent-primary cursor-pointer" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
          <span>미디어 사용권을 확인했습니다.</span>
        </label>
        <label className={`${styles.confirmation} flex min-h-11 items-center gap-3 cursor-pointer select-none py-2 text-sm`}>
          <input type="checkbox" className="size-5 shrink-0 rounded border border-border accent-primary cursor-pointer" checked={evidenceConfirmed} onChange={(event) => setEvidenceConfirmed(event.target.checked)} />
          <span>생성 과정과 내용을 확인했습니다.</span>
        </label>
      </section>

      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
      <div className={styles.formActions}>
        <button className={styles.formButton} type="submit" disabled={pending}>
          {pending ? '저장하는 중…' : '새 버전으로 저장'}
        </button>
      </div>
    </form>
  )
}
