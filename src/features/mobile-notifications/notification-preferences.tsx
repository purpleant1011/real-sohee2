'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { saveNotificationPreferencesAction } from '@/features/notifications/actions/manage-notifications'
import type { NotificationCenterData } from '@/features/notifications/repository'

type Preferences = NotificationCenterData['preferences']

const FIELDS: ReadonlyArray<{ key: keyof Preferences; label: string; hint: string }> = [
  { key: 'approvalEvents', label: '승인 요청', hint: '답장·게시를 확인해 달라고 할 때 알려드려요.' },
  { key: 'scheduleEvents', label: '예약·일정', hint: '예약 문의와 일정이 바뀌면 알려드려요.' },
  { key: 'publishEvents', label: '게시 결과', hint: '게시가 끝나 확인할 결과가 생기면 알려드려요.' },
]

/**
 * M23 알림 설정(Mobile R2, ANI-1770). 표시값은 서버가 준 값만 쓰고,
 * 저장 성공은 서버 응답 뒤에만 표시한다. 로컬에서 저장된 것처럼 먼저 바꾸지 않는다.
 */
export function NotificationPreferences({ preferences }: { preferences: Preferences }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Preferences>(preferences)
  const [message, setMessage] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const changed =
    draft.approvalEvents !== preferences.approvalEvents ||
    draft.scheduleEvents !== preferences.scheduleEvents ||
    draft.publishEvents !== preferences.publishEvents

  function save() {
    setMessage(null)
    startTransition(async () => {
      const result = await saveNotificationPreferencesAction({
        approvalEvents: draft.approvalEvents,
        scheduleEvents: draft.scheduleEvents,
        publishEvents: draft.publishEvents,
      })
      if (result.error) {
        setMessage({ kind: 'error', text: result.error.message })
        return
      }
      setMessage({ kind: 'saved', text: '알림 설정을 저장했어요.' })
      // 저장된 값은 서버 정본을 다시 읽어 맞춘다.
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="notification-preferences-title" className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <div className="space-y-1">
        <h2 id="notification-preferences-title" className="text-lg font-semibold tracking-tight">
          알림 받을 소식
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          끈 종류는 이 화면에만 남고, 잠금 화면 알림은 보내지 않아요.
        </p>
      </div>

      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {FIELDS.map((field) => (
          <li key={field.key} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
            <span className="min-w-0 space-y-0.5">
              <span className="block text-base font-medium">{field.label}</span>
              <span className="block text-sm leading-relaxed text-muted-foreground">{field.hint}</span>
            </span>
            <Switch
              checked={draft[field.key]}
              onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, [field.key]: checked }))}
              disabled={pending}
              aria-label={field.label}
            />
          </li>
        ))}
      </ul>

      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border border-border p-4 text-sm ${message.kind === 'error' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {message.text}
        </p>
      ) : null}

      <Button type="button" onClick={save} disabled={pending || !changed} className="min-h-12 w-full">
        {pending ? '저장하고 있어요' : changed ? '알림 설정 저장' : '저장된 설정이에요'}
      </Button>
    </section>
  )
}
