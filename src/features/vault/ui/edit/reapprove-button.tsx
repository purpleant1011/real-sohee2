'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { patchVaultItem, VaultPatchError } from './api'
import type { ReapproveButtonProps, VaultEditResult } from './types'

export function ReapproveButton({
  workspaceId,
  itemRef,
  version,
  onSuccess,
  onError,
  fetchFn,
  disabled = false,
  className,
  size = 'default',
  showInlineError = true,
}: ReapproveButtonProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const handleReapprove = async () => {
    if (isLoading || disabled) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const result: VaultEditResult = await patchVaultItem({
        workspaceId,
        itemRef,
        expectedVersion: version,
        operation: 'reapprove',
        fetchFn,
      })
      onSuccess?.(result)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : '다시 승인하지 못했어요. 내용을 확인한 뒤 다시 시도해 주세요.'
      setErrorMessage(message)
      onError?.(message, err instanceof VaultPatchError ? err.status : undefined)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="default"
        size={size}
        onClick={handleReapprove}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        aria-label="다시 승인하고 보관"
        className={className}
      >
        {isLoading ? '승인 처리 중...' : '다시 승인하고 보관'}
      </Button>

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
