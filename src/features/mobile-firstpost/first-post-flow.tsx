'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ApprovalReviewView } from './approval-review-view'
import { createApprovalCommand } from './approval-client'
import { draftApprovalInput, draftAsset, draftAssetIssue, draftDatasetMode, draftSeedChannels, type DraftDto } from './draft-mapper'
import type { ApprovalReviewInput } from './approval-review'
import { PreviewSetView } from './preview-set-view'
import { useMeasuredImage } from './measured-asset'
import { createPublishCommand, type PublishCommandResult } from './publish-client'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { ResultScreenView } from './result-screen-view'
import { beginSave, saveFailed, seedPreviewSet, type ChannelCapability, type PreviewSetState } from './preview-set'
import { deriveFirstPostOutcome } from './publish-outcome'
import type { ExactApprovalCopies } from '@/features/missions/conversational-first-post'
import { verifyDraftReadback } from './draft-readback-match'

/**
 * 첫 포스팅 M06 → M07 → M08 흐름 (ANI-1767). 플래그 뒤에서만 마운트한다.
 * - 외부 게시를 부르는 길은 승인 뒤 나오는 `지금 게시하기` 버튼 하나뿐이다.
 * - 게시 응답을 읽지 못하면 '알 수 없음'으로 두고 다시 게시하는 버튼을 열지 않는다.
 * - 원고 저장은 revise 후 필수 GET readback 스냅샷이 일치할 때만 확정한다.
 */
// 플래그 판정은 서버 컴포넌트도 부를 수 있는 모듈에 있다. 기존 호출부를 위해 여기서도 내보낸다.
export { FIRST_POST_R2_FLAG, isFirstPostR2Enabled } from './first-post-flag'

type Step = 'PREVIEW' | 'APPROVAL' | 'APPROVED' | 'RESULT'
export type CopySaveInput = { draft: DraftDto; copies: ExactApprovalCopies; signal: AbortSignal }

export type FirstPostFlowProps = Readonly<{
  draft: DraftDto
  workspaceId?: string
  fetchImpl?: typeof fetch
  /**
   * 원고 저장 포트. **없으면 이 Flow 는 readOnly 로 남는다**(저장 버튼 미생성, 저장된 척 0).
   * 실 서비스 바인딩은 호출부(entry)가 하고, 여기서는 클릭 1회당 정확히 1번 호출한다.
   */
  onSaveCopy?: (input: CopySaveInput) => Promise<{ kind: string; newFingerprint?: string; draft?: DraftDto }>
  /** 저장 후 서버에서 다시 읽은 지문. 주어지면 SAVED 조건에 포함된다(canonical 교차 확인). */
  readCanonicalFingerprint?: () => Promise<string | null>
}>

/* ------------------------------------------------------------------ */
/* 원고 저장 소비 (ANI-1788 S5 / ANI-1787-W8-FLOW-MOCK)                */
/* ------------------------------------------------------------------ */

/** 승인 대상 원고 지문 형식(SHA-256 hex). */
const SAVED_FINGERPRINT = /^[a-f0-9]{64}$/

export type CopySaveFailure = 'STALE_APPROVAL' | 'INVALID' | 'UNAUTHORIZED' | 'UNKNOWN' | 'FINGERPRINT_MISMATCH'

export type CopySaveOutcome =
  | { kind: 'SAVED'; fingerprint: string; approval: ApprovalReviewInput }
  | { kind: 'NOT_SAVED'; reason: CopySaveFailure; message: string }

/** 저장 실패 사유별 사용자 문구. `invalid` 는 서버 호출 없이 끝날 수 있으므로 네트워크 문구와 분리한다. */
const COPY_SAVE_MESSAGE: Record<CopySaveFailure, string> = {
  STALE_APPROVAL: '다른 곳에서 내용이 바뀌었어요. 최신 초안을 다시 불러와 확인해 주세요.',
  INVALID: '저장할 내용을 다시 확인해 주세요.',
  UNAUTHORIZED: '저장할 권한이 없어요. 매장 관리자에게 확인해 주세요.',
  UNKNOWN: '저장했는지 확인하지 못했어요. 화면을 다시 열어 실제 내용을 확인해 주세요.',
  FINGERPRINT_MISMATCH: '저장된 내용을 확인하지 못했어요. 최신 초안을 다시 불러와 주세요.',
}

/**
 * 저장 client 에 넘길 인자를 **서버가 준 값 그대로** 만든다.
 *
 * W2 계약(2026-10-25): propose·GET 두 응답 모두 draft 에 `status`/`topic`/`goal`/`boundVersions`/`createdAt`
 * 이 실제로 들어 있습니다(`conversational-first-post.ts:306-316`, `[missionId]/route.ts:46-47`).
 * 그래도 **값을 지어내지 않는다** — 필수 필드가 하나라도 없거나 형식이 다르면 `null` 을 돌려주고 저장을 시작하지 않는다.
 * (레거시 행은 필드가 빠질 수 있다.)
 */
type SaveClientArgSource = DraftDto & {
  status?: unknown
  topic?: unknown
  goal?: unknown
  boundVersions?: unknown
  createdAt?: unknown
}

const SAVE_STATUSES = ['AWAITING_EXACT_APPROVAL', 'APPROVED_FOR_PUBLISH'] as const
type SaveStatus = (typeof SAVE_STATUSES)[number]

export type SaveClientArgs = Readonly<{
  missionId: string
  workspaceId: string
  status: SaveStatus
  topic: string
  goal: string
  copies: unknown
  selectedImageIds: string[]
  boundVersions: unknown
  rights: unknown
  channels: unknown
  approvalFingerprint: string
  createdAt: string
}>

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function buildSaveClientArgs(draft: DraftDto, copies: unknown): SaveClientArgs | null {
  const src = draft as SaveClientArgSource
  const { status, topic, goal, boundVersions, createdAt } = src

  const isStatus = (v: unknown): v is SaveStatus =>
    typeof v === 'string' && (SAVE_STATUSES as readonly string[]).includes(v)

  if (
    !nonEmpty(src.missionId) ||
    !nonEmpty(src.workspaceId) ||
    !isStatus(status) ||
    !nonEmpty(topic) ||
    !nonEmpty(goal) ||
    !nonEmpty(createdAt) ||
    !SAVED_FINGERPRINT.test(String(src.approvalFingerprint ?? '')) ||
    !Array.isArray(src.selectedImageIds) ||
    !src.selectedImageIds.every((id) => typeof id === 'string') ||
    !isRecord(copies) ||
    !isRecord(boundVersions) ||
    !isRecord(src.rights) ||
    !Array.isArray(src.channels)
  ) {
    return null
  }

  return {
    missionId: src.missionId,
    workspaceId: src.workspaceId,
    status,
    topic,
    goal,
    // 아래 4개는 형식을 위에서 확인한 **서버 값 그대로**다(새 값 생성 없음).
    copies,
    selectedImageIds: [...src.selectedImageIds],
    boundVersions,
    rights: src.rights,
    channels: src.channels,
    approvalFingerprint: String(src.approvalFingerprint),
    createdAt,
  }
}

/**
 * 원고 수정 저장 결과를 화면 상태로 옮긴다.
 *
 * - `save` 는 주입받는다(실 저장 경로는 아직 열지 않는다). 호출은 **딱 한 번**이며 자동 재전송하지 않는다.
 * - 성공 표시는 `saved` **이면서** 지문이 SHA-256 hex **이고**, canonical 재조회 지문이 주어진 경우 **일치**할 때만.
 * - 실패는 사유별로 닫고, 승인 입력은 **바꾸지 않는다**(성공 배지·지문 승격 금지).
 * - 성공 시에도 `approved` 는 비운다 — 원고가 바뀌었으므로 재승인이 필요하다.
 */
export async function consumeCopySave(input: {
  save: () => Promise<{ kind: string; newFingerprint?: string; reason?: string }>
  approval: ApprovalReviewInput
  /** 저장 후 서버에서 다시 읽은 지문. 주어지면 성공 조건에 포함된다. */
  canonicalFingerprint?: () => Promise<string | null>
}): Promise<CopySaveOutcome> {
  const fail = (reason: CopySaveFailure): CopySaveOutcome => ({
    kind: 'NOT_SAVED',
    reason,
    message: COPY_SAVE_MESSAGE[reason],
  })

  let result: { kind: string; newFingerprint?: string; reason?: string }
  try {
    result = await input.save()
  } catch {
    return fail('UNKNOWN')
  }

  if (result.kind !== 'saved') {
    if (result.kind === 'conflict') return fail('STALE_APPROVAL')
    if (result.kind === 'invalid') return fail('INVALID')
    if (result.kind === 'unauthorized') return fail('UNAUTHORIZED')
    return fail('UNKNOWN')
  }

  const fingerprint = result.newFingerprint
  if (typeof fingerprint !== 'string' || !SAVED_FINGERPRINT.test(fingerprint)) return fail('UNKNOWN')

  if (input.canonicalFingerprint) {
    let canonical: string | null
    try {
      canonical = await input.canonicalFingerprint()
    } catch {
      return fail('UNKNOWN')
    }
    if (canonical !== fingerprint) return fail('FINGERPRINT_MISMATCH')
  }

  return {
    kind: 'SAVED',
    fingerprint,
    // 원고가 바뀌었으니 이전 승인은 무효다. 새 지문으로 다시 승인받아야 한다.
    approval: { ...input.approval, saved: true, serverFingerprint: fingerprint, approved: null },
  }
}

export function FirstPostFlow(props: FirstPostFlowProps) {
  const scope = `${props.workspaceId ?? ''}:${String(props.draft.workspaceId)}:${String(props.draft.missionId)}:${String(props.draft.approvalFingerprint)}`
  return <FirstPostFlowSession key={scope} {...props} />
}

function FirstPostFlowSession({ draft: initialDraft, workspaceId, fetchImpl, onSaveCopy }: FirstPostFlowProps) {
  const [draft, setDraft] = useState(initialDraft)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const missionId = typeof draft.missionId === 'string' ? draft.missionId : ''
  const [step, setStep] = useState<Step>('PREVIEW')
  const [preview, setPreview] = useState<PreviewSetState>(() => seedPreviewSet({ channels: draftSeedChannels(draft) }))
  const [result, setResult] = useState<PublishCommandResult | null>(null)
  const [publishing, setPublishing] = useState(false)
  // 오프라인/중복으로 시작하지 못했을 때 이유를 보여 준다(ANI-1778). 실패로 단정하지 않는다.
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  // 원고 저장 UI 상태 (포트가 없으면 쓰이지 않는다)
  const [savingCopy, setSavingCopy] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [saveUncertain, setSaveUncertain] = useState(false)
  const runExternalWrite = useExternalWriteGuard()

  const datasetMode = useMemo(() => draftDatasetMode(draft), [draft])
  /**
   * 사진 범위 검증에 쓸 워크스페이스. 초안에 없으면 라우트가 넘긴 값을 쓴다
   * (서버가 소속을 확인해 준 값이므로 추측이 아니다). 둘 다 없으면 미리보기가 막힌다.
   */
  const assetWorkspaceId = useMemo(() => {
    const fromDraft = typeof draft.workspaceId === 'string' ? draft.workspaceId : ''
    return fromDraft || workspaceId || ''
  }, [draft, workspaceId])
  const scopedDraft = useMemo(() => ({ ...draft, workspaceId: assetWorkspaceId }), [draft, assetWorkspaceId])
  const origin = typeof window === 'undefined' ? undefined : window.location.origin
  const baseAsset = useMemo(() => draftAsset(scopedDraft, origin), [scopedDraft, origin])
  const assetBlocker = useMemo(() => draftAssetIssue(scopedDraft, origin), [scopedDraft, origin])
  // 사진 크기를 재는 중(fail-closed 대기)과 재지 못한 경우를 '사진 없음'과 구분한다.
  const [assetAttempt, setAssetAttempt] = useState(0)
  const measured = useMeasuredImage(baseAsset, assetAttempt)
  const asset = measured.asset
  const assetLoad = measured.status === 'measuring' ? 'loading' : measured.status === 'failed' ? 'partial' : 'ready'
  const capabilities = useMemo<ChannelCapability[]>(
    () =>
      (draft.channels ?? []).flatMap((c) =>
        c.provider === 'instagram' || c.provider === 'threads'
          ? [{ channel: c.provider, connection: c.connection === 'CONNECTED' ? 'CONNECTED' : 'UNKNOWN', canPublish: c.connection === 'CONNECTED' && c.publishPermission === 'GRANTED' } as ChannelCapability]
          : [],
      ),
    [draft],
  )
  const approvalInput = useMemo(() => draftApprovalInput(draft, preview.save === 'SAVED'), [draft, preview.save])
  const submitApproval = useMemo(() => createApprovalCommand({ missionId, workspaceId, fetchImpl }), [missionId, workspaceId, fetchImpl])
  const publish = useMemo(() => createPublishCommand({ missionId, workspaceId, fetchImpl }), [missionId, workspaceId, fetchImpl])

  if (!missionId) return <p role="alert" className="text-sm text-muted-foreground">게시할 초안을 찾지 못했어요.</p>
  if (!datasetMode) return <p role="alert" className="text-sm text-muted-foreground">화면 데이터를 확인하지 못했어요. 잠시 후 다시 열어 주세요.</p>

  /**
   * 원고 변경 저장. 클릭 1회당 정확히 1번만 나가고(더블클릭 1명령),
   * 성공 표시는 port 결과 + canonical 지문 일치일 때만이다.
   */
  const handleSaveCopy = async () => {
    if (!onSaveCopy || pending.current || preview.save === 'SAVED' || saveUncertain) return
    const ig = draft.copies?.instagram
    const th = draft.copies?.threads
    if (typeof ig?.caption !== 'string' || typeof th?.content !== 'string') {
      setSaveNotice(COPY_SAVE_MESSAGE.INVALID)
      return
    }
    const copies: ExactApprovalCopies = {
      instagram: { ...ig, caption: ig.caption } as ExactApprovalCopies['instagram'],
      threads: { ...th, content: th.content } as ExactApprovalCopies['threads'],
    }
    for (const channel of ['instagram', 'threads'] as const) {
      const entry = preview.channels[channel]
      if (!entry) continue
      if (channel === 'instagram') copies.instagram.caption = entry.copy.text
      else copies.threads.content = entry.copy.text
      if (entry.copy.cta !== '' || copies[channel].cta !== undefined) copies[channel].cta = entry.copy.cta
    }
    const controller = new AbortController()
    pending.current = controller
    const revision = preview.revision
    setSavingCopy(true)
    setSaveNotice(null)
    setPreview(beginSave(preview))
    try {
      const result = await onSaveCopy({ draft, copies, signal: controller.signal })
      if (controller.signal.aborted) return
      if (result.kind !== 'saved') {
        const reason = result.kind === 'conflict' ? 'STALE_APPROVAL' : result.kind === 'invalid' ? 'INVALID' : result.kind === 'unauthorized' ? 'UNAUTHORIZED' : 'UNKNOWN'
        setSaveUncertain(reason === 'UNKNOWN' || reason === 'STALE_APPROVAL')
        setSaveNotice(COPY_SAVE_MESSAGE[reason])
        setPreview(current => saveFailed(current))
        return
      }
      const canonical = result.draft
      const matches = canonical && typeof result.newFingerprint === 'string' && SAVED_FINGERPRINT.test(result.newFingerprint) && verifyDraftReadback({
        ...draft, missionId, workspaceId: assetWorkspaceId, copies,
        selectedImageIds: Array.isArray(draft.selectedImageIds) ? draft.selectedImageIds : [],
        approvalFingerprint: result.newFingerprint,
      }, canonical).matches
      if (!matches || !canonical) {
        setSaveUncertain(true)
        setPreview(current => saveFailed(current))
        setSaveNotice(COPY_SAVE_MESSAGE.FINGERPRINT_MISMATCH)
        return
      }
      // 지문만 교체하지 않는다. 서버가 다시 읽어 준 스냅샷 전체가 미리보기와 승인의 정본이다.
      setDraft(canonical)
      setPreview(current => ({ ...seedPreviewSet({ channels: draftSeedChannels(canonical), selected: current.selected }), revision: revision + 1 }))
      setStep('PREVIEW')
    } catch {
      if (!controller.signal.aborted) {
        setPreview(current => saveFailed(current))
        setSaveUncertain(true)
        setSaveNotice(COPY_SAVE_MESSAGE.UNKNOWN)
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setSavingCopy(false)
    }
  }

  // 외부 게시는 연결이 확인될 때만 시작한다. 오프라인이면 서버도 부르지 않고, 큐에 쌓지 않는다.
  const handlePublish = async () => {
    setBlockedMessage(null)
    setPublishing(true)
    const outcome = await runExternalWrite('publish', missionId, publish)
    setPublishing(false)
    if (!outcome.ran) {
      setBlockedMessage(outcome.decision.message)
      return
    }
    setResult(outcome.value)
    setStep('RESULT')
  }

  /**
   * 승인·게시는 실제 워크스페이스 데이터에서만 연다.
   * 예시(`SHOWCASE_DEMO`)·시험(`TEST`) 초안은 화면만 보여 주고, 서버 승인/게시 명령을
   * 보내는 길을 아예 만들지 않는다(화면 라벨과 실제 실행이 어긋나지 않게).
   */
  const executable = datasetMode === 'ACTUAL'

  if (!executable || step === 'PREVIEW') {
    return (
      <div className="space-y-3">
      <PreviewSetView
        asset={asset}
        datasetMode={datasetMode}
        assetBlocker={assetBlocker}
        // 크기를 재는 동안은 '사진이 아직 없어요'가 아니라 확인 중으로 보여 준다.
        load={assetLoad}
        state={preview}
        capabilities={capabilities}
        onChange={next => { if (!pending.current) setPreview(next) }}
        onRetry={measured.status === 'failed' ? () => setAssetAttempt((value) => value + 1) : undefined}
        onReview={executable && capabilities.some(c => c.canPublish) ? () => setStep('APPROVAL') : undefined}
        readOnly={!onSaveCopy}
        readOnlyMessage="현재 문구 수정·저장 기능을 준비 중이에요. 지금은 원문을 확인할 수 있어요."
        onSaveCopy={executable && onSaveCopy && !saveUncertain ? () => void handleSaveCopy() : undefined}
        savingCopy={savingCopy}
        saveNotice={saveNotice}
        savedOnlyManual={Boolean(onSaveCopy)}
      />
      {saveUncertain ? <Link className="inline-flex min-h-11 items-center underline" href={`/app/work/new?post=${encodeURIComponent(missionId)}`}>내 수정 대신 최신 저장본 다시 열기</Link> : null}
      </div>
    )
  }

  if (step === 'APPROVAL' || step === 'APPROVED') {
    return (
      <div className="space-y-4">
        <ApprovalReviewView
          input={approvalInput}
          imageUrlFor={(id) => (asset && asset.assetId === id ? asset.imageUrl : null)}
          onSubmit={async (request) => {
            await submitApproval(request)
            setStep('APPROVED')
          }}
        />
        {step === 'APPROVED' ? (
          <div className="space-y-2">
            <Button className="min-h-11 w-full" disabled={publishing} onClick={handlePublish}>
              {publishing ? '게시 요청 중' : '지금 게시하기'}
            </Button>
            {blockedMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {blockedMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const outcome = result?.kind === 'RESULT' ? result.outcome : { overallStatus: 'FAILED' as const, receipts: { instagram: { channel: 'instagram' as const, stage: 'RESULT_UNKNOWN' as const } } }
  return (
    <div className="space-y-3">
      <ResultScreenView
        input={{
          outcome: deriveFirstPostOutcome(outcome),
          evidence: Object.fromEntries(approvalInput.targets.map((t) => [t.channel, { approvedHandle: t.handle || null }])),
        }}
      />
      {/* 화면을 닫아도 같은 증거를 다시 열 수 있는 경로(M08 상세). 새 조회일 뿐 새 게시가 아니다. */}
      <Link
        href={`/app/outcome/${encodeURIComponent(missionId)}`}
        className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
      >
        게시 결과 상세 열기
      </Link>
    </div>
  )
}
