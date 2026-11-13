'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { QuickPostSummary } from '@/features/quick-start/quick-post-service'

type Copies = QuickPostSummary['copies']

export function InlineCopyEditor({ copies, onSave, onCancel }: {
  copies: Copies
  onSave: (copies: Copies) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(copies)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수정 내용을 저장하지 못했어요.')
      setSaving(false)
    }
  }
  return <section aria-label="첫 글 직접 수정" className="space-y-3 rounded-xl border bg-card p-4">
    <p className="text-sm text-muted-foreground">저장한 내용을 다시 확인한 뒤 승인해 주세요. 직접 수정에는 생성 포인트가 들지 않아요.</p>
    <label className="block space-y-2 text-sm font-medium">
      <span>인스타그램 글</span>
      <Textarea value={value.instagram.caption} maxLength={2200} disabled={saving} rows={5}
        onChange={(event) => setValue({ ...value, instagram: { ...value.instagram, caption: event.target.value } })} />
    </label>
    <label className="block space-y-2 text-sm font-medium">
      <span>스레드 글</span>
      <Textarea value={value.threads.content} maxLength={500} disabled={saving} rows={5}
        onChange={(event) => setValue({ ...value, threads: { content: event.target.value } })} />
    </label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" disabled={saving || !value.instagram.caption.trim() || !value.threads.content.trim()} aria-busy={saving} onClick={() => void submit()}>
        {saving ? '저장하는 중…' : '수정 내용 저장'}
      </Button>
      <Button className="min-h-11" variant="outline" disabled={saving} onClick={onCancel}>수정 취소</Button>
    </div>
  </section>
}
