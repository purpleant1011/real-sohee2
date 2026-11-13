'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { patchVaultItem, VaultPatchError } from './api'
import { DeleteRestoreControl } from './delete-restore-control'
import { HoldToggle } from './hold-toggle'
import { ReapproveButton } from './reapprove-button'
import {
  CHANNEL_DISPLAY_NAMES,
  type VaultEditResult,
  type VaultItemEditorProps,
} from './types'

function parseHashtags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter((tag) => tag.length > 0)
}

function formatHashtags(tags: string[] = []): string {
  return tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')
}

export function VaultItemEditor({
  workspaceId,
  itemRef,
  version,
  channel,
  channelLabel,
  initialTitle = '',
  initialText = '',
  initialHashtags = [],
  initialTargetDate = null,
  initialApprovalState = 'APPROVED',
  initialReleaseGate = null,
  initialDeletedAt = null,
  otherChannels = [],
  onSuccess,
  onError,
  fetchFn,
  className,
}: VaultItemEditorProps) {
  // 폼 입력 상태
  const [title, setTitle] = React.useState(initialTitle)
  const [text, setText] = React.useState(initialText)
  const [hashtagsInput, setHashtagsInput] = React.useState(() =>
    formatHashtags(initialHashtags),
  )
  const [targetDate, setTargetDate] = React.useState(initialTargetDate ?? '')

  // 기준값 (저장 후 동기화)
  const [baselineTitle, setBaselineTitle] = React.useState(initialTitle)
  const [baselineText, setBaselineText] = React.useState(initialText)
  const [baselineHashtagsInput, setBaselineHashtagsInput] = React.useState(() =>
    formatHashtags(initialHashtags),
  )
  const [baselineTargetDate, setBaselineTargetDate] = React.useState(
    initialTargetDate ?? '',
  )

  // 엔티티 라이프사이클 상태
  const [approvalState, setApprovalState] = React.useState(initialApprovalState)
  const [releaseGate, setReleaseGate] = React.useState(initialReleaseGate)
  const [isDeleted, setIsDeleted] = React.useState(!!initialDeletedAt)
  const [currentVersion, setCurrentVersion] = React.useState(version)
  const [hasConflict, setHasConflict] = React.useState(false)
  const [confirmReload, setConfirmReload] = React.useState(false)
  const [isReloading, setIsReloading] = React.useState(false)

  // 상호작용 피드백 상태
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  // 변경 감지
  const isTitleDirty = title !== baselineTitle
  const isTextDirty = text !== baselineText
  const isHashtagsDirty = hashtagsInput !== baselineHashtagsInput
  const isContentDirty = isTitleDirty || isTextDirty || isHashtagsDirty
  const isDateDirty = targetDate !== baselineTargetDate
  const isDirty = isContentDirty || isDateDirty

  // 채널 표시 레이블
  const currentChannelName = channelLabel || CHANNEL_DISPLAY_NAMES[channel] || '현재 채널'

  // 승인이 풀린 상태 여부: 사용자가 내용을 편집 중이거나 이미 서버에서 승인이 풀린 경우
  const isApprovalInvalidated =
    isContentDirty ||
    approvalState === 'INVALIDATED' ||
    approvalState === 'NEEDS_REAPPROVAL'

  // 다른 채널 표시 정보
  const otherActiveChannels = otherChannels.filter((c) => c.channel !== channel)
  const otherChannelsText =
    otherActiveChannels.length > 0
      ? otherActiveChannels.map((c) => c.channelLabel).join(', ')
      : null

  // 현재 상태 배지 텍스트 및 스타일
  const getStatusBadge = () => {
    if (isDeleted) {
      return { label: '삭제됨 · 30일 안에 복구 가능', variant: 'destructive' as const }
    }
    if (releaseGate === 'HELD_USER') {
      return { label: '사용자 보류', variant: 'warning' as const }
    }
    if (isApprovalInvalidated) {
      return { label: '재승인 필요', variant: 'warning' as const }
    }
    return { label: '발행 준비 완료 · 외부 게시 전', variant: 'success' as const }
  }

  const statusBadge = getStatusBadge()

  const handleError = (error: unknown) => {
    setStatusMessage(null)
    if (error instanceof VaultPatchError && error.status === 409) {
      setHasConflict(true)
      setErrorMessage('다른 곳에서 수정됐어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.')
    } else {
      setErrorMessage(error instanceof Error ? error.message : '보관 글을 변경하지 못했어요. 다시 시도해 주세요.')
    }
    onError?.(error instanceof Error ? error.message : '보관 글을 변경하지 못했어요. 다시 시도해 주세요.')
  }

  const reloadLatest = async () => {
    if (isReloading || isSubmitting) return
    setIsReloading(true)
    setConfirmReload(false)
    try {
      const response = await (fetchFn ?? globalThis.fetch)(`/api/workspaces/${encodeURIComponent(workspaceId)}/vault/${encodeURIComponent(itemRef)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('최신 내용을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.')
      const body = await response.json()
      const detail = body?.data
      if (!detail || typeof detail.updated_at !== 'string' || typeof detail.content?.body !== 'string' || !Array.isArray(detail.content?.tags)) throw new Error('최신 내용을 확인할 수 없어요. 다시 시도해 주세요.')
      const newTitle = detail.content.title ?? ''
      const newText = detail.content.body
      const newTags = formatHashtags(detail.content.tags)
      const newDate = detail.target_date ?? ''
      setTitle(newTitle); setBaselineTitle(newTitle)
      setText(newText); setBaselineText(newText)
      setHashtagsInput(newTags); setBaselineHashtagsInput(newTags)
      setTargetDate(newDate); setBaselineTargetDate(newDate)
      setApprovalState(detail.needs_reapproval ? 'INVALIDATED' : 'APPROVED')
      setReleaseGate(detail.is_user_held ? 'HELD_USER' : null)
      setIsDeleted(!!detail.deleted_at)
      setCurrentVersion(detail.updated_at)
      setHasConflict(false)
      setErrorMessage(null)
      setStatusMessage(null)
    } catch (error) {
      handleError(error)
    } finally {
      setIsReloading(false)
    }
  }

  // 변경사항 저장
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (isSubmitting || isReloading || hasConflict || !isDirty || isDeleted) return

    setIsSubmitting(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const parsedTags = parseHashtags(hashtagsInput)
      const changes: Record<string, unknown> = {}

      if (isTitleDirty) changes.title = title
      if (isTextDirty) changes.text = text
      if (isHashtagsDirty) changes.hashtags = parsedTags
      if (isDateDirty) {
        changes.targetDate = targetDate.trim().length > 0 ? targetDate.trim() : null
      }

      const result = await patchVaultItem({
        workspaceId,
        itemRef,
        operation: 'edit',
        expectedVersion: currentVersion,
        changes,
        fetchFn,
      })

      // 저장 성공 후 기준값 갱신
      setCurrentVersion(result.updated_at)
      setBaselineTitle(title)
      setBaselineText(text)
      setBaselineHashtagsInput(hashtagsInput)
      setBaselineTargetDate(targetDate)

      if (isContentDirty) {
        // 내용이 변경되어 저장되면 승인이 무효화됨
        setApprovalState('INVALIDATED')
      }

      setStatusMessage(result.message)
      onSuccess?.(result)
    } catch (err: unknown) {
      handleError(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleActionError = (message: string, status?: number) => {
    setStatusMessage(null)
    setErrorMessage(status === 409 ? '다른 곳에서 수정됐어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.' : message)
    if (status === 409) setHasConflict(true)
    onError?.(message)
  }

  // 재승인 성공 핸들러
  const handleReapproveSuccess = (result: VaultEditResult) => {
    setCurrentVersion(result.updated_at)
    setApprovalState('APPROVED')
    setErrorMessage(null)
    setStatusMessage(result.message || '변경 내용을 다시 승인하고 보관했어요.')
    onSuccess?.(result)
  }

  // 보류/재개 성공 핸들러
  const handleHoldSuccess = (result: VaultEditResult) => {
    setCurrentVersion(result.updated_at)
    const nextGate = releaseGate === 'HELD_USER' ? null : 'HELD_USER'
    setReleaseGate(nextGate)
    setErrorMessage(null)
    setStatusMessage(result.message)
    onSuccess?.(result)
  }

  // 삭제 성공 핸들러
  const handleDeleteSuccess = (result: VaultEditResult) => {
    setCurrentVersion(result.updated_at)
    setIsDeleted(true)
    setErrorMessage(null)
    setStatusMessage(result.message)
    onSuccess?.(result)
  }

  // 복구 성공 핸들러
  const handleRestoreSuccess = (result: VaultEditResult) => {
    setCurrentVersion(result.updated_at)
    setIsDeleted(false)
    setErrorMessage(null)
    setStatusMessage(result.message)
    onSuccess?.(result)
  }

  return (
    <Card className={cn('w-full max-w-xl mx-auto shadow-sm', className)}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-bold">보관 글 수정</CardTitle>
            <Badge variant="outline" className="font-medium">
              {currentChannelName}
            </Badge>
          </div>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>
        <CardDescription>
          보관된 글의 제목, 본문, 태그 및 발행 예정일을 수정합니다.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 삭제된 항목 배너 및 복구 제어 */}
        {isDeleted && (
          <DeleteRestoreControl
            workspaceId={workspaceId}
            itemRef={itemRef}
            version={currentVersion}
            isDeleted={true}
            onSuccess={handleRestoreSuccess}
            onError={handleActionError}
            fetchFn={fetchFn}
            disabled={isSubmitting || isReloading || hasConflict}
            showInlineError={false}
          />
        )}

        {/* 승인 해제 및 주의 안내 배너 */}
        {isApprovalInvalidated && !isDeleted && (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-1.5 rounded-lg border border-state-warn/20 bg-state-warn/10 p-3.5 text-sm"
          >
            <div className="flex items-center gap-2 font-semibold text-state-warn">
              <span>승인이 풀렸어요 · 다시 확인하고 저장해 주세요</span>
            </div>
            <p className="text-xs text-state-warn/90">
              수정 중에는 발행 후보에서 제외돼요.
            </p>
            <p className="text-xs text-state-warn/80">
              {otherChannelsText
                ? `이 채널(${currentChannelName})만 승인이 풀렸어요. 다른 채널(${otherChannelsText})의 승인 상태는 유지돼요.`
                : `이 채널(${currentChannelName})만 승인이 풀렸어요. 다른 채널의 승인 상태는 유지돼요.`}
            </p>
          </div>
        )}

        {/* 성공/안내 상태 메시지 */}
        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-state-ok/20 bg-state-ok/10 p-3 text-xs font-medium text-state-ok"
          >
            {statusMessage}
          </div>
        )}

        {hasConflict && (
          <div className="space-y-2">
            <Button type="button" variant="outline" disabled={isReloading || isSubmitting} onClick={() => setConfirmReload(true)}>최신 내용 불러오기</Button>
            {confirmReload && (
              <div role="group" aria-label="최신 내용 불러오기 확인" className="space-y-2 rounded-lg border p-3 text-sm">
                <p>최신 내용을 불러오면 입력 중이던 내용이 사라져요. 계속할까요?</p>
                <Button type="button" disabled={isReloading} onClick={() => void reloadLatest()}>불러오기 확인</Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmReload(false)}>취소</Button>
              </div>
            )}
          </div>
        )}

        {/* 오류 메시지 */}
        {errorMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive"
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4" role="form" aria-label="보관 글 수정 양식">
          {/* 제목 입력 */}
          <div className="space-y-1.5">
            <Label htmlFor="vault-item-title" className="text-sm font-medium">
              제목
            </Label>
            <Input
              id="vault-item-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목을 입력해 주세요"
              disabled={isSubmitting || isDeleted}
              className="min-h-[44px]"
            />
          </div>

          {/* 본문 입력 */}
          <div className="space-y-1.5">
            <Label htmlFor="vault-item-text" className="text-sm font-medium">
              본문
            </Label>
            <Textarea
              id="vault-item-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="본문 내용을 입력해 주세요"
              rows={6}
              disabled={isSubmitting || isDeleted}
              className="resize-y min-h-[120px]"
            />
          </div>

          {/* 태그 입력 */}
          <div className="space-y-1.5">
            <Label htmlFor="vault-item-hashtags" className="text-sm font-medium">
              태그 (해시태그)
            </Label>
            <Input
              id="vault-item-hashtags"
              value={hashtagsInput}
              onChange={(e) => setHashtagsInput(e.target.value)}
              placeholder="#태그1 #태그2 (공백 또는 쉼표로 구분)"
              disabled={isSubmitting || isDeleted}
              className="min-h-[44px]"
            />
          </div>

          {/* 발행 예정일 입력 */}
          <div className="space-y-1.5">
            <Label htmlFor="vault-item-target-date" className="text-sm font-medium">
              발행 예정일
            </Label>
            <Input
              id="vault-item-target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              disabled={isSubmitting || isDeleted}
              className="min-h-[44px]"
              aria-describedby="vault-target-date-hint"
            />
            <p
              id="vault-target-date-hint"
              className="text-xs text-muted-foreground"
            >
              예정일만 변경하면 승인 상태가 유지돼요.
            </p>
          </div>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-3 pt-2">
        {/* 상단 주요 액션 바 */}
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2">
            {!isDeleted && (
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSubmitting || isReloading || hasConflict || !isDirty || isDeleted}
                aria-busy={isSubmitting}
                className="min-h-[44px]"
              >
                {isSubmitting ? '저장 중...' : '변경사항 저장'}
              </Button>
            )}

            {!isDeleted && isApprovalInvalidated && (
              <ReapproveButton
                workspaceId={workspaceId}
                itemRef={itemRef}
                version={currentVersion}
                onSuccess={handleReapproveSuccess}
                onError={handleActionError}
                fetchFn={fetchFn}
                disabled={isSubmitting || isReloading || hasConflict || isDirty}
                showInlineError={false}
                className="min-h-[44px]"
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isDeleted && (
              <HoldToggle
                workspaceId={workspaceId}
                itemRef={itemRef}
                version={currentVersion}
                releaseGate={releaseGate}
                onSuccess={handleHoldSuccess}
                onError={handleActionError}
                fetchFn={fetchFn}
                disabled={isSubmitting || isReloading || hasConflict}
                showInlineError={false}
                className="min-h-[44px]"
              />
            )}

            {!isDeleted && (
              <DeleteRestoreControl
                workspaceId={workspaceId}
                itemRef={itemRef}
                version={currentVersion}
                isDeleted={false}
                onSuccess={handleDeleteSuccess}
                onError={handleActionError}
                fetchFn={fetchFn}
                disabled={isSubmitting || isReloading || hasConflict}
                showInlineError={false}
                className="min-h-[44px]"
              />
            )}
          </div>
        </div>
      </CardFooter>
    </Card>
  )
}
