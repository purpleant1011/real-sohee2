/**
 * M06 실사진 홍보 한 세트 미리보기 (ANI-1678).
 *
 * 정본: `docs/mobile-r2/05-390px-wireframes-and-ui-state-matrix.md` §3
 *       `docs/mobile-r2/01-onboarding-creative-chat.md` §M06
 *
 * 이 파일이 지키는 경계:
 * - 미리보기는 실제 asset id·원본 이미지·확인된 사용 권리가 모두 있을 때만 만들어진다.
 *   근거 없는 이미지 URL 이나 링크를 만들어 내지 않는다.
 * - 채널 원고·CTA 는 독립 버전이다. 채널 탭 이동은 편집을 잃지 않는다.
 * - 승인 지문의 재료는 **사용자가 화면에서 보는 원문 그대로**다(공백·줄바꿈 정규화 없음).
 * - AI 재작성 제안은 원고를 덮지 않는다. 수락 전에는 승인 지문·저장 상태가 바뀌지 않는다.
 * - '만들어짐'은 '게시됨'이 아니다. 이 파일의 배지는 게시 상태를 만들지 않는다.
 *   게시 여부는 M08 영수증(`publish-outcome.ts`)만 판정한다.
 * - 게시 권한이 없으면 `게시하기` 를 노출하지 않고 저장·복사·다운로드·연결 제안으로 대체한다.
 *   실제로 연결/권한이 확인되지 않은 채널은 초록 체크(`verified: true`)로 표시하지 않는다.
 *
 * 네트워크를 모른다. 저장·승인·게시 호출은 화면과 M07/M08 책임이다.
 */
import { isApprovalStale } from './approval-gate'
import { buildChannelCta } from '@/features/missions/first-post-cta'
import { isActualDataset, type DatasetMode } from './dataset-mode'

export const PREVIEW_CHANNELS = ['instagram', 'threads'] as const
export type PreviewChannel = (typeof PREVIEW_CHANNELS)[number]

export const CHANNEL_NAME: Record<PreviewChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
}

/**
 * 채널 원고 규격. 아직 공식 문서로 확인하지 않았으므로 `UNVERIFIED` 로 둔다.
 * 확인되지 않은 규격은 저장을 막지 않는다(경고만). 긴 문단 작성은 허용한다.
 */
export type SpecEvidence = 'OFFICIAL_DOC' | 'CONFIG' | 'UNVERIFIED'
export interface CopySpec {
  maxLength: number
  evidence: SpecEvidence
}

export const COPY_SPEC: Record<PreviewChannel, CopySpec> = {
  instagram: { maxLength: 2200, evidence: 'UNVERIFIED' },
  threads: { maxLength: 500, evidence: 'UNVERIFIED' },
}

export type CopyLengthVerdict =
  | { kind: 'OK'; length: number }
  | { kind: 'OVER_LIMIT'; length: number; maxLength: number; evidence: SpecEvidence }

/** 길이 초과는 표시용 판정일 뿐 저장·편집을 막지 않는다. */
export function copyLengthVerdict(channel: PreviewChannel, text: string): CopyLengthVerdict {
  const spec = COPY_SPEC[channel]
  const length = text.length
  if (length <= spec.maxLength) return { kind: 'OK', length }
  return { kind: 'OVER_LIMIT', length, maxLength: spec.maxLength, evidence: spec.evidence }
}

/* ------------------------------------------------------------------ */
/* Asset — 실제 사진에서만 미리보기를 만든다                          */
/* ------------------------------------------------------------------ */

export type AssetRights = 'CONFIRMED' | 'UNCONFIRMED'

export interface PreviewAsset {
  /** 서버가 발급한 실제 asset id. 빈 값이면 미리보기를 만들 수 없다. */
  assetId: string
  /** 원본 이미지 출처 URL. 원본 비율 유지 미리보기의 바탕이다. */
  imageUrl: string
  width: number
  height: number
  rights: AssetRights
}

export type PreviewBlocker =
  | 'NO_ASSET'
  | 'MISSING_ASSET_ID'
  | 'INVALID_IMAGE_URL'
  | 'INVALID_DIMENSIONS'
  | 'RIGHTS_UNCONFIRMED'

export const PREVIEW_BLOCKER_COPY: Record<PreviewBlocker, { label: string; detail: string }> = {
  NO_ASSET: {
    label: '사진이 아직 없어요',
    detail: '사진을 한 장 골라야 미리보기를 만들 수 있어요.',
  },
  MISSING_ASSET_ID: {
    label: '사진을 다시 불러와야 해요',
    detail: '저장된 사진 정보를 확인하지 못했어요.',
  },
  INVALID_IMAGE_URL: {
    label: '사진을 불러오지 못했어요',
    detail: '사진 주소를 확인하지 못해 미리보기를 만들 수 없어요.',
  },
  INVALID_DIMENSIONS: {
    label: '사진 크기를 확인하지 못했어요',
    detail: '원본 비율을 알 수 없어 미리보기를 만들 수 없어요.',
  },
  RIGHTS_UNCONFIRMED: {
    label: '사진 사용 확인이 필요해요',
    detail: '사용해도 되는 사진인지 확인한 뒤 미리보기를 만들 수 있어요.',
  },
}

function isHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 인라인 자리표시자만 허용한다. 예시·시험 화면에서 실제 사진 대신 쓰는
 * 생성 이미지이며, `ACTUAL` 에서는 어떤 `data:` 주소도 허용하지 않는다.
 */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;base64|;utf8|),/i

function isPreviewImageUrl(raw: unknown, datasetMode: DatasetMode): raw is string {
  if (isHttpUrl(raw)) return true
  return !isActualDataset(datasetMode) && typeof raw === 'string' && DATA_IMAGE.test(raw)
}

/**
 * 미리보기를 막는 사유 전체. 비어 있어야만 화면에 그린다.
 * `datasetMode` 는 인라인 자리표시자 허용 여부만 가른다. 실제 데이터에서는
 * http(s) 원본 주소가 아니면 그리지 않는다.
 */
export function previewBlockers(asset: PreviewAsset | null, datasetMode: DatasetMode = 'ACTUAL'): readonly PreviewBlocker[] {
  if (!asset) return ['NO_ASSET']
  const blockers: PreviewBlocker[] = []
  if (!asset.assetId.trim()) blockers.push('MISSING_ASSET_ID')
  if (!isPreviewImageUrl(asset.imageUrl, datasetMode)) blockers.push('INVALID_IMAGE_URL')
  if (!(Number.isFinite(asset.width) && Number.isFinite(asset.height) && asset.width > 0 && asset.height > 0)) {
    blockers.push('INVALID_DIMENSIONS')
  }
  if (asset.rights !== 'CONFIRMED') blockers.push('RIGHTS_UNCONFIRMED')
  return blockers
}

export function canRenderPreview(asset: PreviewAsset | null, datasetMode: DatasetMode = 'ACTUAL'): boolean {
  return previewBlockers(asset, datasetMode).length === 0
}

/** 원본 비율 유지 프레임. 잘라내지 않는다(`fit: 'CONTAIN'`). */
export function previewFrame(asset: PreviewAsset, datasetMode: DatasetMode = 'ACTUAL'): { aspectRatio: number; fit: 'CONTAIN' } | null {
  if (!canRenderPreview(asset, datasetMode)) return null
  return { aspectRatio: asset.width / asset.height, fit: 'CONTAIN' }
}

/* ------------------------------------------------------------------ */
/* 채널별 세로형 틀 — 예상 화면, 규격은 아직 확인 전 (ANI-1678)       */
/* ------------------------------------------------------------------ */

/**
 * 채널 미리보기 틀. 피드 게시물의 세로형 비율을 가정한 **예상 화면**이다.
 * 공식 문서로 확인하지 않았으므로 `UNVERIFIED` 로 남기고 화면에도 그 사실을 함께 적는다.
 *
 * 틀은 사진을 자르지 않는다. 사진은 틀 안에서 원본 비율 그대로(object-contain) 들어가고,
 * 비율이 다르면 남는 자리는 여백으로 남는다 — 세로형으로 보이려고 사진을 잘라내지 않는다.
 * 비율은 채널별로 따로 둔다. 채널 규격을 확인하면 그 채널 값만 고치면 된다.
 */
export interface ChannelFrameSpec {
  /** 틀의 가로/세로 비율. */
  aspectRatio: number
  /** 화면 표기. 예: '세로 4:5' */
  label: string
  evidence: SpecEvidence
}

export const CHANNEL_FRAME_SPEC: Record<PreviewChannel, ChannelFrameSpec> = {
  instagram: { aspectRatio: 4 / 5, label: '세로 4:5', evidence: 'UNVERIFIED' },
  threads: { aspectRatio: 4 / 5, label: '세로 4:5', evidence: 'UNVERIFIED' },
}

/** 규격 근거를 사용자 문구로. 확인된 근거면 덧붙일 말이 없다(null). */
export const FRAME_EVIDENCE_NOTE: Record<SpecEvidence, string | null> = {
  OFFICIAL_DOC: null,
  CONFIG: null,
  UNVERIFIED: '화면 비율은 아직 확인 전이에요',
}

export interface ChannelFrame {
  /** 틀의 비율. 세로형 미리보기의 바탕이다. */
  frameAspectRatio: number
  /** 사진 원본 비율. 틀 안에서 잘리지 않고 맞춰진다. */
  photoAspectRatio: number
  fit: 'CONTAIN'
  spec: ChannelFrameSpec
}

/**
 * 채널 틀 + 원본 비율. 사진을 그릴 수 없으면 틀도 만들지 않는다(빈 틀만 그리지 않음).
 * `previewFrame` 의 판정(권리·주소·크기)을 그대로 통과한 사진에만 틀을 씌운다.
 */
export function channelFrame(
  asset: PreviewAsset | null,
  channel: PreviewChannel,
  datasetMode: DatasetMode = 'ACTUAL',
): ChannelFrame | null {
  const photo = asset ? previewFrame(asset, datasetMode) : null
  if (!photo) return null
  const spec = CHANNEL_FRAME_SPEC[channel]
  return { frameAspectRatio: spec.aspectRatio, photoAspectRatio: photo.aspectRatio, fit: 'CONTAIN', spec }
}

/* ------------------------------------------------------------------ */
/* 원고 · 상태                                                        */
/* ------------------------------------------------------------------ */

export interface ChannelCopy {
  /** 화면에 보이는 원문 그대로. 공백·줄바꿈을 정규화하지 않는다. */
  text: string
  /** 채널별 독립 CTA 문구. */
  cta: string
}

export type ChannelDraftStatus = 'GENERATING' | 'DRAFT_READY'

/** 미리보기 배지. 게시 상태(`게시 확인` 등)는 이 집합에 없다. */
export type PreviewBadge = 'GENERATING' | 'DRAFT_READY' | 'EDITED'

export const PREVIEW_BADGE_LABEL: Record<PreviewBadge, string> = {
  GENERATING: '만드는 중',
  DRAFT_READY: '초안 준비',
  EDITED: '수정됨',
}

export interface ChannelPreview {
  channel: PreviewChannel
  status: ChannelDraftStatus
  /** 생성 당시 원문. '수정됨' 판정의 기준이며 사용자 편집으로 바뀌지 않는다. */
  generatedCopy: ChannelCopy
  /** 지금 화면에 보이는 원문. 사용자가 고친 값은 그대로 보존한다. */
  copy: ChannelCopy
  /** AI 재작성 제안. 수락 전에는 `copy` 를 덮지 않는다. */
  aiSuggestion: string | null
}

export type SaveState = 'DIRTY' | 'SAVING' | 'SAVED' | 'FAILED'

/** 헤더 표기. `저장됨` 은 서버 확인을 받은 `SAVED` 일 때만 나간다. */
export const SAVE_LABEL: Record<SaveState, string> = {
  DIRTY: '저장 안 됨',
  SAVING: '저장 중',
  SAVED: '저장됨',
  FAILED: '저장하지 못했어요',
}

export interface PreviewSetState {
  selected: PreviewChannel
  channels: Partial<Record<PreviewChannel, ChannelPreview>>
  save: SaveState
  /** 원고 변경 횟수. 저장 응답이 어느 시점 원고에 대한 것인지 가릴 때 쓴다. */
  revision: number
}

export interface SeedChannel {
  channel: PreviewChannel
  copy: ChannelCopy
  status?: ChannelDraftStatus
}

/** 서버가 준 초안으로 시작한다. 초기 상태는 저장된 상태다. */
export function seedPreviewSet(input: {
  channels: readonly SeedChannel[]
  selected?: PreviewChannel
}): PreviewSetState {
  const channels: Partial<Record<PreviewChannel, ChannelPreview>> = {}
  for (const seeded of input.channels) {
    const copy = { text: seeded.copy.text, cta: seeded.copy.cta }
    channels[seeded.channel] = {
      channel: seeded.channel,
      status: seeded.status ?? 'DRAFT_READY',
      generatedCopy: copy,
      copy: { ...copy },
      aiSuggestion: null,
    }
  }
  const fallback = PREVIEW_CHANNELS.find((channel) => channels[channel]) ?? 'instagram'
  const selected = input.selected && channels[input.selected] ? input.selected : fallback
  return { selected, channels, save: 'SAVED', revision: 0 }
}

export function findChannelPreview(
  state: PreviewSetState,
  channel: PreviewChannel,
): ChannelPreview | undefined {
  return state.channels[channel]
}

function sameCopy(a: ChannelCopy, b: ChannelCopy): boolean {
  return a.text === b.text && a.cta === b.cta
}

/** '수정됨' 은 생성 원문과 지금 원문을 비교해 판정한다. */
export function channelBadge(entry: ChannelPreview): PreviewBadge {
  if (entry.status === 'GENERATING') return 'GENERATING'
  return sameCopy(entry.generatedCopy, entry.copy) ? 'DRAFT_READY' : 'EDITED'
}

/** 탭 이동. 편집 내용은 채널별로 남아 있으므로 잃지 않는다. */
export function selectChannel(state: PreviewSetState, channel: PreviewChannel): PreviewSetState {
  if (state.selected === channel || !state.channels[channel]) return state
  return { ...state, selected: channel }
}

/* ------------------------------------------------------------------ */
/* 편집 · AI 제안                                                     */
/* ------------------------------------------------------------------ */

export type PreviewRejectReason =
  | 'UNKNOWN_CHANNEL'
  | 'COPY_GENERATING'
  | 'EMPTY_COPY'
  | 'EMPTY_CTA'
  | 'EMPTY_SUGGESTION'
  | 'NO_SUGGESTION'

export type PreviewMutation =
  | { ok: true; state: PreviewSetState; changed: boolean }
  | { ok: false; reason: PreviewRejectReason }

/**
 * 원고가 바뀐 경우에만 저장 대기로 표시하고 revision 을 올린다.
 * `changed` 는 "화면 원문이 바뀌었는가"를 뜻한다(제안 표시만으로는 false).
 */
function replaceCopy(state: PreviewSetState, entry: ChannelPreview, copy: ChannelCopy): PreviewSetState {
  return {
    ...state,
    channels: { ...state.channels, [entry.channel]: { ...entry, copy, aiSuggestion: null } },
    save: 'DIRTY',
    revision: state.revision + 1,
  }
}

/**
 * 사용자가 직접 고친 원문. 앞뒤 공백·줄바꿈을 포함해 입력 그대로 보존한다.
 * 빈 원고만 거절하며, 확인되지 않은 채널 길이 규격으로 저장을 막지 않는다.
 */
export function editChannelCopy(
  state: PreviewSetState,
  channel: PreviewChannel,
  patch: Partial<ChannelCopy>,
): PreviewMutation {
  const entry = state.channels[channel]
  if (!entry) return { ok: false, reason: 'UNKNOWN_CHANNEL' }
  if (entry.status === 'GENERATING') return { ok: false, reason: 'COPY_GENERATING' }

  const next: ChannelCopy = {
    text: patch.text ?? entry.copy.text,
    cta: patch.cta ?? entry.copy.cta,
  }
  if (!next.text.trim()) return { ok: false, reason: 'EMPTY_COPY' }
  // CTA는 서버 계약상 선택이다. 없는 안내 문구를 지어내거나 수동 원고 편집을 막지 않는다.
  if (sameCopy(next, entry.copy)) return { ok: true, state, changed: false }

  return { ok: true, state: replaceCopy(state, entry, next), changed: true }
}

/**
 * AI 재작성은 **제안**으로만 도착한다.
 * 원고·revison·저장 상태를 바꾸지 않으므로 승인 지문도 그대로다.
 */
export function applyAiSuggestion(
  state: PreviewSetState,
  channel: PreviewChannel,
  text: string,
): PreviewMutation {
  const entry = state.channels[channel]
  if (!entry) return { ok: false, reason: 'UNKNOWN_CHANNEL' }
  if (entry.status === 'GENERATING') return { ok: false, reason: 'COPY_GENERATING' }

  const suggestion = text.trim()
  if (!suggestion) return { ok: false, reason: 'EMPTY_SUGGESTION' }
  if (entry.aiSuggestion === suggestion) return { ok: true, state, changed: false }

  return {
    ok: true,
    changed: false,
    state: {
      ...state,
      channels: { ...state.channels, [channel]: { ...entry, aiSuggestion: suggestion } },
    },
  }
}

/** 사용자가 제안을 수락할 때만 원고가 바뀌고, 그때 승인 지문이 새로 계산된다. */
export function acceptAiSuggestion(state: PreviewSetState, channel: PreviewChannel): PreviewMutation {
  const entry = state.channels[channel]
  if (!entry) return { ok: false, reason: 'UNKNOWN_CHANNEL' }
  if (entry.status === 'GENERATING') return { ok: false, reason: 'COPY_GENERATING' }

  const suggestion = entry.aiSuggestion
  if (!suggestion) return { ok: false, reason: 'NO_SUGGESTION' }

  if (entry.copy.text === suggestion) {
    return {
      ok: true,
      changed: false,
      state: {
        ...state,
        channels: { ...state.channels, [channel]: { ...entry, aiSuggestion: null } },
      },
    }
  }
  return {
    ok: true,
    changed: true,
    state: replaceCopy(state, entry, { ...entry.copy, text: suggestion }),
  }
}

/** 제안을 버린다. 원고와 승인 지문은 그대로다. */
export function dismissAiSuggestion(state: PreviewSetState, channel: PreviewChannel): PreviewMutation {
  const entry = state.channels[channel]
  if (!entry) return { ok: false, reason: 'UNKNOWN_CHANNEL' }
  if (!entry.aiSuggestion) return { ok: false, reason: 'NO_SUGGESTION' }
  return {
    ok: true,
    changed: false,
    state: {
      ...state,
      channels: { ...state.channels, [channel]: { ...entry, aiSuggestion: null } },
    },
  }
}

/* ------------------------------------------------------------------ */
/* 승인 지문 — 사용자가 보는 원문 그대로                              */
/* ------------------------------------------------------------------ */

/** 아직 만들지 않은(GENERATING) 채널은 승인 지문에 넣지 않는다. */
export function publishableChannels(state: PreviewSetState): readonly PreviewChannel[] {
  return PREVIEW_CHANNELS.filter((channel) => {
    const entry = state.channels[channel]
    return !!entry && entry.status !== 'GENERATING' && entry.copy.text.trim().length > 0
  })
}

/**
 * 승인 지문. 채널·원고·CTA 를 정해진 순서로 담는다.
 * 원문을 정규화하지 않으므로 화면에서 본 글자와 지문이 정확히 대응한다.
 */
export function previewFingerprint(
  state: PreviewSetState,
  channels: readonly PreviewChannel[] = publishableChannels(state),
): string {
  const rows: Array<[PreviewChannel, string, string]> = []
  for (const channel of PREVIEW_CHANNELS) {
    if (!channels.includes(channel)) continue
    const entry = state.channels[channel]
    if (!entry) continue
    rows.push([channel, entry.copy.text, entry.copy.cta])
  }
  return JSON.stringify(rows)
}

export type ApprovalBadge = 'BEFORE_APPROVAL' | 'CURRENT' | 'STALE'

export const APPROVAL_BADGE_LABEL: Record<ApprovalBadge, string> = {
  BEFORE_APPROVAL: '승인 전',
  CURRENT: '승인한 내용과 같아요',
  STALE: '승인 후 문구가 바뀌었어요',
}

/** 승인 지문이 없으면 승인 전, 있으면 현재 원문과 비교한다. */
export function approvalBadge(
  approvedFingerprint: string | null,
  currentFingerprint: string,
): ApprovalBadge {
  if (!approvedFingerprint) return 'BEFORE_APPROVAL'
  return isApprovalStale({ approvedFingerprint, currentFingerprint }) ? 'STALE' : 'CURRENT'
}

/** 검토 화면으로 갈 수 있는가 = 원고가 준비된 채널이 하나 이상인가. */
export function canReview(state: PreviewSetState): boolean {
  return publishableChannels(state).length > 0
}

/* ------------------------------------------------------------------ */
/* 저장 상태 — 서버 확인 없이 '저장됨' 이 되지 않는다                 */
/* ------------------------------------------------------------------ */

export function beginSave(state: PreviewSetState): PreviewSetState {
  if (state.save === 'SAVING' || state.save === 'SAVED') return state
  return { ...state, save: 'SAVING' }
}

/** 저장 응답이 현재 revision 의 원고에 대한 것일 때만 `SAVED` 로 올린다. */
export function saveSucceeded(state: PreviewSetState, savedRevision: number): PreviewSetState {
  if (state.save !== 'SAVING') return state
  if (savedRevision !== state.revision) return { ...state, save: 'DIRTY' }
  return { ...state, save: 'SAVED' }
}

export function saveFailed(state: PreviewSetState): PreviewSetState {
  if (state.save !== 'SAVING') return state
  return { ...state, save: 'FAILED' }
}

export function hasUnsavedChanges(state: PreviewSetState): boolean {
  return state.save === 'DIRTY' || state.save === 'FAILED'
}

export type LeaveAction = 'CUT' | 'REPLACE_PHOTO' | 'BACK' | 'SWITCH_CHANNEL'

/**
 * 잘라내기·사진 교체·뒤로가기는 저장 안 된 변경이 있으면 먼저 확인한다.
 * 채널 탭 이동은 채널별 편집을 보존하므로 확인하지 않는다.
 */
export function needsLeaveConfirmation(state: PreviewSetState, action: LeaveAction): boolean {
  if (action === 'SWITCH_CHANNEL') return false
  return hasUnsavedChanges(state)
}

/* ------------------------------------------------------------------ */
/* 채널 권한 · 행동                                                   */
/* ------------------------------------------------------------------ */

export type ChannelConnection = 'CONNECTED' | 'NOT_CONNECTED' | 'UNKNOWN'
export type PublishPermission = 'GRANTED' | 'DENIED' | 'UNKNOWN'

/** 서버 DTO. 연결과 게시 권한을 따로 받는다. */
export interface ChannelCapabilityDto {
  channel: PreviewChannel
  connection: ChannelConnection
  publishPermission: PublishPermission
}

export interface ChannelCapability {
  channel: PreviewChannel
  connection: ChannelConnection
  canPublish: boolean
}

/**
 * 게시 가능 = 연결 확인 + 게시 권한 확인. 하나라도 불확실하면 fail-closed 다.
 * 연결 여부만으로 게시 권한을 추정하지 않는다.
 */
export function toChannelCapability(dto: ChannelCapabilityDto): ChannelCapability {
  return {
    channel: dto.channel,
    connection: dto.connection,
    canPublish: dto.connection === 'CONNECTED' && dto.publishPermission === 'GRANTED',
  }
}

export interface ConnectionBadge {
  label: string
  /** 초록 체크를 그릴 수 있는 유일한 근거. */
  verified: boolean
}

/** 확인되지 않은 연결/권한은 초록 체크가 아니다. */
export function connectionBadge(capability: ChannelCapability): ConnectionBadge {
  const name = CHANNEL_NAME[capability.channel]
  if (capability.connection === 'NOT_CONNECTED') return { label: `${name} 연결 필요`, verified: false }
  if (capability.connection === 'UNKNOWN') return { label: `${name} 연결 상태 확인 중`, verified: false }
  if (!capability.canPublish) return { label: `${name} 연결됨 · 게시 권한 없음`, verified: false }
  return { label: `${name} 연결됨`, verified: true }
}

export type PreviewAction =
  | 'EDIT_COPY'
  | 'REVIEW'
  | 'PUBLISH'
  | 'SAVE'
  | 'COPY'
  | 'DOWNLOAD'
  | 'CONNECT_CHANNEL'

export const PREVIEW_ACTION_LABEL: Record<PreviewAction, string> = {
  EDIT_COPY: '문구 수정',
  REVIEW: '이 내용 검토',
  PUBLISH: '게시하기',
  SAVE: '저장',
  COPY: '복사',
  DOWNLOAD: '다운로드',
  CONNECT_CHANNEL: '연결 확인',
}

export const MANUAL_FALLBACK_ACTIONS = ['SAVE', 'COPY', 'DOWNLOAD'] as const

export type ManualAction = (typeof MANUAL_FALLBACK_ACTIONS)[number]

export interface ManualActionStatus {
  enabled: boolean
  /** 비활성일 때 사용자에게 보일 사유. 활성이면 null. */
  reason: string | null
}

/**
 * 저장·복사·다운로드 가능 여부. 근거가 없으면 켜지 않고 이유를 돌려준다.
 * - 예시·시험 화면은 실제 자산이 아니므로 세 동작 모두 막는다.
 * - 저장은 원고 저장 API 가 생기기 전까지 열지 않는다(저장된 척 금지).
 */
export function manualActionStatus(
  action: ManualAction,
  ctx: { datasetMode: DatasetMode; blockers: readonly PreviewBlocker[]; hasCopy: boolean },
): ManualActionStatus {
  if (ctx.datasetMode !== 'ACTUAL') return { enabled: false, reason: '예시 화면에서는 쓸 수 없어요.' }
  if (ctx.blockers.length > 0) return { enabled: false, reason: '사진을 확인한 뒤에 쓸 수 있어요.' }
  if (action === 'SAVE') return { enabled: false, reason: '원고 저장은 아직 준비 중이에요.' }
  if (action === 'COPY' && !ctx.hasCopy) return { enabled: false, reason: '복사할 문구가 없어요.' }
  return { enabled: true, reason: null }
}

/** 클립보드에 넣을 문구: 본문 + CTA. */
export function copyPayload(copy: ChannelCopy): string {
  return copy.cta.trim() ? `${copy.text}\n\n${copy.cta}` : copy.text
}

export interface PreviewActionSet {
  actions: readonly PreviewAction[]
  publishEnabled: boolean
  /** 게시 권한이 없어 연결을 확인해야 하는 채널. */
  connectProposal: readonly PreviewChannel[]
  manualFallback: readonly (typeof MANUAL_FALLBACK_ACTIONS)[number][]
}

/**
 * 게시 권한이 하나도 없으면 `게시하기` 를 노출하지 않는다.
 * 대신 저장·복사·다운로드와 연결 제안을 남긴다.
 */
export function previewActions(capabilities: readonly ChannelCapability[]): PreviewActionSet {
  const publishEnabled = capabilities.some((capability) => capability.canPublish)
  const connectProposal = capabilities
    .filter((capability) => !capability.canPublish)
    .map((capability) => capability.channel)

  const actions: PreviewAction[] = ['EDIT_COPY', 'REVIEW']
  if (publishEnabled) {
    actions.push('PUBLISH')
    return { actions, publishEnabled, connectProposal, manualFallback: [] }
  }

  actions.push(...MANUAL_FALLBACK_ACTIONS)
  if (connectProposal.length > 0) actions.push('CONNECT_CHANNEL')
  return {
    actions,
    publishEnabled,
    connectProposal,
    manualFallback: MANUAL_FALLBACK_ACTIONS,
  }
}

/* ------------------------------------------------------------------ */
/* 고객에게 열릴 링크 — 없으면 만들지 않는다                          */
/* ------------------------------------------------------------------ */

export interface CustomerLink {
  label: string
  href: string | null
}

/**
 * 서버가 준 http(s) 링크만 노출한다.
 * 아직 없으면 주소를 지어내지 않고 준비 중 상태로 둔다.
 */
export function customerLink(raw: string | null | undefined): CustomerLink {
  if (isHttpUrl(raw)) return { label: '확인하기', href: raw }
  return { label: '링크 준비 중', href: null }
}

/* ------------------------------------------------------------------ */
/* 채널별 CTA — 서버가 확인된 사실로만 만든다 (ANI-1775)              */
/* ------------------------------------------------------------------ */

/**
 * CTA 를 만들 수 있는 채널. 아직 지원하지 않는 채널도 같은 목록에 두어
 * "왜 CTA 가 없는지"를 빈 문자열이 아니라 '지원 안 함'으로 남긴다.
 */
export const CTA_CHANNELS = ['instagram', 'threads', 'naver_blog'] as const
export type CtaChannel = (typeof CTA_CHANNELS)[number]

export const CTA_CHANNEL_NAME: Record<CtaChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
}

export type CtaSupport = 'SUPPORTED' | 'UNSUPPORTED'

/** 네이버 블로그는 모바일에서 게시 경로가 확인되지 않았다(데스크톱 커넥터 의존). CTA 를 만들지 않는다. */
export const CTA_SUPPORT: Record<CtaChannel, CtaSupport> = {
  instagram: 'SUPPORTED',
  threads: 'SUPPORTED',
  naver_blog: 'UNSUPPORTED',
}

export const CTA_SUPPORT_LABEL: Record<CtaSupport, string> = {
  SUPPORTED: '지원함',
  UNSUPPORTED: '지원 안 함',
}

/**
 * CTA 문구가 기대는 근거. 서버가 확인한 사실만 담는다.
 * - `CONNECTED_CHANNEL`: 그 채널의 계정 핸들이 연결되어 확인됨.
 * - `BUSINESS_EVIDENCE`: 확정된 대표 서비스 또는 영업시간.
 */
export type CtaBasis = 'CONNECTED_CHANNEL' | 'BUSINESS_EVIDENCE'

/** 서버가 확인해 준 사실. 확인되지 않은 값은 넘기지 않는다. */
export interface CtaFacts {
  /** 확인된 매장 이름. 없으면 CTA 를 만들지 않는다(지어내지 않음). */
  storeName: string | null
  /** 확정된 대표 서비스/메뉴. 첫 값만 쓴다. */
  signatureServices?: readonly string[] | null
  /** 확정된 영업시간. */
  operatingHours?: string | null
  /**
   * 연결이 확인된 채널(핸들 포함). 연결 근거가 없으면 CTA 를 만들지 않는다.
   * `[]` 라도 넘겨야 한다 — 채널 근거 없이 CTA 를 만드는 경로를 타입으로 막는다.
   */
  connectedChannels: readonly { provider: string; handle: string }[]
}

export type CtaRejectReason =
  | 'NO_CONNECTED_CHANNEL'
  | 'NO_STORE_NAME'
  | 'NO_BUSINESS_EVIDENCE'
  | 'CTA_TOO_LONG'

export interface ChannelCta {
  channel: CtaChannel
  support: CtaSupport
  /** 화면 표기. 미지원 채널은 '지원 안 함'. */
  supportLabel: string
  /** 근거가 있을 때만 채워진다. 미지원·근거 없음은 빈 문자열이 아니라 null 이다. */
  cta: string | null
  /** cta 가 null 인 이유. 미지원 채널은 해당 없음(null). */
  reason: CtaRejectReason | null
  basis: readonly CtaBasis[]
}

export interface CtaGeneration {
  /** 채널 순서대로. 미지원 채널도 포함해 '지원 안 함'을 남긴다. */
  perChannel: readonly ChannelCta[]
  /** `copies[channel].cta` 로 그대로 쓰는 값. 지원 채널에 근거가 있을 때만 들어간다. */
  copies: Partial<Record<PreviewChannel, { cta: string }>>
  /** CTA 를 만들지 않은 채널. */
  unsupported: readonly CtaChannel[]
}

/** 지원 여부 판정과 타입 좁히기를 한 곳에서 한다. 목록이 늘어도 규칙은 CTA_SUPPORT 하나만 본다. */
function isSupportedCtaChannel(channel: CtaChannel): channel is PreviewChannel {
  return CTA_SUPPORT[channel] === 'SUPPORTED'
}

function inline(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** 그 채널의 연결 근거(확인된 핸들)가 있는가. 최종 판정은 `buildChannelCta` 가 다시 한다. */
function hasConnectedHandle(
  channel: PreviewChannel,
  channels: readonly { provider: string; handle: string }[],
): boolean {
  return channels.some((entry) => entry?.provider === channel && inline(entry.handle).length > 0)
}

/** 확정된 대표 서비스나 영업시간이 하나라도 있는가. */
function hasBusinessEvidence(facts: CtaFacts): boolean {
  const hasService = Array.isArray(facts.signatureServices)
    && facts.signatureServices.some((service) => inline(service).length > 0)
  return hasService || inline(facts.operatingHours).length > 0
}

/** 근거가 모자란 이유. 모두 갖춘 경우에만 null 이고, 문구 길이 판정은 `buildChannelCta` 가 한다. */
function rejectReason(channel: PreviewChannel, facts: CtaFacts, storeName: string): CtaRejectReason | null {
  if (!hasConnectedHandle(channel, facts.connectedChannels)) return 'NO_CONNECTED_CHANNEL'
  if (!storeName) return 'NO_STORE_NAME'
  if (!hasBusinessEvidence(facts)) return 'NO_BUSINESS_EVIDENCE'
  return null
}

/**
 * 서버 측 CTA 생성. 근거가 없으면 문구를 만들지 않고 이유를 돌려준다.
 *
 * 채널 근거(연결된 계정 핸들)와 비즈니스 근거(대표 서비스 또는 영업시간)를 모두 갖춘 채널에만
 * CTA 를 붙인다. 문구 자체는 운영 경로와 같은 `buildChannelCta` 가 만들므로, 이 헬퍼를 쓰는
 * 화면이 확인된 근거 없이 지어낸 안내 문구를 `copies` 에 넣는 경로가 생기지 않는다.
 * 미지원 채널은 CTA 없이 '지원 안 함'으로 남긴다.
 */
export function generateChannelCtas(facts: CtaFacts): CtaGeneration {
  const storeName = typeof facts.storeName === 'string' ? facts.storeName.trim() : ''
  const connectedChannels = Array.isArray(facts.connectedChannels) ? facts.connectedChannels : []

  const perChannel = CTA_CHANNELS.map((channel): ChannelCta => {
    const support = CTA_SUPPORT[channel]
    if (!isSupportedCtaChannel(channel)) {
      return {
        channel,
        support,
        supportLabel: CTA_SUPPORT_LABEL.UNSUPPORTED,
        cta: null,
        reason: null,
        basis: [],
      }
    }
    let reason = rejectReason(channel, { ...facts, storeName, connectedChannels }, storeName)
    const cta = reason
      ? null
      : buildChannelCta(channel, {
          businessName: storeName,
          signatureServices: facts.signatureServices ?? null,
          operatingHours: facts.operatingHours ?? null,
          connectedChannels,
        })
    // 근거는 모두 갖췄는데 문구가 없으면 길이 제한에 걸린 것이다(운영 경로와 같은 판정).
    if (!reason && cta === null) reason = 'CTA_TOO_LONG'
    return {
      channel,
      support,
      supportLabel: CTA_SUPPORT_LABEL.SUPPORTED,
      cta,
      reason,
      basis: cta ? ['CONNECTED_CHANNEL', 'BUSINESS_EVIDENCE'] : [],
    }
  })

  const copies: Partial<Record<PreviewChannel, { cta: string }>> = {}
  for (const entry of perChannel) {
    if (entry.cta && entry.channel !== 'naver_blog') {
      copies[entry.channel] = { cta: entry.cta }
    }
  }

  return {
    perChannel,
    copies,
    unsupported: perChannel.filter((entry) => entry.support === 'UNSUPPORTED').map((entry) => entry.channel),
  }
}
