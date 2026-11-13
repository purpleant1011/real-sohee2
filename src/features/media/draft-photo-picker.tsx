'use client'

import React, { useEffect, useState } from 'react'
import {
  Ban,
  Check,
  CircleHelp,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  ShieldCheck,
  UploadCloud,
  UserCheck,
  UserX,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DraftPhotoPeople, DraftPhotoPickerProps } from './draft-photo-picker.types'

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const PEOPLE_OPTIONS: Array<{
  value: DraftPhotoPeople
  label: string
  ariaLabel: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
}> = [
  {
    value: 'none',
    label: '없음',
    ariaLabel: '알아볼 수 있는 사람이 없어요',
    icon: UserX,
  },
  {
    value: 'unknown',
    label: '몰라요',
    ariaLabel: '아직 확인하지 않았어요',
    icon: CircleHelp,
  },
  {
    value: 'consented',
    label: '동의',
    ariaLabel: '등장한 모든 사람의 홍보 사용 동의를 받았어요',
    icon: UserCheck,
  },
]

export function DraftPhotoPicker({
  items,
  selectedId,
  phase,
  isUploading,
  error,
  notice,
  file,
  copyright,
  people,
  consent,
  confirmWithdrawalId,
  onPickFile,
  onCopyrightChange,
  onPeopleChange,
  onConsentChange,
  onUpload,
  onCancelTransfer,
  onReload,
  onSelect,
  onAskWithdraw,
  onWithdraw,
}: DraftPhotoPickerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const isBusy = Boolean(phase)

  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 파일 제거 시 미리보기 해제
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file])

  const showCancel = isUploading || (phase !== null && phase.startsWith('HEIC'))
  const cancelAriaLabel = phase?.startsWith('HEIC') ? '변환 취소' : '전송 중단'

  return (
    <div className="space-y-3 break-keep">
      {/* 1. 상단 한 줄: 제목 없이 아이콘 + "사진" 소제목 + 새로고침 아이콘 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <ImagePlus className="size-4 text-muted-foreground" aria-hidden="true" />
          <span>사진</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-xl text-muted-foreground hover:text-foreground"
          aria-label="저장한 사진 다시 확인"
          onClick={onReload}
          disabled={isBusy}
        >
          <RotateCw className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {/* 2 & 3. 사진 격자: grid-cols-3 gap-2, 정사각 타일 */}
      <div className="grid grid-cols-3 gap-2">
        {items.map(item => {
          const isSelected = selectedId === item.id
          const isConfirming = confirmWithdrawalId === item.id

          return (
            <React.Fragment key={item.id}>
              <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
                {/* 메인 선택 버튼 */}
                <button
                  type="button"
                  aria-label={item.eligible ? '이 사진 선택' : '권리 확인 필요'}
                  aria-pressed={item.eligible ? isSelected : undefined}
                  disabled={!item.eligible || isBusy}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'relative size-full overflow-hidden rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'ring-2 ring-primary ring-offset-1',
                    !item.eligible && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <ImagePlus className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/40" aria-hidden="true" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.src} alt="" className="relative size-full object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />

                  {/* 선택 표시 배지 */}
                  {item.eligible && isSelected && (
                    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                      <Check className="size-3 stroke-[3]" aria-hidden="true" />
                    </span>
                  )}

                  {/* 미적격(자물쇠) 배지 */}
                  {!item.eligible && (
                    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-xs backdrop-blur-xs">
                      <Lock className="size-3" aria-hidden="true" />
                    </span>
                  )}
                </button>

                {/* 공개 사용 중단(Ban) 아이콘버튼 */}
                <button
                  type="button"
                  aria-label="사진 공개 사용 중단"
                  disabled={isBusy}
                  onClick={e => {
                    e.stopPropagation()
                    onAskWithdraw(item.id)
                  }}
                  className="absolute bottom-1 left-1 flex size-7 items-center justify-center rounded-lg bg-background/80 text-muted-foreground shadow-xs backdrop-blur-xs transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 after:absolute after:-inset-2 after:content-['']"
                >
                  <Ban className="size-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* 중단 확인 바 (해당 사진 타일 바로 다음 행 전체폭 표시) */}
              {isConfirming && (
                <div className="col-span-3 flex items-center justify-between gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                  <span className="font-medium">이 사진 사용을 중단할까요?</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-8 rounded-lg px-2.5 text-xs font-medium"
                      aria-label="이 사진 사용 중단 확인"
                      onClick={() => onWithdraw(item.id)}
                      disabled={isBusy}
                    >
                      중단
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      aria-label="취소"
                      onClick={() => onAskWithdraw(null)}
                      disabled={isBusy}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}

        {/* 마지막 칸: 사진 추가 타일 */}
        <label
          htmlFor="owner-photo"
          className={cn(
            'flex aspect-square min-h-[44px] min-w-[44px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-within:ring-2 focus-within:ring-ring',
            isBusy && 'pointer-events-none cursor-not-allowed opacity-50',
          )}
        >
          <Plus className="size-5" aria-hidden="true" />
          <span className="text-xs font-medium">추가</span>
          <input
            id="owner-photo"
            type="file"
            className="sr-only"
            aria-label="가게 사진 고르기"
            accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
            disabled={isBusy}
            onChange={event => {
              const selected = event.target.files?.[0] ?? null
              event.target.value = ''
              onPickFile(selected)
            }}
          />
        </label>
      </div>

      {/* 4. file이 있으면(저장 전) 격자 아래 카드 하나 */}
      {file && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-3 shadow-xs">
          {/* 파일 정보 미리보기 */}
          <div className="flex items-center gap-3">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="size-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
          </div>

          {/* 권리 확인 아이콘 토글 & 사람 세그먼트 */}
          <div className="space-y-2">
            {/* 칩형 토글 버튼 (내 사진이에요) */}
            <button
              type="button"
              role="checkbox"
              aria-checked={copyright}
              disabled={isBusy}
              onClick={() => onCopyrightChange(!copyright)}
              className={cn(
                'flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                copyright
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              <span>내 사진이에요</span>
            </button>

            {/* 사람 여부 3분할 세그먼트 */}
            <div
              role="radiogroup"
              aria-label="알아볼 수 있는 사람"
              className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/40 p-1"
            >
              {PEOPLE_OPTIONS.map(opt => {
                const isChecked = people === opt.value
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={isChecked}
                    aria-label={opt.ariaLabel}
                    disabled={isBusy}
                    onClick={() => onPeopleChange(opt.value)}
                    className={cn(
                      'flex h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                      isChecked
                        ? 'border border-primary/30 bg-primary/10 text-primary shadow-xs'
                        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>

            {/* consented일 때만 동의 근거 관리번호 Input */}
            {people === 'consented' && (
              <Input
                id="photo-consent"
                aria-label="동의 근거 관리번호"
                placeholder="관리번호"
                maxLength={200}
                value={consent}
                disabled={isBusy}
                onChange={e => onConsentChange(e.target.value)}
                className="h-11 rounded-xl text-xs"
              />
            )}
          </div>

          {/* 저장 버튼 및 취소 버튼 */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              className="h-11 flex-1 rounded-xl"
              aria-label={error ? '사진 저장 다시 시도' : '사진 저장하기'}
              disabled={!file || isBusy}
              onClick={onUpload}
            >
              {isBusy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span aria-live="polite">{phase}</span>
                </>
              ) : (
                <>
                  <UploadCloud className="size-4" aria-hidden="true" />
                  <span>저장</span>
                </>
              )}
            </Button>
            {showCancel && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 rounded-xl"
                aria-label={cancelAriaLabel}
                onClick={onCancelTransfer}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* 보조 한 줄 안내 */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            <span>공개 게시엔 권리 확인이 필요해요</span>
          </div>
        </div>
      )}

      {!file && phase && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {phase}
        </p>
      )}

      {/* 5. notice / error */}
      {notice && (
        <p role="status" className="text-xs font-medium text-primary">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
