/**
 * 첫 10분 여정 통합 테스트 (ANI-1734).
 *
 * 정본: `docs/mobile-r2/01-onboarding-creative-chat.md` M05 → M06 → M12 → M07 → M08
 *
 * 화면을 렌더하지 않고 **단계 사이 계약**을 이어 붙인다. 서버 응답(초안 DTO·승인 응답·
 * 실행 영수증 DTO)은 주입하고 네트워크는 막아 둔다. 즉 여기서 보증하는 것은
 * "각 단계의 순수 계약이 앞 단계 결과를 그대로 받아 fail-closed 로 이어진다"이며,
 * 실제 Supabase·provider write·실기기 동작은 이 테스트의 범위가 아니다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPROVAL_PHRASE } from './approval-gate'
import {
  APPROVAL_BLOCKER_MESSAGE,
  APPROVAL_CTA,
  approvalContentKey,
  buildApprovalReview,
  createApprovalRequester,
  type ApprovalBinding,
  type ApprovalCopy,
  type ApprovalReviewInput,
  type ApprovalSubmission,
  type ApprovalTarget,
} from './approval-review'
import {
  draftApprovalInput,
  draftAsset,
  draftDatasetMode,
  draftSeedChannels,
  type DraftDto,
} from './draft-mapper'
import {
  applySaveOutcome,
  beginSave,
  conflictRows,
  createEditSession,
  editInstagram,
  resolveConflict,
  saveBlockedReason,
} from './edit-session'
import {
  canProceed,
  confirmFact,
  nextFactField,
  seedConfirmedFacts,
  skipFact,
  submitFactAnswer,
  unaskedFields,
  usableFactValues,
} from './facts'
import {
  beginSave as beginCopySave,
  canReview,
  editChannelCopy,
  needsLeaveConfirmation,
  previewActions,
  previewBlockers,
  previewFingerprint,
  previewFrame,
  publishableChannels,
  saveSucceeded,
  seedPreviewSet,
  toChannelCapability,
  connectionBadge,
  type PreviewAsset,
  type PreviewSetState,
} from './preview-set'
import { deriveFirstPostOutcome, type OutcomeInput } from './publish-outcome'
import { toOutcomeReceipts } from './execute-status-adapter'
import { buildResultScreen, type ResultScreenInput } from './result-screen'
import type { Copies } from './revision-conflict'

/* ------------------------------------------------------------------ */
/* 픽스처 — 서버가 주는 값만 쓴다                                     */
/* ------------------------------------------------------------------ */

const ORIGIN = 'https://example.com'
const WORKSPACE = 'w_byreum'
const ASSET = 'asset_01'
const CTA = '프로필 링크에서 예약'
/** 공백·줄바꿈을 일부러 흐트러뜨린다. 어느 단계도 정규화하면 안 된다. */
const CAPTION = '10월 시술 오픈 🌿\n예약은  프로필 링크에서  '
const EDITED_CAPTION = '10월 시술 오픈 🌿\n예약은  DM 주세요  '
const REVISED_CAPTION = '10월 시술 오픈 🌿\n예약은  전화 주세요  '
const OTHER_DEVICE_CAPTION = '다른 기기에서 고친 인스타그램 문구'
const OTHER_DEVICE_THREADS = '다른 기기에서 고친 스레드 문구'
const THREADS = '10월 시술 오픈 소식'
const VERIFIED_AT = '2026-10-24T01:05:00.000Z'
const PERMALINK = 'https://www.instagram.com/p/ABC123/'

const SERVER_DRAFT: DraftDto = {
  datasetMode: 'ACTUAL',
  missionId: 'mission_01',
  workspaceId: WORKSPACE,
  copies: {
    instagram: { caption: CAPTION, cta: CTA },
    threads: { content: THREADS, cta: CTA },
  },
  selectedImageIds: [ASSET],
  mediaPreviews: [{ id: ASSET, url: `/api/workspaces/${WORKSPACE}/media/${ASSET}`, width: 1080, height: 1350 }],
  rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  channels: [
    { provider: 'instagram', handle: '@byreum', connection: 'CONNECTED', publishPermission: 'GRANTED' },
    { provider: 'threads', handle: '@byreum', connection: 'CONNECTED', publishPermission: 'GRANTED' },
  ],
  approvalFingerprint: 'srv_fp_v1',
  costQuote: { amountKrw: 1200, source: 'SERVER_QUOTE' },
  executionSurface: 'MOBILE_OK',
  knowledgeSnapshot: { businessName: '바이름' },
}

const SERVER_COPIES_V1: Copies = {
  instagram: { caption: CAPTION, hashtags: ['#바이름', '#10월'] },
  threads: { content: THREADS },
}

/** 다른 기기가 먼저 저장한 정본. 인스타그램 문구와 스레드 문구가 모두 다르다. */
const SERVER_COPIES_V2: Copies = {
  instagram: { caption: OTHER_DEVICE_CAPTION, hashtags: ['#바이름', '#10월'] },
  threads: { content: OTHER_DEVICE_THREADS },
}

/* ------------------------------------------------------------------ */
/* 여정 실행 — M05 → M06 → M12 → M07                                   */
/* ------------------------------------------------------------------ */

function buildJourney() {
  /* ---- M05 사실 확인 ---- */
  const factsSeeded = seedConfirmedFacts({ price: '30,000원', menu: '10월 시술 A', hours: '   ' })
  const unaskedAtStart = unaskedFields(factsSeeded)
  const nextFieldAtStart = nextFactField(factsSeeded)

  // 답변은 곧바로 정본이 되지 않는다(PROPOSED).
  const priceProposal = submitFactAnswer(factsSeeded, 'price', '40,000원')
  if (!priceProposal.ok) throw new Error(`가격 제안 거절: ${priceProposal.reason}`)
  const usableWhileProposed = usableFactValues(priceProposal.state)

  const priceConfirmed = confirmFact(priceProposal.state, 'price')
  if (!priceConfirmed.ok) throw new Error(`가격 확인 실패: ${priceConfirmed.reason}`)

  const hoursProposal = submitFactAnswer(priceConfirmed.state, 'hours', '매일 10:00–19:00')
  if (!hoursProposal.ok) throw new Error(`영업시간 제안 거절: ${hoursProposal.reason}`)
  const canProceedBeforeSkip = canProceed(hoursProposal.state)

  const hoursConfirmed = confirmFact(hoursProposal.state, 'hours')
  if (!hoursConfirmed.ok) throw new Error(`영업시간 확인 실패: ${hoursConfirmed.reason}`)

  const skippedEvent = skipFact(hoursConfirmed.state, 'eventPeriod')
  if (!skippedEvent.ok) throw new Error(`이벤트 기간 건너뜀 실패: ${skippedEvent.reason}`)
  const skippedContact = skipFact(skippedEvent.state, 'contact')
  if (!skippedContact.ok) throw new Error(`연락 방법 건너뜀 실패: ${skippedContact.reason}`)
  const facts = skippedContact.state

  /* ---- M06 미리보기 ---- */
  const datasetMode = draftDatasetMode(SERVER_DRAFT)
  const asset = draftAsset(SERVER_DRAFT, ORIGIN)
  const blockers = previewBlockers(asset, datasetMode ?? 'ACTUAL')
  const frame = asset ? previewFrame(asset, datasetMode ?? 'ACTUAL') : null

  const preview = seedPreviewSet({ channels: draftSeedChannels(SERVER_DRAFT) })
  const fingerprintAtSeed = previewFingerprint(preview)
  const publishable = publishableChannels(preview)

  const copyEdit = editChannelCopy(preview, 'instagram', { text: EDITED_CAPTION })
  if (!copyEdit.ok) throw new Error(`원고 편집 거절: ${copyEdit.reason}`)
  const previewEdited: PreviewSetState = copyEdit.state

  const previewSaving = beginCopySave(previewEdited)
  const previewStaleAck = saveSucceeded(previewSaving, 0)
  const previewSaved = saveSucceeded(beginCopySave(previewEdited), previewEdited.revision)

  const granted = toChannelCapability({ channel: 'instagram', connection: 'CONNECTED', publishPermission: 'GRANTED' })
  const uncertain = toChannelCapability({ channel: 'instagram', connection: 'CONNECTED', publishPermission: 'UNKNOWN' })

  /* ---- M12 전체화면 편집 / 충돌 ---- */
  const sessionStart = createEditSession({ copies: SERVER_COPIES_V1, revision: 7 })
  const sessionEdited = editInstagram(sessionStart, { caption: EDITED_CAPTION })
  if (!sessionEdited.ok) throw new Error(`M12 편집 거절: ${sessionEdited.reason}`)

  const saveBegin = beginSave(sessionEdited.state)
  if (!saveBegin.ok) throw new Error(`저장 시작 거절: ${saveBegin.reason}`)

  // 다른 기기가 먼저 저장 → 409.
  const conflicted = applySaveOutcome(saveBegin.state, {
    kind: 'CONFLICT',
    serverRevision: 8,
    server: SERVER_COPIES_V2,
  })
  if (!conflicted.ok) throw new Error(`충돌 적용 거절: ${conflicted.reason}`)

  const conflict = conflicted.state.conflict
  if (!conflict) throw new Error('충돌 시트가 만들어지지 않았다')
  const rows = conflictRows(conflict)
  const partialResolve = resolveConflict(conflicted.state, { 'instagram.caption': 'LOCAL' })

  const merged = resolveConflict(conflicted.state, {
    'instagram.caption': 'LOCAL',
    'threads.content': 'SERVER',
  })
  if (!merged.ok) throw new Error(`병합 거절: ${merged.reason}`)

  const mergedSaveBegin = beginSave(merged.state)
  if (!mergedSaveBegin.ok) throw new Error(`병합 후 저장 시작 거절: ${mergedSaveBegin.reason}`)
  const mergedSaved = applySaveOutcome(mergedSaveBegin.state, {
    kind: 'SAVED',
    revision: 9,
    copies: merged.state.copies,
  })
  if (!mergedSaved.ok) throw new Error(`병합 저장 거절: ${mergedSaved.reason}`)

  /* ---- M07 승인 ---- */
  const draftInput = draftApprovalInput(SERVER_DRAFT, true)
  const screenCopies: ApprovalCopy[] = [
    { channel: 'instagram', text: mergedSaved.state.copies.instagram.caption, cta: CTA },
    { channel: 'threads', text: mergedSaved.state.copies.threads.content, cta: CTA },
  ]
  const approvalInput: ApprovalReviewInput = { ...draftInput, copies: screenCopies }
  const reviewBeforeApproval = buildApprovalReview(approvalInput)

  const approvedBinding: ApprovalBinding = {
    fingerprint: approvalInput.serverFingerprint ?? '',
    contentKey: reviewBeforeApproval.contentKey,
  }
  const reviewApproved = buildApprovalReview({ ...approvalInput, approved: approvedBinding })

  // 승인 뒤 원고를 또 고치면 다시 승인해야 한다.
  const revisedInput: ApprovalReviewInput = {
    ...approvalInput,
    copies: [
      { channel: 'instagram', text: REVISED_CAPTION, cta: CTA },
      { channel: 'threads', text: mergedSaved.state.copies.threads.content, cta: CTA },
    ],
  }
  const reviewStale = buildApprovalReview({ ...revisedInput, approved: approvedBinding })

  // 화면은 그대로인데 서버 초안 지문만 바뀐 경우 — 덮어쓰지 않고 다시 불러오게 한다.
  const reviewMismatch = buildApprovalReview({
    ...revisedInput,
    serverFingerprint: 'srv_fp_v2',
    approved: { fingerprint: 'srv_fp_v1', contentKey: approvalContentKey(revisedInput) },
  })

  return {
    facts: {
      seeded: factsSeeded,
      unaskedAtStart,
      nextFieldAtStart,
      usableWhileProposed,
      canProceedBeforeSkip,
      final: facts,
      usable: usableFactValues(facts),
    },
    preview: {
      datasetMode,
      asset,
      blockers,
      frame,
      seed: preview,
      fingerprintAtSeed,
      publishable,
      edited: previewEdited,
      saving: previewSaving,
      staleAck: previewStaleAck,
      saved: previewSaved,
      granted,
      uncertain,
    },
    edit: {
      start: sessionStart,
      edited: sessionEdited.state,
      saveRequest: saveBegin.request,
      conflicted: conflicted.state,
      rows,
      partialResolve,
      merged: merged.state,
      mergedSaveRequest: mergedSaveBegin.request,
      mergedSaved: mergedSaved.state,
    },
    approval: {
      input: approvalInput,
      beforeApproval: reviewBeforeApproval,
      approved: reviewApproved,
      binding: approvedBinding,
      revisedInput,
      stale: reviewStale,
      mismatch: reviewMismatch,
    },
  }
}

/* ------------------------------------------------------------------ */
/* M08 결과 화면 헬퍼                                                  */
/* ------------------------------------------------------------------ */

const APPROVED_HANDLE = '@byreum'

function screenFor(
  rawReceipts: unknown,
  overallStatus: OutcomeInput['overallStatus'],
  extra: Partial<ResultScreenInput> = {},
) {
  const { receipts, invalid } = toOutcomeReceipts(rawReceipts)
  const outcome = deriveFirstPostOutcome({ overallStatus, receipts })
  const screen = buildResultScreen({
    outcome,
    evidence: { instagram: { approvedHandle: APPROVED_HANDLE, readbackAccount: 'byreum' } },
    ...extra,
  })
  return { receipts, invalid, outcome, screen }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(() => {
    throw new Error('첫 10분 여정 계약은 네트워크를 쓰지 않는다')
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* 여정                                                               */
/* ------------------------------------------------------------------ */

describe('첫 10분 여정 · M05 사실 확인', () => {
  const { facts } = buildJourney()

  it('누락된 사실만 묻고, 확인 전 값은 홍보 문구에 쓰지 않는다', () => {
    expect(facts.unaskedAtStart).toEqual(['hours', 'eventPeriod', 'contact'])
    expect(facts.nextFieldAtStart).toBe('hours')
    // 가격 답변은 제안(PROPOSED)일 뿐, 원고 재료가 되지 않는다.
    // 제안이 확인을 기다리는 동안에는 이전 확정 가격도 쓰지 않는다(바뀔 값으로 원고를 만들지 않음).
    expect(facts.usableWhileProposed.price).toBeUndefined()
    expect(facts.usableWhileProposed.menu).toBe('10월 시술 A')
  })

  it('확인과 건너뜀을 모두 거쳐야 다음 단계로 간다', () => {
    expect(facts.canProceedBeforeSkip).toBe(false)
    expect(canProceed(facts.final)).toBe(true)
    expect(nextFactField(facts.final)).toBeNull()
    expect(facts.usable).toEqual({ price: '40,000원', menu: '10월 시술 A', hours: '매일 10:00–19:00' })
  })
})

describe('첫 10분 여정 · M06 미리보기', () => {
  const { preview } = buildJourney()

  it('서버 초안의 실제 자산으로만 미리보기를 만든다', () => {
    expect(preview.datasetMode).toBe('ACTUAL')
    const asset = preview.asset as PreviewAsset
    expect(asset.assetId).toBe(ASSET)
    expect(asset.rights).toBe('CONFIRMED')
    expect(preview.blockers).toEqual([])
    expect(preview.frame).toEqual({ aspectRatio: 1080 / 1350, fit: 'CONTAIN' })
    expect(preview.publishable).toEqual(['instagram', 'threads'])
    expect(canReview(preview.seed)).toBe(true)
  })

  it('승인 지문은 화면 원문 그대로 — 공백·줄바꿈을 정규화하지 않는다', () => {
    // 지문은 JSON 직렬화라 줄바꿈은 `\n` 두 글자로 들어간다. 공백은 원문 그대로 남는다.
    expect(preview.fingerprintAtSeed).toContain('예약은  프로필 링크에서  ')
    expect(preview.fingerprintAtSeed).toContain('\\n')
    expect(preview.fingerprintAtSeed).toContain(CTA)
  })

  it('편집은 저장 대기로 표시되고, 저장 확인은 같은 revision 일 때만 SAVED 가 된다', () => {
    expect(preview.edited.save).toBe('DIRTY')
    expect(preview.edited.revision).toBe(preview.seed.revision + 1)
    expect(preview.saving.save).toBe('SAVING')
    expect(preview.staleAck.save).toBe('DIRTY')
    expect(preview.saved.save).toBe('SAVED')
    expect(needsLeaveConfirmation(preview.edited, 'BACK')).toBe(true)
    expect(needsLeaveConfirmation(preview.edited, 'SWITCH_CHANNEL')).toBe(false)
  })

  it('연결은 됐지만 게시 권한이 불확실하면 게시하기를 열지 않는다', () => {
    expect(connectionBadge(preview.granted).verified).toBe(true)
    expect(connectionBadge(preview.uncertain).verified).toBe(false)

    const grantedActions = previewActions([preview.granted])
    expect(grantedActions.publishEnabled).toBe(true)
    expect(grantedActions.actions).toContain('PUBLISH')

    const fallback = previewActions([preview.uncertain])
    expect(fallback.publishEnabled).toBe(false)
    expect(fallback.actions).not.toContain('PUBLISH')
    expect(fallback.manualFallback).toEqual(['SAVE', 'COPY', 'DOWNLOAD'])
    expect(fallback.connectProposal).toEqual(['instagram'])
  })
})

describe('첫 10분 여정 · M12 편집 충돌', () => {
  const { edit } = buildJourney()

  it('구버전 기준 저장은 덮어쓰지 않고 필드별 비교를 돌려준다', () => {
    expect(edit.saveRequest.expectedRevision).toBe(7)
    expect(edit.saveRequest.copies.instagram.caption).toBe(EDITED_CAPTION)
    expect(edit.conflicted.save).toBe('DIRTY')
    expect(edit.rows.map((row) => row.label)).toEqual(['인스타그램 문구', '스레드 문구'])
    expect(edit.rows[0].local).toBe(EDITED_CAPTION)
    expect(edit.rows[0].server).toBe(OTHER_DEVICE_CAPTION)
  })

  it('모든 필드에 선택이 끝나기 전에는 병합하지 않는다', () => {
    expect(edit.partialResolve.ok).toBe(false)
    if (edit.partialResolve.ok) throw new Error('일부 필드만 고른 병합이 통과했다')
    expect(edit.partialResolve.reason).toBe('UNRESOLVED_FIELDS')
    expect(edit.partialResolve.fields).toEqual(['threads.content'])
  })

  it('병합 뒤에는 새 기준 revision 으로 저장하고, 저장 확인 뒤에는 다시 저장할 수 없다', () => {
    expect(edit.merged.conflict).toBeNull()
    expect(edit.merged.copies.instagram.caption).toBe(EDITED_CAPTION)
    expect(edit.merged.copies.threads.content).toBe(OTHER_DEVICE_THREADS)
    expect(edit.merged.save).toBe('DIRTY')

    expect(edit.mergedSaveRequest.expectedRevision).toBe(8)
    expect(edit.mergedSaved.save).toBe('SAVED')
    expect(edit.mergedSaved.baseRevision).toBe(9)
    expect(saveBlockedReason(edit.mergedSaved)).toBe('NOTHING_TO_SAVE')
  })

  it('충돌 시트가 떠 있는 동안에는 편집을 받지 않는다', () => {
    const blocked = editInstagram(edit.conflicted, { caption: '또 고침' })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) throw new Error('충돌 중 편집이 통과했다')
    expect(blocked.reason).toBe('CONFLICT_PENDING')
  })
})

describe('첫 10분 여정 · M07 승인', () => {
  const { approval } = buildJourney()

  it('확인된 값만 모이면 승인 CTA 가 열리고, 승인 화면은 저장된 원고를 그대로 보여준다', () => {
    expect(approval.beforeApproval.blockers).toEqual([])
    expect(approval.beforeApproval.ctaEnabled).toBe(true)
    expect(approval.beforeApproval.ctaLabel).toBe(APPROVAL_CTA)
    expect(approval.beforeApproval.cost.known).toBe(true)
    expect(approval.beforeApproval.approvalStatus).toBe('BEFORE_APPROVAL')
    expect(approval.beforeApproval.contentKey).toContain('예약은  DM 주세요  ')
    expect(approval.beforeApproval.contentKey).toContain('\\n')
    expect(approval.beforeApproval.contentKey).toContain(OTHER_DEVICE_THREADS)
  })

  it('승인한 화면과 지금 화면이 같으면 CURRENT, 고치면 STALE 로 재승인을 요구한다', () => {
    expect(approval.approved.approvalStatus).toBe('CURRENT')
    expect(approval.approved.reapprovalRequired).toBe(false)

    expect(approval.stale.approvalStatus).toBe('STALE')
    expect(approval.stale.reapprovalRequired).toBe(true)
    expect(approval.stale.contentKey).toContain('예약은  전화 주세요  ')
  })

  it('화면은 그대로인데 서버 승인 지문만 바뀌면 승인을 보내지 않고 다시 불러오게 한다', () => {
    expect(approval.mismatch.blockers).toContain('APPROVED_SNAPSHOT_MISMATCH')
    expect(approval.mismatch.ctaEnabled).toBe(false)
    expect(approval.mismatch.blockerMessages).toContain(
      APPROVAL_BLOCKER_MESSAGE.APPROVED_SNAPSHOT_MISMATCH,
    )
  })

  it('연결·권한이 불확실하면 승인 요청을 만들지 않고 수동 경로를 안내한다', async () => {
    const targets: ApprovalTarget[] = approval.input.targets.map((target) => ({
      ...target,
      connection: 'UNKNOWN',
    }))
    const blockedInput: ApprovalReviewInput = { ...approval.input, targets }
    const submit = vi.fn(async () => ({ approvalId: 'ap_should_not_exist' }))
    const requester = createApprovalRequester({ read: () => blockedInput, submit })

    const result = await requester.run()
    expect(result.kind).toBe('BLOCKED')
    if (result.kind !== 'BLOCKED') throw new Error('차단되지 않았다')
    expect(result.blockers).toContain('CHANNEL_NOT_PUBLISHABLE')
    expect(submit).not.toHaveBeenCalled()

    const review = buildApprovalReview(blockedInput)
    expect(review.ctaEnabled).toBe(false)
    expect(review.manualFallback).toEqual(['SAVE', 'COPY', 'DOWNLOAD'])
  })

  it('CTA 연타는 요청 1건이고, 서버 지문·화면 스냅샷을 그대로 실어 보낸다', async () => {
    const submissions: ApprovalSubmission[] = []
    const requester = createApprovalRequester({
      read: () => approval.revisedInput,
      submit: async (request) => {
        submissions.push(request)
        return { approvalId: 'ap_1' }
      },
    })

    const first = requester.run()
    const second = requester.run()
    const [r1, r2] = await Promise.all([first, second])

    expect(submissions).toHaveLength(1)
    expect(r1.kind).toBe('SUBMITTED')
    expect(r2.kind).toBe('SUBMITTED')
    expect(submissions[0].serverFingerprint).toBe('srv_fp_v1')
    expect(submissions[0].contentKey).toBe(approvalContentKey(approval.revisedInput))
    expect(submissions[0].imageIds).toEqual([ASSET])
    expect(submissions[0].costKrw).toBe(1200)
    expect(submissions[0].explicitPhrase).toBe(APPROVAL_PHRASE)
  })

  it('명시 승인 문구가 다르면 요청을 보내지 않는다', async () => {
    const submit = vi.fn(async () => ({ approvalId: 'ap_1' }))
    const requester = createApprovalRequester({ read: () => approval.revisedInput, submit })

    const result = await requester.run('그냥 올려줘')
    expect(result.kind).toBe('PHRASE_REQUIRED')
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('첫 10분 여정 · M08 결과', () => {
  it('독립 재조회 근거(링크+시각)가 있을 때만 게시 확인이 된다', () => {
    const { outcome, screen } = screenFor(
      [{ channel: 'instagram', status: 'VERIFIED', permalink: PERMALINK, verifiedAt: VERIFIED_AT, providerPostId: 'ig_1' }],
      'ALL_VERIFIED',
    )

    expect(outcome.channels.instagram?.state).toBe('VERIFIED')
    expect(screen.celebrate).toBe(true)
    expect(screen.cards[0].state).toBe('VERIFIED')
    expect(screen.cards[0].permalink).toBe(PERMALINK)
    expect(screen.cards[0].evidenceShown).toBe(true)
    expect(screen.completionToast).not.toBeNull()
    expect(screen.customerLink?.href).toBe(PERMALINK)
    expect(screen.firstValueEvent?.source).toBe('PROVIDER_READBACK')
    expect(screen.firstValueEvent?.at).toBe(VERIFIED_AT)
  })

  it('Provider 수락만으로는 게시 확인이 아니다', () => {
    const { outcome, screen } = screenFor(
      [{ channel: 'instagram', status: 'PROVIDER_ACCEPTED' }],
      'PARTIAL_SUCCESS',
    )

    expect(outcome.channels.instagram?.state).toBe('CHECKING')
    expect(outcome.celebrate).toBe(false)
    expect(screen.celebrate).toBe(false)
    expect(screen.title).toBe('외부 확인 중이에요')
    expect(screen.cards[0].state).toBe('CHECKING')
    expect(screen.cards[0].retryAllowed).toBe(false)
    expect(screen.firstValueEvent).toBeNull()
    expect(screen.primaryAction?.action).toBe('REFRESH')
  })

  it('VERIFIED 라도 링크 근거가 없으면 확인 중으로 내린다', () => {
    const { outcome, screen } = screenFor(
      [{ channel: 'instagram', status: 'VERIFIED', verifiedAt: VERIFIED_AT }],
      'ALL_VERIFIED',
    )

    expect(outcome.channels.instagram?.state).toBe('CHECKING')
    expect(screen.celebrate).toBe(false)
    expect(screen.cards[0].state).toBe('CHECKING')
  })

  it('RESULT_UNKNOWN 은 게시됨으로 승격하지 않고 재게시도 열지 않는다', () => {
    const { outcome, screen } = screenFor(
      [{ channel: 'instagram', status: 'RESULT_UNKNOWN' }],
      'PARTIAL_SUCCESS',
    )

    expect(outcome.channels.instagram?.state).toBe('UNKNOWN')
    expect(screen.celebrate).toBe(false)
    expect(screen.cards[0].state).toBe('UNKNOWN')
    expect(screen.cards[0].retryAllowed).toBe(false)
    expect(screen.pendingNote).not.toBeNull()
    expect(screen.firstValueEvent).toBeNull()
  })

  it('일부 채널이 미확인이면 전체 결과는 성공이 아니다', () => {
    const { outcome, screen } = screenFor(
      [
        { channel: 'instagram', status: 'VERIFIED', permalink: PERMALINK, verifiedAt: VERIFIED_AT },
        { channel: 'threads', status: 'RESULT_UNKNOWN' },
      ],
      'PARTIAL_SUCCESS',
    )

    // 서버 overallStatus 가 PARTIAL_SUCCESS 여도, 미확인 채널이 있으면 전체는 UNKNOWN 이다.
    expect(outcome.overall).toBe('UNKNOWN')
    expect(screen.overall).toBe('UNKNOWN')
    expect(screen.celebrate).toBe(false)
    expect(screen.completionToast).toBeNull()
    expect(screen.firstValueEvent).toBeNull()
    expect(screen.pendingNote).not.toBeNull()
    expect(screen.cards.map((card) => card.state)).toEqual(['VERIFIED', 'UNKNOWN'])
  })

  it('읽기 확인 불가로 실패한 채널은 재시도를 열지 않는다(중복 게시 방지)', () => {
    const { screen } = screenFor(
      [{ channel: 'instagram', status: 'MANUAL_REQUIRED', failureCause: 'READBACK_UNKNOWN' }],
      'FAILED',
    )

    expect(screen.cards[0].state).toBe('FAILED')
    expect(screen.cards[0].retryAllowed).toBe(false)
    expect(screen.cards[0].detail).toContain('중복')
    expect(screen.primaryAction?.action).toBe('REFRESH')
  })

  it('provider 가 거절한 경우에만 재시도를 연다', () => {
    const { screen } = screenFor(
      [{ channel: 'instagram', status: 'MANUAL_REQUIRED', failureCause: 'PROVIDER_REJECTED' }],
      'FAILED',
    )

    expect(screen.cards[0].state).toBe('FAILED')
    expect(screen.cards[0].retryAllowed).toBe(true)
    expect(screen.primaryAction?.action).toBe('RETRY')
  })

  it('수동 전달 기록은 게시 성공이 아니다', () => {
    const { outcome, screen } = screenFor(
      [{ channel: 'instagram', status: 'PROVIDER_ACCEPTED' }],
      'PARTIAL_SUCCESS',
      { manual: { instagram: { method: 'COPY', sentAt: '2026-10-24T01:10:00.000Z' } } },
    )

    expect(outcome.channels.instagram?.state).toBe('CHECKING')
    expect(screen.cards[0].state).toBe('MANUAL')
    expect(screen.celebrate).toBe(false)
    expect(screen.firstValueEvent).toBeNull()
    expect(screen.completionToast).toBeNull()
    expect(screen.manualNotice).not.toBeNull()
    expect(screen.cards[0].manualNotice).toContain('직접 확인')
  })

  it('승인한 계정이 아닌 곳에서 확인되면 게시 확인으로 표시하지 않는다', () => {
    const { screen } = screenFor(
      [{ channel: 'instagram', status: 'VERIFIED', permalink: PERMALINK, verifiedAt: VERIFIED_AT }],
      'ALL_VERIFIED',
      { evidence: { instagram: { approvedHandle: '@byreum', readbackAccount: 'other_shop' } } },
    )

    expect(screen.cards[0].state).toBe('UNKNOWN')
    expect(screen.celebrate).toBe(false)
    expect(screen.firstValueEvent).toBeNull()
  })

  it('해석할 수 없는 영수증은 성공으로 바꾸지 않고 버린다', () => {
    const { receipts, invalid, outcome, screen } = screenFor(
      [{ channel: 'instagram', status: 'DONE' }],
      'ALL_VERIFIED',
    )

    expect(invalid).toBe(1)
    expect(receipts).toEqual({})
    expect(outcome.overall).toBe('NOT_STARTED')
    expect(screen.celebrate).toBe(false)
    expect(screen.title).toBe('아직 게시 결과가 없어요')
  })
})

describe('첫 10분 여정 · 경계', () => {
  it('여정 어디에서도 네트워크를 호출하지 않는다', () => {
    buildJourney()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
