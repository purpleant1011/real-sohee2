'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface EngagementDmSendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelLabel: string
  accountLabel?: string | null
  customerHandle: string
  replyText: string
  onConfirm: () => Promise<void>
}

export function EngagementDmSendDialog({
  open,
  onOpenChange,
  channelLabel,
  accountLabel,
  customerHandle,
  replyText,
  onConfirm,
}: Readonly<EngagementDmSendDialogProps>) {
  const [submitting, setSubmitting] = useState(false)

  const displayAccount = accountLabel && accountLabel.trim() ? accountLabel.trim() : 'Instagram 계정'

  async function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) {
          onOpenChange(nextOpen)
        }
      }}
      title="이 메시지를 보낼까요?"
    >
      <div className="space-y-4">
        <blockquote className="rounded-lg border-l-4 border-primary bg-muted/50 p-3.5 text-sm text-foreground whitespace-pre-wrap break-words">
          {replyText}
        </blockquote>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {channelLabel} ({displayAccount}) · @{customerHandle} 고객에게 직접 1:1 메시지로 전송돼요. 보낸 뒤에는 소희에서 되돌릴 수 없어요.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            취소
          </Button>
          <Button
            disabled={submitting}
            onClick={handleConfirm}
            type="button"
            variant="default"
          >
            보내기
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
