'use client'

import { Paperclip, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import styles from './conversation-shell.module.css'
import { convertHeicPhoto, isHeicPhoto } from '@/features/media/heic-conversion'

export type ComposerSubmit = Readonly<{
  message: string
  displayMessage?: string
  attachmentIds: readonly string[]
  clientMessageId: string
}>

export type ConversationMediaUpload = (
  source: FormData,
) => Promise<Readonly<{
  data: Readonly<{ assetId: string; rightsStatus: 'confirmed' }>
  error?: never
} | {
  data?: never
  error: Readonly<{ message: string; requestId: string }>
}>>

async function uploadConversationMedia(
  workspaceId: string,
  formData: FormData,
): ReturnType<ConversationMediaUpload> {
  const response = await fetch(`/api/workspaces/${workspaceId}/media`, {
    method: 'POST',
    body: formData,
  })
  const payload = await response.json() as Awaited<ReturnType<ConversationMediaUpload>>
  if (!response.ok && !payload.error) {
    return { error: { message: '이미지를 첨부하지 못했습니다.', requestId: 'conversation-media-upload' } }
  }
  return payload
}

type ConversationComposerProps = Readonly<{
  clearAttachmentToken?: number
  disabled?: boolean
  onAttachmentIdsChange?: (attachmentIds: readonly string[]) => void
  onSubmit: (submission: ComposerSubmit) => void | boolean | Promise<void | boolean>
  /** 바깥(원고 미리보기)에서 입력창을 채울 때 쓴다. id 가 바뀔 때만 적용되어 사용자가 쓰던 글을 덮어쓰지 않는다. */
  draftRequest?: Readonly<{ id: number | string; text: string; preserveExisting?: boolean }> | null
  onDraftApplied?: (id: number | string) => void
  workspaceId?: string
  uploadMedia?: ConversationMediaUpload
  /** 빠른 선택 칩 요약 배지 */
  selectionBadges?: readonly Readonly<{ id: string; label: string; onRemove: () => void }>[]
  /** 칩 선택으로 완성된 전송용 프롬프트 */
  readyPrompt?: string
  /** 칩 선택으로 전송 준비가 완료되었는지 여부 */
  isReady?: boolean
  /** 전송 완료 후 칩 선택 초기화 콜백 */
  onClearSelection?: () => void
}>

export function ConversationComposer({
  clearAttachmentToken,
  disabled = false,
  onAttachmentIdsChange,
  onSubmit,
  draftRequest = null,
  onDraftApplied,
  workspaceId,
  uploadMedia,
  selectionBadges,
  readyPrompt,
  isReady,
  onClearSelection,
}: ConversationComposerProps) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false)
  const [attachmentPanelOpen, setAttachmentPanelOpen] = useState(false)
  const [attachments, setAttachments] = useState<readonly Readonly<{ id: string; name: string }>[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [uploading, setUploading] = useState(false)
  const conversion = useRef<AbortController | null>(null)
  const previousWorkspace = useRef(workspaceId)
  useEffect(() => {
    if (previousWorkspace.current !== workspaceId) {
      previousWorkspace.current = workspaceId
      queueMicrotask(() => setUploading(false))
    }
    return () => { conversion.current?.abort() }
  }, [workspaceId])
  const fileInput = useRef<HTMLInputElement>(null)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const trimmedMessage = message.trim()
  const messageTooLong = message.length > 8_000
  const hasReadySelection = Boolean(isReady) && Boolean(readyPrompt)
  const canSubmit = !disabled && !submitting && !uploading && ((trimmedMessage.length > 0 && !messageTooLong) || hasReadySelection)

  const pendingRequest = useRef<{ fingerprint: string; id: string } | null>(null)
  const lastDraftId = useRef<number | string | null>(null)
  useEffect(() => {
    if (!draftRequest || lastDraftId.current === draftRequest.id) return
    lastDraftId.current = draftRequest.id
    setMessage(current => draftRequest.preserveExisting && current.trim()
      ? `${current}\n${draftRequest.text}` : draftRequest.text)
    textArea.current?.focus()
    onDraftApplied?.(draftRequest.id)
  }, [draftRequest, onDraftApplied])

  useEffect(() => {
    if (clearAttachmentToken === undefined) return
    conversion.current?.abort()
    queueMicrotask(() => {
      setUploading(false)
      setAttachments([])
      setAttachmentError('')
      setRightsAcknowledged(false)
      onAttachmentIdsChange?.([])
      if (fileInput.current) fileInput.current.value = ''
    })
  }, [clearAttachmentToken, onAttachmentIdsChange])

  function resetAfterSubmit() {
    pendingRequest.current = null
    setMessage('')
    setAttachments([])
    setAttachmentError('')
    setRightsAcknowledged(false)
    setAttachmentPanelOpen(false)
    onAttachmentIdsChange?.([])
    if (fileInput.current) fileInput.current.value = ''
    onClearSelection?.()
  }

  function submitCurrentMessage() {
    if (!canSubmit) return

    const finalMessage = trimmedMessage.length > 0 ? trimmedMessage : (readyPrompt ?? '')
    if (!finalMessage) return

    const attachmentIds = attachments.map(attachment => attachment.id)
    const fingerprint = JSON.stringify([finalMessage, attachmentIds])
    if (pendingRequest.current?.fingerprint !== fingerprint) pendingRequest.current = { fingerprint, id: crypto.randomUUID() }
    const result = onSubmit({ message: finalMessage, attachmentIds, clientMessageId: pendingRequest.current.id })
    if (result instanceof Promise) {
      setSubmitting(true)
      void result.then((accepted) => {
        if (accepted !== false) resetAfterSubmit()
      }).catch(() => undefined).finally(() => setSubmitting(false))
    } else if (result !== false) {
      resetAfterSubmit()
    }
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    if (!workspaceId || files.length === 0) return
    const uploader: ConversationMediaUpload = uploadMedia
      ?? ((formData) => uploadConversationMedia(workspaceId, formData))
    if (!rightsAcknowledged) {
      setAttachmentError('이미지 사용 권리를 먼저 확인해 주세요.')
      event.target.value = ''
      return
    }
    if (files.length + attachments.length > 20 || files.some((file) => !file.type.startsWith('image/') && !isHeicPhoto(file))) {
      setAttachmentError('이미지는 한 번에 최대 20장까지 첨부할 수 있어요.')
      event.target.value = ''
      return
    }

    conversion.current?.abort()
    const abort = new AbortController()
    conversion.current = abort
    setUploading(true)
    setAttachmentError('')
    let nextAttachments = [...attachments]
    try {
      for (const file of files) {
        let prepared = file
        if (isHeicPhoto(file)) {
          try { prepared = await convertHeicPhoto(file, { signal: abort.signal }) }
          catch { throw new Error('HEIC 사진을 변환하지 못했어요. 10MB·24MP 이하 사진이나 JPG 또는 PNG로 다시 선택해 주세요.') }
        }
        if (abort.signal.aborted) return
        const formData = new FormData()
        formData.set('workspaceId', workspaceId)
        formData.set('file', prepared)
        formData.set('rightsAcknowledged', 'true')
        const result = await uploader(formData)
        if (abort.signal.aborted) return
        if (result.error) throw new Error(result.error.message)
        nextAttachments = [...nextAttachments, { id: result.data.assetId, name: isHeicPhoto(file) ? `${prepared.name} (HEIC에서 변환)` : file.name }]
        setAttachments(nextAttachments)
        onAttachmentIdsChange?.(nextAttachments.map((attachment) => attachment.id))
      }
    } catch (error) {
      if (!abort.signal.aborted) setAttachmentError(error instanceof Error ? error.message : '이미지를 첨부하지 못했습니다.')
    } finally {
      if (!abort.signal.aborted) {
        setUploading(false)
        event.target.value = ''
      }
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitCurrentMessage()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    submitCurrentMessage()
  }

  return (
    <form className={styles.composer} onSubmit={submitForm}>
      {selectionBadges && selectionBadges.length > 0 ? (
        <div className="col-span-full flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-border/80 bg-muted/30" aria-label="선택된 요청 요약">
          <span className="text-xs font-medium text-muted-foreground mr-0.5">선택 항목:</span>
          {selectionBadges.map((badge) => (
            <Badge
              key={badge.id}
              variant="secondary"
              className="gap-1 pl-2.5 pr-1 py-0.5 text-xs font-medium border border-primary/20 bg-primary/10 text-primary rounded-full transition-all"
            >
              <span>{badge.label}</span>
              <button
                type="button"
                aria-label={`${badge.label} 선택 해제`}
                onClick={badge.onRemove}
                className="m-press size-4 inline-flex items-center justify-center rounded-full hover:bg-primary/20 active:scale-[0.9] text-primary"
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <div className={styles.attachmentControls}>
        <button
          aria-label="이미지 첨부 열기"
          className={`${styles.attachButton} m-press min-h-11 min-w-11 size-11 active:scale-[0.98] transition-transform`}
          disabled={disabled || uploading || !workspaceId}
          aria-expanded={attachmentPanelOpen}
          onClick={() => setAttachmentPanelOpen(open => !open)}
          type="button"
        >
          <Paperclip aria-hidden="true" strokeWidth={1.8} />
        </button>
        <input
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
          aria-label="이미지 첨부"
          className={styles.srOnly}
          disabled={disabled || uploading || !workspaceId}
          multiple
          onChange={uploadFiles}
          ref={fileInput}
          type="file"
        />
      </div>
      <label className={styles.composerField}>
        <span className={styles.srOnly}>소희에게 메시지 보내기</span>
        <textarea
          ref={textArea}
          aria-label="소희에게 메시지 보내기"
          disabled={disabled || submitting}
          maxLength={8_000}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="소희에게 이야기하기"
          rows={1}
          value={message}
        />
      </label>
      <button aria-label="메시지 보내기" className={`${styles.sendButton} m-press min-h-11 min-w-11 size-11 active:scale-[0.98] transition-transform`} disabled={!canSubmit} type="submit">
        <Send aria-hidden="true" strokeWidth={1.8} />
      </button>
      {messageTooLong ? <strong className={styles.attachmentStatus} role="alert">입력은 보존했어요. 8,000자 이내로 줄인 뒤 보내 주세요.</strong> : null}
      {workspaceId && (attachmentPanelOpen || attachments.length > 0 || uploading || attachmentError) ? (
        <div className={styles.attachmentStatus} aria-label="이미지 첨부 설정">
          <label>
            <input
              checked={rightsAcknowledged}
              disabled={disabled || uploading}
              onChange={(event) => setRightsAcknowledged(event.target.checked)}
              type="checkbox"
            />
            첨부 이미지 사용 권리를 확인했습니다
          </label>
          <button type="button" className={styles.attachmentPicker} disabled={disabled || uploading || !rightsAcknowledged}
            onClick={() => fileInput.current?.click()}>이미지 선택</button>
          <span>HEIC는 이 기기에서 JPG로 변환해 첨부해요. 최대 10MB·24MP예요.</span>
          {uploading ? <span>이미지 변환·업로드 중</span> : null}
          {attachments.some(attachment => attachment.name.endsWith('(HEIC에서 변환)')) ? <span>HEIC 원본 대신 변환한 JPG를 첨부했어요.</span> : null}
          {attachments.length > 0 ? (
            <span>{attachments.length}장 첨부됨</span>
          ) : null}
          {attachmentError ? <strong role="alert">{attachmentError}</strong> : null}
        </div>
      ) : null}
    </form>
  )
}
