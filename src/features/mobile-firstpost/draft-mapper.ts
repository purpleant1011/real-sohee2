/**
 * 서버 첫 포스팅 초안(propose 응답) → M06/M07 화면 입력 (ANI-1767).
 *
 * 서버가 주지 않은 값은 지어내지 않는다. 확장 필드가 없으면 `UNKNOWN`/`null` 로 두어
 * 화면이 fail-closed(미리보기 차단·승인 CTA 비활성)로 동작하게 한다.
 * 확장 필드(`width`/`height`/`publishPermission`/`connection`/`costQuote`/`executionSurface`)는
 * 서버 DTO 확장 후에 채워진다. `cta` 는 초안 생성 단계가 채널·비즈니스 근거를 확인했을 때만
 * 내려오며(ANI-1775), 없으면 화면이 `NO_CTA` 로 승인을 막는다.
 */
import type { ApprovalReviewInput, ApprovalCost, ApprovalTarget, ExecutionSurface } from './approval-review'
import { assetScopeVerdict } from './asset-dto'
import { parseDatasetMode, type DatasetMode } from './dataset-mode'
import { PREVIEW_CHANNELS, type PreviewAsset, type PreviewBlocker, type PreviewChannel, type SeedChannel } from './preview-set'

export interface DraftChannelDto {
  provider?: unknown
  handle?: unknown
  connection?: unknown
  publishPermission?: unknown
}

export interface DraftDto {
  missionId?: unknown
  workspaceId?: unknown
  /** 서버가 선언한 데이터셋 모드. 없으면 실제 워크스페이스 초안으로 보지 않고 null(모름, fail-closed)이다. */
  datasetMode?: unknown
  copies?: {
    instagram?: { caption?: unknown; cta?: unknown }
    threads?: { content?: unknown; cta?: unknown }
  }
  selectedImageIds?: unknown
  mediaPreviews?: Array<{ id?: unknown; url?: unknown; width?: unknown; height?: unknown }>
  rights?: { rightsStatus?: unknown; consentStatus?: unknown }
  channels?: DraftChannelDto[]
  approvalFingerprint?: unknown
  costQuote?: { amountKrw?: unknown; source?: unknown }
  executionSurface?: unknown
  knowledgeSnapshot?: { businessName?: unknown }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isChannel = (v: unknown): v is PreviewChannel => PREVIEW_CHANNELS.includes(v as PreviewChannel)

function copyOf(draft: DraftDto, channel: PreviewChannel) {
  if (channel === 'instagram') return { text: str(draft.copies?.instagram?.caption), cta: str(draft.copies?.instagram?.cta) }
  return { text: str(draft.copies?.threads?.content), cta: str(draft.copies?.threads?.cta) }
}

function channelsOf(draft: DraftDto): PreviewChannel[] {
  return (draft.channels ?? []).map((c) => c.provider).filter(isChannel)
}

export function rightsConfirmed(draft: DraftDto): boolean {
  const r = draft.rights
  const owned = r?.rightsStatus === 'OWNED' || r?.rightsStatus === 'LICENSED' || r?.rightsStatus === 'USER_CONFIRMED'
  const consent = r?.consentStatus === 'CONFIRMED' || r?.consentStatus === 'NOT_APPLICABLE'
  return owned && consent
}

/** 서버가 같은 출처의 상대 경로(`/api/...`)를 주면 출처를 붙인다. 그 외는 그대로 둔다(검증은 화면 몫). */
function absoluteUrl(url: string, origin?: string): string {
  return origin && url.startsWith('/') && !url.startsWith('//') ? `${origin}${url}` : url
}

/**
 * 서버가 선언한 데이터셋 모드 (strict client).
 * - 필드 누락(undefined), null, 빈 값, 또는 모르는 값은 ACTUAL 로 승격하지 않고 null(모름, fail-closed)이다.
 * - 명시적으로 선언된 'ACTUAL', 'SHOWCASE_DEMO', 'TEST' 만 해당 모드로 판정한다.
 */
export function draftDatasetMode(draft: DraftDto): DatasetMode | null {
  return parseDatasetMode(draft.datasetMode)
}

/**
 * 첫 번째 선택 사진. id·주소가 일치하는 미리보기가 없으면 null(크기가 없으면 화면이 막는다).
 * 실제 데이터에서는 이 워크스페이스의 media 경로만 받는다(다른 워크스페이스·바깥 출처 거절).
 */
export function draftAsset(draft: DraftDto, origin?: string): PreviewAsset | null {
  const id = Array.isArray(draft.selectedImageIds) ? str(draft.selectedImageIds[0]) : ''
  const media = (draft.mediaPreviews ?? []).find((m) => str(m.id) === id)
  if (!id || !media) return null
  const datasetMode = draftDatasetMode(draft)
  if (!datasetMode) return null
  const imageUrl = absoluteUrl(str(media.url), origin)
  if (assetScopeVerdict(imageUrl, { workspaceId: str(draft.workspaceId), assetId: id, origin, datasetMode }) !== 'OK') return null
  return {
    assetId: id,
    imageUrl,
    width: typeof media.width === 'number' ? media.width : 0,
    height: typeof media.height === 'number' ? media.height : 0,
    rights: rightsConfirmed(draft) ? 'CONFIRMED' : 'UNCONFIRMED',
  }
}

/**
 * 실사진을 그릴 수 없을 때의 사유. 사진을 골랐는데 확인하지 못한 경우와
 * 아예 고르지 않은 경우를 화면이 구분할 수 있게 한다(부정확한 안내 금지).
 * 그릴 수 있으면 `null`.
 */
export function draftAssetIssue(draft: DraftDto, origin?: string): PreviewBlocker | null {
  const id = Array.isArray(draft.selectedImageIds) ? str(draft.selectedImageIds[0]) : ''
  if (!id) return 'NO_ASSET'
  const media = (draft.mediaPreviews ?? []).find((m) => str(m.id) === id)
  if (!media) return 'MISSING_ASSET_ID'
  const datasetMode = draftDatasetMode(draft)
  if (!datasetMode) return 'MISSING_ASSET_ID'
  const imageUrl = absoluteUrl(str(media.url), origin)
  const verdict = assetScopeVerdict(imageUrl, { workspaceId: str(draft.workspaceId), assetId: id, origin, datasetMode })
  if (verdict === 'OK') return null
  return verdict === 'INVALID_URL' ? 'INVALID_IMAGE_URL' : 'MISSING_ASSET_ID'
}

export function draftSeedChannels(draft: DraftDto): SeedChannel[] {
  const targets = channelsOf(draft)
  // 연결 계정이 없어도 서버가 만든 채널별 원고는 수동 활용할 수 있다. 대상 계정을 지어내지는 않는다.
  const channels = targets.length ? targets : PREVIEW_CHANNELS.filter(channel => copyOf(draft, channel).text.trim().length > 0)
  return channels.map((channel) => ({ channel, copy: copyOf(draft, channel) }))
}

function targetOf(c: DraftChannelDto): ApprovalTarget | null {
  if (!isChannel(c.provider)) return null
  return {
    channel: c.provider,
    handle: str(c.handle),
    connection: c.connection === 'CONNECTED' || c.connection === 'NOT_CONNECTED' ? c.connection : 'UNKNOWN',
    publishPermission: c.publishPermission === 'GRANTED' || c.publishPermission === 'DENIED' ? c.publishPermission : 'UNKNOWN',
  }
}

function costOf(draft: DraftDto): ApprovalCost {
  const q = draft.costQuote
  const source = q?.source === 'SERVER_QUOTE' || q?.source === 'POLICY' ? q.source : null
  if (source && typeof q?.amountKrw === 'number') return { amountKrw: q.amountKrw, source }
  return { amountKrw: null, source: 'UNKNOWN' }
}

function surfaceOf(v: unknown): ExecutionSurface {
  return v === 'MOBILE_OK' || v === 'DESKTOP_ONLY' ? v : 'UNKNOWN'
}

/** 승인 화면 입력. `saved` 는 호출 측이 저장 상태에서 정한다. */
export function draftApprovalInput(draft: DraftDto, saved: boolean): ApprovalReviewInput {
  const targets = (draft.channels ?? []).map(targetOf).filter((t): t is ApprovalTarget => t !== null)
  return {
    workspaceName: str(draft.knowledgeSnapshot?.businessName),
    targets,
    copies: targets.map((t) => ({ channel: t.channel, ...copyOf(draft, t.channel) })),
    imageIds: Array.isArray(draft.selectedImageIds) ? draft.selectedImageIds.filter((i): i is string => typeof i === 'string') : [],
    rights: rightsConfirmed(draft) ? 'CONFIRMED' : 'UNCONFIRMED',
    saved,
    cost: costOf(draft),
    executionSurface: surfaceOf(draft.executionSurface),
    serverFingerprint: str(draft.approvalFingerprint).trim() || null,
    approved: null,
  }
}
