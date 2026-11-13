'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { patchVaultItem, VaultPatchError } from './api'
import type { HoldToggleProps, VaultEditResult } from './types'

export function HoldToggle({
  workspaceId,
  itemRef,
  version,
  releaseGate,
  onSuccess,
  onError,
  fetchFn,
  disabled = false,
  className,
  showInlineError = true,
}: HoldToggleProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const isHeld = releaseGate === 'HELD_USER'
  const targetOperation = isHeld ? 'resume' : 'hold'
  const buttonLabel = isHeld ? '보류 해제' : '발행 보류'

  const handleToggle = async () => {
    if (isLoading || disabled) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const result: VaultEditResult = await patchVaultItem({
        workspaceId,
        itemRef,
        expectedVersion: version,
        operation: targetOperation,
        fetchFn,
      })
      onSuccess?.(result)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : '보류 상태를 변경하지 못했어요. 다시 시도해 주세요.'
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
        variant="outline"
        onClick={handleToggle}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        aria-label={buttonLabel}
        className={className}
      >
        {isLoading
          ? isHeld
            ? '해제 처리 중...'
            : '보류 처리 중...'
          : buttonLabel}
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
