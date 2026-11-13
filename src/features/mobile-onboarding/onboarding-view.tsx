'use client'

import { useState, type FormEvent } from 'react'
import { StateView } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MediaUploadCard } from '@/features/media/media-upload-card'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { TONE_PRESETS, type TonePresetKey } from '@/features/quick-start/tone-presets'
import { deriveOnboardingStep, type OnboardingProgress, type OnboardingStep } from './onboarding-progress'
import type { OnboardingViewSnapshot } from './onboarding-source'

export type { OnboardingViewSnapshot }

/** 화면이 부르는 서버 명령. 저장 명령은 모두 기존 온보딩 API 를 그대로 쓴다(새 쓰기 경로 없음). */
export interface OnboardingActions {
  /** 가게 정보를 저장한다(PATCH /api/onboarding/quick-start). 성공하면 진행 상태를 다시 읽는다. */
  saveShop(input: { businessName: string; industry: string; summary: string }): Promise<OnboardingActionResult>
  /** 말투를 저장한다(POST /api/onboarding/quick-start — 위저드와 같은 명령). */
  saveTone(tone: TonePresetKey): Promise<OnboardingActionResult>
  /** 계정 연결 화면으로 이동한다. */
  goChannels(): void
  /** 첫 글 미리보기로 이동한다. */
  goPreview(): void
  /** 진행 상태를 서버에서 다시 읽는다(조회 실패·이전 확인 화면의 다음 행동). */
  reload(): void
}

export type OnboardingActionResult = { ok: true } | { ok: false; message: string }

type ResolvedView = {
  kind: 'loading' | 'ready' | 'stale' | 'error'
  progress: OnboardingProgress
}

/**
 * 화면 상태와 진행 단계를 함께 판정한다.
 * - 조회 실패/형식 불일치는 error — 처음부터 다시 입력하는 화면으로 위장하지 않는다.
 * - 단계 판정은 서버 값만 쓴다(`deriveOnboardingStep`).
 */
export function resolveOnboardingView(snapshot: OnboardingViewSnapshot): ResolvedView {
  const progress = deriveOnboardingStep({ profile: snapshot.profile, facts: snapshot.facts })
  if (snapshot.loadState === 'loading') return { kind: 'loading', progress }
  if (snapshot.loadState === 'error' || snapshot.loadState === 'unknown') return { kind: 'error', progress }
  return { kind: snapshot.loadState === 'stale' ? 'stale' : 'ready', progress }
}

const STEP_ITEMS = [
  { step: 'shop', label: '가게' },
  { step: 'tone', label: '말투' },
  { step: 'channels', label: '계정' },
  { step: 'preview', label: '첫 글' },
] as const

/** M03 가게 소개. 라우터/조회는 모르고 스냅샷과 명령만 받는다. */
export function MobileOnboardingView({
  snapshot,
  actions,
  industryPrefill = null,
}: {
  snapshot: OnboardingViewSnapshot
  actions: OnboardingActions
  /** 랜딩에서 고른 업종(읽기 전용). 서버에 업종이 없을 때만 첫 단계 프리필로 쓴다. */
  industryPrefill?: string | null
}) {
  const { kind, progress } = resolveOnboardingView(snapshot)
  // 화면 안에서 넘긴 단계는 같은 스냅샷 안에서만 유효하다.
  // 새로 읽은 스냅샷(checkedAt 변경)이 오면 서버가 계산한 단계를 따른다 — effect 없이 파생만 한다.
  const [override, setOverride] = useState<{ checkedAt: string | null; step: OnboardingStep } | null>(null)
  const step = override && override.checkedAt === snapshot.checkedAt ? override.step : progress.step
  const go = (next: OnboardingStep) => setOverride({ checkedAt: snapshot.checkedAt, step: next })

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">가게 소개</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          네 단계만 마치면 첫 글을 준비할 수 있어요.
        </p>
      </header>

      {kind === 'loading' ? (
        <StateView kind="loading" skeleton="detail" title="가게 소개를 확인하는 중이에요" />
      ) : null}

      {kind === 'error' ? (
        <StateView
          kind="error"
          checkedAt={snapshot.checkedAt}
          title="가게 정보를 불러오지 못했어요"
          description="입력한 내용은 지워지지 않았어요. 잠시 후 다시 확인해 주세요."
          action={
            <Button type="button" className="min-h-11 w-full" onClick={actions.reload}>
              다시 확인
            </Button>
          }
        />
      ) : null}

      {/*
        배너(stale)와 단계 내용을 형제로 둔다 — 하나의 StateView 로 ready↔stale 을 오가면
        트리 모양이 바뀌어 단계 컴포넌트가 재마운트되고, 방금 띄운 저장 결과 문구가 사라진다.
      */}
      {kind === 'stale' ? (
        <StateView
          kind="stale"
          checkedAt={snapshot.checkedAt}
          action={
            <Button type="button" className="min-h-11" onClick={actions.reload}>
              다시 확인
            </Button>
          }
        />
      ) : null}

      {kind === 'ready' || kind === 'stale' ? (
        <StateView kind="ready">
          <div className="space-y-5">
            <StepProgress progress={progress} />

            {step === 'shop' ? (
              // 새로 읽은 값이 오면 폼을 그 값으로 다시 시작한다(입력 중 값 보존은 같은 스냅샷 안에서만).
              <ShopStep
                key={snapshot.checkedAt ?? 'no-checked-at'}
                snapshot={snapshot}
                industryPrefill={industryPrefill}
                onSave={actions.saveShop}
                onDone={() => go('tone')}
              />
            ) : null}
            {step === 'tone' ? (
              <ToneStep
                initialTone={snapshot.preferences?.tone ?? 'friendly'}
                onSave={actions.saveTone}
                onDone={() => go('channels')}
                onBack={() => go('shop')}
              />
            ) : null}
            {step === 'channels' ? (
              <ChannelsStep
                instagram={snapshot.facts.INSTAGRAM_VERIFIED}
                threads={snapshot.facts.THREADS_VERIFIED}
                onConnect={actions.goChannels}
                onDone={() => go('preview')}
                onBack={() => go('tone')}
              />
            ) : null}
            {step === 'preview' ? (
              <PreviewStep onOpen={actions.goPreview} onBack={() => go('channels')} />
            ) : null}
          </div>
        </StateView>
      ) : null}
    </div>
  )
}

export function onboardingScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '가게 소개' }
}

function StepProgress({ progress }: { progress: OnboardingProgress }) {
  return (
    <nav aria-label="가게 소개 단계">
      <ol className="grid grid-cols-2 gap-2">
        {STEP_ITEMS.map((item, i) => {
          const index = i + 1
          const done = index < progress.index
          const current = index === progress.index
          return (
            <li
              key={item.step}
              aria-current={current ? 'step' : undefined}
              className={[
                'rounded-xl border px-3 py-2.5',
                current ? 'border-primary bg-primary/5' : 'border-border bg-card',
              ].join(' ')}
            >
              <span className={done ? 'text-xs font-medium text-primary' : 'text-xs text-muted-foreground'}>
                {done ? '완료' : current ? '지금' : `${index}단계`}
              </span>
              <span className="mt-0.5 block text-sm font-medium leading-5">{item.label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type Message = { kind: 'ok' | 'error'; text: string } | null

function StepMessage({ message }: { message: Message }) {
  if (!message) return null
  return (
    <p
      role={message.kind === 'error' ? 'alert' : 'status'}
      className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-primary'}
    >
      {message.text}
    </p>
  )
}

function ShopStep({
  snapshot,
  industryPrefill,
  onSave,
  onDone,
}: {
  snapshot: OnboardingViewSnapshot
  industryPrefill: string | null
  onSave: OnboardingActions['saveShop']
  onDone: () => void
}) {
  const [businessName, setBusinessName] = useState(snapshot.profile?.business_name ?? '')
  // 서버에 저장된 업종이 이긴다. 없을 때만 랜딩에서 고른 업종을 보여준다(사장님이 고칠 수 있는 값).
  const [industry, setIndustry] = useState(snapshot.profile?.industry || industryPrefill || '')
  const [summary, setSummary] = useState(snapshot.profile?.summary ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const valid = Boolean(businessName.trim() && industry.trim() && summary.trim())

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setMessage(null)
    const result = await onSave({
      businessName: businessName.trim(),
      industry: industry.trim(),
      summary: summary.trim(),
    })
    setBusy(false)
    if (result.ok) {
      setMessage({ kind: 'ok', text: '가게 정보를 저장했어요.' })
      onDone()
      return
    }
    setMessage({ kind: 'error', text: result.message })
  }

  return (
    <form aria-labelledby="onboarding-shop-title" className="space-y-4" onSubmit={submit}>
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 id="onboarding-shop-title" className="text-base font-semibold">
          가게 정보를 알려 주세요
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {snapshot.empty
            ? '아직 저장된 가게 정보가 없어요. 이름·업종·한 줄 소개를 적어 주세요.'
            : '가게 이름과 업종, 한 줄 소개가 있어야 소개 글을 만들 수 있어요.'}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-business-name">가게 이름</Label>
          <Input
            id="onboarding-business-name"
            className="min-h-11 text-base"
            value={businessName}
            maxLength={60}
            autoComplete="organization"
            onChange={event => setBusinessName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-industry">업종</Label>
          <Input
            id="onboarding-industry"
            className="min-h-11 text-base"
            value={industry}
            maxLength={40}
            placeholder="예: 미용실, 카페, 네일"
            onChange={event => setIndustry(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-summary">한 줄 소개</Label>
          <Textarea
            id="onboarding-summary"
            className="min-h-24 text-base"
            value={summary}
            maxLength={300}
            placeholder="예: 동네에서 10년째, 머리 잘하는 집"
            onChange={event => setSummary(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{summary.length}/300</p>
        </div>
      </section>

      {snapshot.workspaceId ? (
        <MediaUploadCard workspaceId={snapshot.workspaceId} />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          사진을 올리려면 가게 정보를 먼저 확인해 주세요.
        </p>
      )}

      <StepMessage message={message} />
      <div className="space-y-2">
        <Button type="submit" className="min-h-11 w-full" disabled={!valid || busy}>
          {busy ? '저장하는 중' : '저장하고 다음'}
        </Button>
        {!valid ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            가게 이름·업종·한 줄 소개를 모두 입력하면 다음으로 넘어갈 수 있어요.
          </p>
        ) : null}
      </div>
    </form>
  )
}

function ToneStep({
  initialTone,
  onSave,
  onDone,
  onBack,
}: {
  initialTone: TonePresetKey
  onSave: OnboardingActions['saveTone']
  onDone: () => void
  onBack: () => void
}) {
  const [tone, setTone] = useState<TonePresetKey>(initialTone)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  async function submit() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    const result = await onSave(tone)
    setBusy(false)
    if (result.ok) {
      setMessage({ kind: 'ok', text: '말투를 저장했어요.' })
      onDone()
      return
    }
    setMessage({ kind: 'error', text: result.message })
  }

  return (
    <section aria-labelledby="onboarding-tone-title" className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h2 id="onboarding-tone-title" className="text-base font-semibold">
        소희가 글을 쓸 말투를 골라 주세요
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        나중에 언제든 바꿀 수 있어요.
      </p>
      <fieldset className="space-y-2">
        <legend className="sr-only">말투</legend>
        {TONE_PRESETS.map(preset => (
          <label
            key={preset.key}
            className={[
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3',
              tone === preset.key ? 'border-primary bg-primary/5' : 'border-border bg-background',
            ].join(' ')}
          >
            <input
              type="radio"
              name="onboarding-tone"
              className="mt-1 size-4"
              value={preset.key}
              checked={tone === preset.key}
              onChange={() => setTone(preset.key)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{preset.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{preset.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <StepMessage message={message} />
      <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? '저장하는 중' : '이 말투로 정하고 다음'}
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full" disabled={busy} onClick={onBack}>
        가게 정보 다시 보기
      </Button>
    </section>
  )
}

function ChannelsStep({
  instagram,
  threads,
  onConnect,
  onDone,
  onBack,
}: {
  instagram: boolean
  threads: boolean
  onConnect: () => void
  onDone: () => void
  onBack: () => void
}) {
  return (
    <section aria-labelledby="onboarding-channels-title" className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h2 id="onboarding-channels-title" className="text-base font-semibold">
        글을 올릴 계정을 연결해 주세요
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        연결한 계정에만 글을 올려요. 연결하지 않아도 첫 글 준비는 계속할 수 있어요.
      </p>
      <ul className="space-y-1 text-sm">
        <li className="flex items-center justify-between gap-3">
          <span>인스타그램</span>
          <span className={instagram ? 'font-medium text-primary' : 'text-muted-foreground'}>
            {instagram ? '연결 확인됨' : '아직 연결되지 않았어요'}
          </span>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span>스레드</span>
          <span className={threads ? 'font-medium text-primary' : 'text-muted-foreground'}>
            {threads ? '연결 확인됨' : '아직 연결되지 않았어요'}
          </span>
        </li>
      </ul>
      <Button type="button" className="min-h-11 w-full" onClick={onConnect}>
        계정 연결하러 가기
      </Button>
      <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onDone}>
        나중에 연결하고 계속
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onBack}>
        말투 다시 고르기
      </Button>
    </section>
  )
}

function PreviewStep({ onOpen, onBack }: { onOpen: () => void; onBack: () => void }) {
  return (
    <section aria-labelledby="onboarding-preview-title" className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h2 id="onboarding-preview-title" className="text-base font-semibold">
        다음은 첫 글 미리보기예요
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        지금까지 알려 주신 내용으로 소희가 첫 글을 준비해요. 올리기 전에 사장님이 확인하고 결정해요.
      </p>
      <Button type="button" className="min-h-11 w-full" onClick={onOpen}>
        첫 글 미리보기로 가기
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onBack}>
        계정 연결 다시 보기
      </Button>
    </section>
  )
}
