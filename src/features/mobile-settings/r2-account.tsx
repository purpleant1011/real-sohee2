'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { StateView } from '@/components/mobile-ui'
import { MobileAppShell, ShellScreen, type ShellScreenConfig } from '@/features/mobile-shell'
import { saveSettingsAction } from '@/features/settings/actions/save-settings'
import type { BusinessSettings } from '@/features/settings/types'
import {
  accountEditNote, accountSaveState, type AccountSaveState, type AccountSettingsProp,
} from './account-settings-model'

export function accountScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '가게 정보' }
}

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground disabled:opacity-60'
const LABEL = 'block space-y-1.5 text-sm font-medium'

/**
 * 설정(`/app/account`) — R2 셸 배선(ANI-1771, 플래그 뒤).
 *
 * 값은 서버 컴포넌트가 `getOperationalSettings(세션 workspace)` 로 읽어 내려준 정본이다.
 * 이 화면은 workspaceId 를 받지 않고, 저장도 기존 서버 명령 계약(`saveSettingsAction`)만 쓴다 —
 * 대상 가게는 세션 문맥에서 정해지므로 다른 가게 값을 읽거나 쓰는 경로가 없다.
 */
export function R2Account({ settings }: Readonly<{ settings: AccountSettingsProp }>) {
  const { mode, title } = accountScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <div className="mx-auto w-full max-w-2xl space-y-4 pt-2 pb-6">
          {settings.ok ? (
            <BusinessProfileForm business={settings.business} canEdit={settings.canEdit} />
          ) : (
            <StateView
              kind="error"
              skeleton="detail"
              title="가게 정보를 불러오지 못했어요"
              description="내용이 없는 것이 아니라, 확인에 실패한 상태예요. 잠시 후 다시 열어 주세요."
            />
          )}
        </div>
      </ShellScreen>
    </MobileAppShell>
  )
}

function BusinessProfileForm({ business, canEdit }: Readonly<{ business: BusinessSettings; canEdit: boolean }>) {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<AccountSaveState | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveSettingsAction({
        kind: 'business',
        businessName: form.get('businessName'),
        industry: form.get('industry'),
        location: form.get('location'),
        summary: form.get('summary'),
      })
      setState(accountSaveState(result))
    })
  }

  return (
    <form aria-busy={pending} className="space-y-4" onSubmit={submit}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">가게 정보</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          지금 서버에 저장된 내용이에요. 고치면 이 가게의 정보가 바뀝니다.
        </p>
      </header>

      <label className={LABEL}>
        <span>사업명</span>
        <input className={FIELD} defaultValue={business.businessName} disabled={!canEdit || pending} maxLength={120} name="businessName" required />
      </label>
      <label className={LABEL}>
        <span>업종</span>
        <input className={FIELD} defaultValue={business.industry} disabled={!canEdit || pending} maxLength={120} name="industry" />
      </label>
      <label className={LABEL}>
        <span>위치</span>
        <input className={FIELD} defaultValue={business.location} disabled={!canEdit || pending} maxLength={200} name="location" />
      </label>
      <label className={LABEL}>
        <span>운영 요약</span>
        <textarea className={FIELD} defaultValue={business.summary} disabled={!canEdit || pending} maxLength={4_000} name="summary" rows={5} />
      </label>

      {canEdit ? (
        <button
          className="min-h-11 w-full rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? '저장하는 중이에요' : '저장'}
        </button>
      ) : null}

      <p className="text-sm leading-relaxed text-muted-foreground">{accountEditNote(canEdit)}</p>

      {state ? (
        <p
          role={state.tone === 'saved' ? 'status' : 'alert'}
          className={state.tone === 'saved'
            ? 'rounded-xl bg-state-ok-soft px-3.5 py-3 text-[14px] leading-5 text-state-ok'
            : 'rounded-xl bg-state-danger-soft px-3.5 py-3 text-[14px] leading-5 text-state-danger'}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
