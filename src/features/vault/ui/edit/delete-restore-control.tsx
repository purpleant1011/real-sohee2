'use client'

import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { patchVaultItem, VaultPatchError } from './api'
import type { DeleteRestoreControlProps, VaultEditResult } from './types'

export function DeleteRestoreControl({
  workspaceId,
  itemRef,
  version,
  isDeleted,
  onSuccess,
  onError,
  fetchFn,
  disabled = false,
  className,
  showInlineError = true,
}: DeleteRestoreControlProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)

  const handleDelete = async () => {
    if (isLoading || disabled) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const result: VaultEditResult = await patchVaultItem({
        workspaceId,
        itemRef,
        expectedVersion: version,
        operation: 'delete',
        fetchFn,
      })
      setIsDialogOpen(false)
      onSuccess?.(result)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : '보관 글을 삭제하지 못했어요. 다시 시도해 주세요.'
      setErrorMessage(message)
      onError?.(message, err instanceof VaultPatchError ? err.status : undefined)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestore = async () => {
    if (isLoading || disabled) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const result: VaultEditResult = await patchVaultItem({
        workspaceId,
        itemRef,
        expectedVersion: version,
        operation: 'restore',
        fetchFn,
      })
      onSuccess?.(result)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : '보관 글을 복구하지 못했어요. 다시 시도해 주세요.'
      setErrorMessage(message)
      onError?.(message, err instanceof VaultPatchError ? err.status : undefined)
    } finally {
      setIsLoading(false)
    }
  }

  if (isDeleted) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 text-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="font-medium text-foreground">삭제된 보관 글이에요</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              30일 안에 복구할 수 있어요.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRestore}
            disabled={disabled || isLoading}
            aria-busy={isLoading}
            aria-label="보관 글 복구하기"
          >
            {isLoading ? '복구 중...' : '보관 글 복구하기'}
          </Button>
        </div>

        {showInlineError && errorMessage && (
          <p
            role="alert"
            aria-live="polite"
            className="text-xs text-destructive font-medium"
          >
            {errorMessage}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogTrigger
          disabled={disabled || isLoading}
          aria-label="보관 글 삭제"
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'text-destructive hover:text-destructive hover:bg-destructive/10 min-h-[44px]',
            className,
          )}
        >
          삭제
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>보관 글을 삭제하시겠어요?</AlertDialogTitle>
            <AlertDialogDescription>
              삭제한 글은 30일까지 복구할 수 있어요. 그 뒤에는 복구할 수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? '삭제 중...' : '삭제하기'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showInlineError && errorMessage && (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs text-destructive font-medium"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
