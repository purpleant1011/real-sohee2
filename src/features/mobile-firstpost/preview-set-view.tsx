'use client'

import { useState } from 'react'
import { StateView, StatusPill, type StateKind } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { DATASET_MODE_LABEL, type DatasetMode } from './dataset-mode'
import {
  CHANNEL_NAME,
  MANUAL_FALLBACK_ACTIONS,
  PREVIEW_ACTION_LABEL,
  PREVIEW_BADGE_LABEL,
  PREVIEW_BLOCKER_COPY,
  PREVIEW_CHANNELS,
  SAVE_LABEL,
  channelBadge,
  copyPayload,
  manualActionStatus,
  type ManualAction,
  connectionBadge,
  copyLengthVerdict,
  editChannelCopy,
  FRAME_EVIDENCE_NOTE,
  previewActions,
  previewBlockers,
  channelFrame,
  selectChannel,
  type ChannelCapability,
  type PreviewAsset,
  type PreviewBlocker,
  type PreviewChannel,
  type PreviewSetState,
} from './preview-set'

/**
 * M06 실사진 홍보 세트 · 채널별 세로형 미리보기 (ANI-1678).
 * 표시 전용: 저장·게시 호출은 하지 않고 부모가 콜백으로 연결한다.
 * 상태칩은 preview-set.ts 의 배지만 쓴다(게시 상태 표시 금지).
 */
export type PreviewSetViewProps = Readonly<{
  asset: PreviewAsset | null
  /** 이 화면의 사진·문구가 실제 데이터인지 예시·시험인지. 필수다(임의 기본값 금지). */
  datasetMode: DatasetMode
  /**
   * `asset` 이 null 일 때의 사유. 사진을 골랐는데 확인하지 못한 경우와
   * 아예 고르지 않은 경우를 구분해 안내한다. 없으면 `NO_ASSET` 으로 본다.
   */
  assetBlocker?: PreviewBlocker | null
  state: PreviewSetState
  capabilities: readonly ChannelCapability[]
  /** 조회 상태. ready 가 아니면 StateView 가 대신 그린다. */
  load?: StateKind
  checkedAt?: string | null
  onChange: (next: PreviewSetState) => void
  onReview?: () => void
  onRetry?: () => void
  /**
   * 문구를 화면에서 고치지 않는 표시 전용 모드(ANI-1678 실라우트).
   * 원고 저장 API 가 없어 편집을 저장할 수 없는 화면은 편집 상자를 열지 않는다 —
   * 고친 척만 하고 저장되지 않는 입력은 두지 않는다. 채널 전환은 그대로 동작한다.
   */
  readOnly?: boolean
  readOnlyMessage?: string
  /**
   * 원고 변경 저장 포트. 없으면 **저장 조작 자체를 만들지 않는다**(저장된 척 금지).
   * 실 저장 서비스 바인딩은 부모가 하고, 이 화면은 클릭만 전달한다.
   */
  onSaveCopy?: () => void
  /** 저장 진행 중. 더블 클릭 1명령 보장은 부모가 담당하지만 버튼도 잠근다. */
  savingCopy?: boolean
  /** 저장 실패 사유 안내(성공 문구는 배지가 담당한다). */
  saveNotice?: string | null
  savedOnlyManual?: boolean
  /**
   * 이 화면이 실제로 아는 채널. 승인 스냅샷은 채널 하나만 담으므로 실라우트는 그 하나만 넘긴다 —
   * 없는 채널 탭은 눌러도 선택이 바뀌지 않는 조작이 된다. 기본값은 두 채널 전부다.
   */
  visibleChannels?: readonly PreviewChannel[]
}>

const SAVE_PILL = { DIRTY: 'draft', SAVING: 'checking_external', SAVED: 'verified', FAILED: 'action_needed' } as const

export function PreviewSetView({ asset, datasetMode, assetBlocker, state, capabilities, load = 'ready', checkedAt, onChange, onReview, onRetry, readOnly = false, readOnlyMessage, visibleChannels = PREVIEW_CHANNELS, onSaveCopy, savingCopy = false, saveNotice, savedOnlyManual = false }: PreviewSetViewProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const entry = state.channels[state.selected]
  const blockers = asset ? previewBlockers(asset, datasetMode) : [assetBlocker ?? 'NO_ASSET']
  // 선택한 채널의 세로형 틀. 사진은 틀 안에서 원본 비율 그대로 들어간다(자르지 않음).
  const frame = channelFrame(asset, state.selected, datasetMode)
  const frameNote = frame ? FRAME_EVIDENCE_NOTE[frame.spec.evidence] : null
  const modeLabel = DATASET_MODE_LABEL[datasetMode]
  const actions = previewActions(capabilities)
  /**
   * 실행 경로가 없는 화면(예시·시험)도 저장·복사·다운로드 버튼은 보이되, 실제 데이터일 때만
   * 켜진다(`manualActionStatus`). 게시 가능한 채널이 있으면 `previewActions` 의 manualFallback 이 비므로, 그대로 쓰면
   * 하단이 비어 버린다(안내 문구만 남는다).
   */
  const manualFallback = (onReview ? actions.manualFallback : MANUAL_FALLBACK_ACTIONS).filter(action => !savedOnlyManual || action !== 'SAVE')
  const hasCopy = Boolean(entry?.copy.text.trim())
  const manualStatus = (a: ManualAction) => savedOnlyManual && state.save !== 'SAVED'
    ? { enabled: false, reason: '변경한 내용을 서버에 저장한 뒤 쓸 수 있어요.' }
    : manualActionStatus(a, { datasetMode, blockers, hasCopy })

  const runManual = async (action: ManualAction) => {
    const status = manualStatus(action)
    if (!status.enabled) return
    if (action === 'COPY' && entry) {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard) {
        setNotice('이 기기에서는 복사할 수 없어요.')
        return
      }
      clipboard.writeText(copyPayload(entry.copy)).then(
        () => setNotice('문구를 복사했어요. 게시된 것은 아니에요.'),
        () => setNotice('복사하지 못했어요. 다시 시도해 주세요.'),
      )
    } else if (action === 'DOWNLOAD' && asset) {
      // 최종 응답이 다른 출처로 리다이렉트되므로 download 속성만으로는 저장되지 않을 수 있다.
      // 내용을 받아 blob 으로 저장하고, 받지 못하면 새 탭으로 열어 직접 저장하게 안내한다.
      try {
        const res = await fetch(asset.imageUrl, { credentials: 'same-origin' })
        if (!res.ok) throw new Error(String(res.status))
        const url = URL.createObjectURL(await res.blob())
        const a = document.createElement('a')
        a.href = url
        a.download = `photo-${asset.assetId}`
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        window.open(asset.imageUrl, '_blank', 'noopener')
        setNotice('바로 저장하지 못해 사진을 새 탭에서 열었어요. 길게 눌러 저장해 주세요.')
      }
    }
  }
  const items = visibleChannels.map((id) => ({ id, label: CHANNEL_NAME[id] }))

  const edit = (channel: PreviewChannel, patch: { text?: string; cta?: string }) => {
    const result = editChannelCopy(state, channel, patch)
    if (result.ok) {
      setNotice(null)
      onChange(result.state)
    } else {
      setNotice(result.reason === 'EMPTY_COPY' || result.reason === 'EMPTY_CTA' ? '내용을 비워 둘 수 없어요.' : '지금은 고칠 수 없어요.')
    }
  }

  return (
    <StateView
      kind={load}
      checkedAt={checkedAt}
      skeleton="detail"
      action={onRetry ? <Button variant="outline" className="min-h-11" onClick={onRetry}>다시 확인</Button> : undefined}
    >
      <section data-first-post-preview data-dataset-mode={datasetMode} aria-label="홍보 미리보기" className="space-y-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">홍보 미리보기</h2>
          <StatusPill kind={SAVE_PILL[state.save]} label={SAVE_LABEL[state.save]} />
        </header>

        {modeLabel ? (
          <p
            role="note"
            data-dataset-mode-label={datasetMode}
            className="rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            {modeLabel}
          </p>
        ) : null}

        {/* 고를 것이 하나뿐이면 선택기를 두지 않는다(눌러도 바뀌지 않는 조작 금지). */}
        {items.length > 1 ? (
          <SegmentedControl
            ariaLabel="채널 선택"
            items={items}
            value={state.selected}
            onChange={(id) => onChange(selectChannel(state, id))}
          />
        ) : null}

        {blockers.length > 0 ? (
          <ul className="space-y-2" role="alert">
            {blockers.map((b) => (
              <li key={b} className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">{PREVIEW_BLOCKER_COPY[b].label}</p>
                <p className="text-muted-foreground">{PREVIEW_BLOCKER_COPY[b].detail}</p>
              </li>
            ))}
          </ul>
        ) : asset && frame ? (
          <figure
            data-preview-channel={state.selected}
            data-frame-aspect={frame.frameAspectRatio}
            data-frame-evidence={frame.spec.evidence}
            className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-border bg-muted"
          >
            {/* 채널 세로형 틀 — 사진은 틀 안에서 원본 비율 그대로, 자르지 않는다 */}
            <div className="w-full bg-muted" style={{ aspectRatio: frame.frameAspectRatio }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.imageUrl}
                alt="올릴 사진"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain"
              />
            </div>
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              {CHANNEL_NAME[state.selected]} {frame.spec.label} 미리보기
              {frameNote ? ` · ${frameNote}` : ''}
            </p>
            {entry ? (
              <figcaption className="space-y-1 p-3 text-sm">
                <p className="whitespace-pre-wrap break-words">{entry.copy.text}</p>
                <p className="font-medium text-primary">{entry.copy.cta}</p>
              </figcaption>
            ) : null}
          </figure>
        ) : null}

        {entry ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill kind={entry.status === 'GENERATING' ? 'checking_external' : 'draft'} label={PREVIEW_BADGE_LABEL[channelBadge(entry)]} className="whitespace-nowrap" />
              <span className="text-xs text-muted-foreground">예상 화면 · 실제 게시 모습과 다를 수 있어요</span>
            </div>
            {readOnly ? (
              // 저장 경로가 없는 화면: 고친 척하고 저장되지 않는 입력 상자를 두지 않는다.
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{CHANNEL_NAME[entry.channel]} 문구</p>
                <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{entry.copy.text}</p>
                <LengthNote channel={entry.channel} text={entry.copy.text} />
                {entry.copy.cta.trim() ? <p className="text-base font-medium text-primary">{entry.copy.cta}</p> : null}
                <p className="text-xs text-muted-foreground">{readOnlyMessage ?? '문구 고치기는 편집 화면에서 할 수 있어요.'}</p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`fp-text-${entry.channel}`}>{CHANNEL_NAME[entry.channel]} 문구</Label>
                  <Textarea
                    id={`fp-text-${entry.channel}`}
                    className="min-h-32 text-base"
                    disabled={entry.status === 'GENERATING' || savingCopy}
                    value={entry.copy.text}
                    onChange={(e) => edit(entry.channel, { text: e.target.value })}
                  />
                  <LengthNote channel={entry.channel} text={entry.copy.text} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`fp-cta-${entry.channel}`}>행동 유도 문구</Label>
                  <Input
                    id={`fp-cta-${entry.channel}`}
                    className="min-h-11 text-base"
                    disabled={entry.status === 'GENERATING' || savingCopy}
                    value={entry.copy.cta}
                    onChange={(e) => edit(entry.channel, { cta: e.target.value })}
                  />
                </div>
              </>
            )}
            {notice ? <p role="status" className="text-sm text-state-warn">{notice}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">이 채널의 초안은 아직 없어요.</p>
        )}

        <ul className="space-y-1" aria-label="채널 연결 상태">
          {capabilities.map((c) => {
            const badge = connectionBadge(c)
            return (
              <li key={c.channel} className="text-sm text-muted-foreground">
                {badge.verified ? '✓ ' : ''}{badge.label}
              </li>
            )
          })}
        </ul>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          {/* 원고 저장: 포트가 있고 저장 대기일 때만. 저장된 척하는 버튼은 두지 않는다. */}
          {onSaveCopy && !readOnly ? (
            <Button
              variant="secondary"
              className="min-h-11 flex-1"
              disabled={savingCopy || state.save === 'SAVED'}
              onClick={onSaveCopy}
            >
              {savingCopy ? '저장 중' : '변경 저장'}
            </Button>
          ) : null}
          {/* 검토는 실행 경로가 열려 있을 때만 노출한다(예시·시험 화면은 승인으로 이어지지 않는다). */}
          {onReview ? (
            <Button className="min-h-11 flex-1" disabled={blockers.length > 0 || state.save !== 'SAVED' || savingCopy} onClick={onReview}>
              {PREVIEW_ACTION_LABEL.REVIEW}
            </Button>
          ) : null}
          {manualFallback.map((a) => {
            const status = manualStatus(a)
            return (
              <Button
                key={a}
                variant="outline"
                className="min-h-11"
                disabled={!status.enabled}
                aria-describedby={status.enabled ? undefined : `manual-action-reason-${a}`}
                onClick={() => runManual(a)}
              >
                {PREVIEW_ACTION_LABEL[a]}
              </Button>
            )
          })}
        </div>
        {saveNotice ? (
          <p role="alert" className="text-sm text-destructive">
            {saveNotice}
          </p>
        ) : null}
        <ul className="space-y-1" aria-label="저장·복사·다운로드 안내">
          {manualFallback.map((a) => {
            const { reason } = manualStatus(a)
            return reason ? (
              <li key={a} id={`manual-action-reason-${a}`} className="text-xs text-muted-foreground">
                {PREVIEW_ACTION_LABEL[a]}: {reason}
              </li>
            ) : null
          })}
        </ul>
        {!onReview ? (
          <p role="status" className="text-xs text-muted-foreground">
            {datasetMode === 'ACTUAL'
              ? '이 화면에서는 게시하지 않아요. 문구를 복사하거나 사진을 내려받아 직접 올릴 수 있어요.'
              : '예시 화면이라 승인·게시로 이어지지 않아요. 저장·복사·다운로드도 실제 데이터에서만 열려요.'}
          </p>
        ) : !actions.publishEnabled ? (
          <p className="text-xs text-muted-foreground">게시 권한이 확인되지 않아 지금은 직접 올릴 수 있게 준비해 드려요.</p>
        ) : null}
      </section>
    </StateView>
  )
}

function LengthNote({ channel, text }: Readonly<{ channel: PreviewChannel; text: string }>) {
  const v = copyLengthVerdict(channel, text)
  if (v.kind === 'OK') return <p className="text-xs tabular-nums text-muted-foreground">{v.length}자</p>
  return (
    <p className="text-xs tabular-nums text-state-warn">
      {v.length}자 · 권장 {v.maxLength}자를 넘었어요{v.evidence === 'UNVERIFIED' ? ' (기준 미확인)' : ''}
    </p>
  )
}
