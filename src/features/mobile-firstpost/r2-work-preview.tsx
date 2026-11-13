'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StateKind } from '@/components/mobile-ui'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { ShellScreen } from '@/features/mobile-shell'
import { useOnlineStatus } from '@/features/pwa/network'
import { assetScopeVerdict } from './asset-dto'
import type { DatasetMode } from './dataset-mode'
import { useMeasuredImage, type MeasuredAssetStatus } from './measured-asset'
import { PreviewSetView } from './preview-set-view'
import {
  PREVIEW_CHANNELS,
  seedPreviewSet,
  toChannelCapability,
  type AssetRights,
  type ChannelCapability,
  type ChannelConnection,
  type PreviewAsset,
  type PreviewBlocker,
  type PreviewChannel,
  type PreviewSetState,
} from './preview-set'

/**
 * M06 홍보 세트 — 실라우트(`/app/work/:id`) 배선 (ANI-1678).
 *
 * 입력은 서버가 만든 승인 스냅샷 하나뿐이다(`getApprovalPreview`). 화면은 지문·버전·
 * 사용권을 새로 만들지 않는다.
 *
 * 이 화면이 **하지 않는 일**: 게시·예약·승인 명령을 보내지 않는다. 외부 쓰기 0 이다.
 * 남는 행동은 승인 화면으로 가는 이동, 문구 복사, 사진 내려받기다. 승인 화면 이동은
 * 서버를 바꾸지 않는다(게시는 승인 뒤 M07 에서 별도로 열린다). 원고 저장은 저장 API 가
 * 생기기 전까지 사유와 함께 닫아 둔다(저장된 척 금지).
 *
 * 서버 스냅샷에 없는 값은 지어내지 않는다 — 게시 권한은 `UNKNOWN`(게시 버튼 없음),
 * 사진 크기는 브라우저가 실제 원본에서 잰다.
 */

export function isPreviewChannel(channel: ApprovalPreviewSnapshot['channel']): channel is PreviewChannel {
  return (PREVIEW_CHANNELS as readonly string[]).includes(channel)
}

/**
 * 사용권 확인 여부. 서버가 문제 코드를 달았을 때만 `UNCONFIRMED` 로 내린다.
 * 근거가 없어서 판정할 수 없으면 확인된 것으로 올리지 않는다 — 문제 코드가 붙는 경로가
 * 곧 서버의 판정 경로다(`media_rights`, `evidence`).
 */
export function snapshotRights(snapshot: ApprovalPreviewSnapshot): AssetRights {
  const blocked = snapshot.issues.some((issue) => issue.code === 'media_rights' || issue.code === 'evidence')
  return blocked ? 'UNCONFIRMED' : 'CONFIRMED'
}

/** 서버가 같은 출처 상대 경로를 주면 출처를 붙인다. 절대 주소 검증은 `previewBlockers` 몫이다. */
function absoluteMediaUrl(src: string, origin: string | null): string {
  if (!src) return ''
  return origin && src.startsWith('/') && !src.startsWith('//') ? `${origin}${src}` : src
}

/**
 * 서버가 원본 크기를 알면 그 값을 쓴다(원본 기준). 모르면 0 으로 두고 브라우저 실측에 맡긴다.
 * 0 은 크기가 아니라 '아직 모름'이고, 0 인 채로 남으면 미리보기를 그리지 않는다(fail-closed).
 */
function knownDimension(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function firstMedia(snapshot: ApprovalPreviewSnapshot): ApprovalPreviewSnapshot['media'][number] | null {
  return [...snapshot.media].sort((left, right) => left.position - right.position)[0] ?? null
}

/**
 * 스냅샷 사진 주소 판정. 실라우트는 실제 승인 스냅샷만 그리므로 `ACTUAL` 이다 —
 * 이 워크스페이스의 media 경로가 아니거나 경로의 자산 id 가 스냅샷이 고른 id 와 다르면 받지 않는다.
 * 화면에 그린 사진과 승인·게시가 묶는 사진이 어긋나지 않게 하는 지점이다.
 *
 * `datasetMode` 는 개발 하네스처럼 예시 화면을 그리는 경우에만 `ACTUAL` 이 아니다. 그때는
 * 같은 출처의 상대 경로 예시 사진이 통과하고, 화면에도 예시 라벨이 붙는다(실데이터 아님 표시).
 */
function snapshotMediaVerdict(
  snapshot: ApprovalPreviewSnapshot,
  media: ApprovalPreviewSnapshot['media'][number],
  origin: string | null,
  datasetMode: DatasetMode,
) {
  return assetScopeVerdict(media.src, {
    workspaceId: snapshot.workspaceId,
    assetId: media.id,
    origin: origin ?? undefined,
    datasetMode,
  })
}

/** 스냅샷의 첫 사진. 크기는 서버 DTO(원본 기준) 우선, 없을 때만 브라우저가 잰다. */
export function snapshotAsset(
  snapshot: ApprovalPreviewSnapshot | null,
  origin: string | null,
  datasetMode: DatasetMode = 'ACTUAL',
): PreviewAsset | null {
  if (!snapshot) return null
  const media = firstMedia(snapshot)
  if (!media) return null
  if (snapshotMediaVerdict(snapshot, media, origin, datasetMode) !== 'OK') return null
  return {
    assetId: media.id,
    imageUrl: absoluteMediaUrl(media.src, origin),
    width: knownDimension(media.width),
    height: knownDimension(media.height),
    rights: snapshotRights(snapshot),
  }
}

/**
 * 사진을 그릴 수 없을 때의 사유. 사진이 아예 없는 경우와, 주소가 이 워크스페이스 자산이
 * 아닌 경우를 화면이 구분해 안내한다(부정확한 '사진 없음' 금지). 그릴 수 있으면 `null`.
 */
export function snapshotAssetIssue(
  snapshot: ApprovalPreviewSnapshot | null,
  origin: string | null,
  datasetMode: DatasetMode = 'ACTUAL',
): PreviewBlocker | null {
  if (!snapshot) return null
  const media = firstMedia(snapshot)
  if (!media) return 'NO_ASSET'
  const verdict = snapshotMediaVerdict(snapshot, media, origin, datasetMode)
  if (verdict === 'OK') return null
  return verdict === 'INVALID_URL' ? 'INVALID_IMAGE_URL' : 'MISSING_ASSET_ID'
}

export function connectionOf(status: ApprovalPreviewSnapshot['account']['status']): ChannelConnection {
  if (status === 'connected') return 'CONNECTED'
  if (status === 'disconnected' || status === 'expired' || status === 'missing_permission' || status === 'wrong_account') {
    return 'NOT_CONNECTED'
  }
  // 연결 중·제공자 오류는 '연결 안 됨'으로 단정하지 않는다.
  return 'UNKNOWN'
}

/**
 * 이 화면이 아는 채널은 스냅샷의 채널 하나뿐이다. 다른 채널의 연결 상태를 지어내지 않는다.
 * 게시 권한은 스냅샷에 없으므로 `UNKNOWN` → `canPublish` 는 항상 false 다.
 */
export function snapshotCapabilities(snapshot: ApprovalPreviewSnapshot | null): readonly ChannelCapability[] {
  if (!snapshot || !isPreviewChannel(snapshot.channel)) return []
  return [
    toChannelCapability({
      channel: snapshot.channel,
      connection: connectionOf(snapshot.account.status),
      publishPermission: 'UNKNOWN',
    }),
  ]
}

export function snapshotIsStale(snapshot: ApprovalPreviewSnapshot | null): boolean {
  return Boolean(snapshot?.issues.some((issue) => issue.code === 'approval_stale'))
}

/** 화면 상태. 조회 실패(없음 아님)와 오프라인을 구분하고, 사진 측정 실패는 부분 표시다. */
export function previewLoad(input: {
  online: boolean
  hasSnapshot: boolean
  measurement: MeasuredAssetStatus
  stale: boolean
}): StateKind {
  if (!input.online) return 'offline'
  if (!input.hasSnapshot) return 'error'
  if (input.measurement === 'measuring') return 'loading'
  if (input.stale) return 'stale'
  if (input.measurement === 'failed') return 'partial'
  return 'ready'
}

/**
 * 서버 초안 그대로의 화면 상태. 원고는 스냅샷 본문 하나이고, CTA 는 스냅샷에 없으므로
 * 빈 값으로 둔다(화면이 문구를 지어내지 않게). 저장 상태는 '서버에서 받은 그대로'다.
 */
export function snapshotPreviewState(snapshot: ApprovalPreviewSnapshot | null): PreviewSetState {
  if (!snapshot || !isPreviewChannel(snapshot.channel)) return seedPreviewSet({ channels: [] })
  return seedPreviewSet({
    channels: [{ channel: snapshot.channel, copy: { text: snapshot.text, cta: '' } }],
    selected: snapshot.channel,
  })
}

export type R2WorkPreviewProps = Readonly<{
  /** 조회 결과. 실패는 숨기지 않고 화면이 사유를 말한다(null = 확인 실패). */
  snapshot: ApprovalPreviewSnapshot | null
  /**
   * 이 화면이 그리는 데이터의 성격. 실라우트는 실제 스냅샷이므로 기본값 `ACTUAL` 이다.
   * 개발 하네스(`/dev/mobile-r2/work-preview`)만 예시 값을 넘긴다 — 그때는 화면에 예시 라벨이
   * 붙고, 같은 출처의 예시 사진이 통과한다(실데이터가 아님을 숨기지 않는다).
   */
  datasetMode?: DatasetMode
}>

export function R2WorkPreview({ snapshot, datasetMode = 'ACTUAL' }: R2WorkPreviewProps) {
  const router = useRouter()
  const online = useOnlineStatus()
  // 스냅샷이 바뀌면 진입점이 key 로 다시 마운트한다(다른 버전의 문구가 남지 않게).
  const [state, setState] = useState<PreviewSetState>(() => snapshotPreviewState(snapshot))
  /**
   * 사진을 다시 재게 하는 세대 번호. `router.refresh()` 는 이 컴포넌트를 마운트한 채로
   * 클라이언트 상태를 보존하므로, 측정 키까지 바꿔야 '다시 확인'이 실제로 사진을 다시 잰다.
   */
  const [attempt, setAttempt] = useState(0)
  // 좁은 화면에서만 마운트되므로 window 가 있다. 없으면 상대 경로 그대로 두고 화면이 막는다.
  const origin = typeof window === 'undefined' ? null : window.location.origin
  const baseAsset = useMemo(
    () => snapshotAsset(snapshot, origin, datasetMode),
    [snapshot, origin, datasetMode],
  )
  const measured = useMeasuredImage(baseAsset, attempt)
  const capabilities = useMemo(() => snapshotCapabilities(snapshot), [snapshot])
  // 스냅샷은 채널 하나만 담는다. 화면에 없는 채널 탭을 그리면 눌러도 아무 일이 없다.
  const visibleChannels = useMemo<readonly PreviewChannel[]>(
    () => (snapshot && isPreviewChannel(snapshot.channel) ? [snapshot.channel] : []),
    [snapshot],
  )
  // 검토 CTA 는 승인 화면으로 가는 이동이다 — 이 화면에서 게시·예약 명령을 보내지 않는다.
  const reviewApproval = snapshot
    ? () => router.push(`/app/work/${encodeURIComponent(snapshot.contentId)}/approve`)
    : undefined
  const load = previewLoad({
    online,
    hasSnapshot: snapshot !== null,
    measurement: measured.status,
    stale: snapshotIsStale(snapshot),
  })

  return (
    <>
      <ShellScreen mode="DETAIL" title="홍보 세트" />
      <div className="mx-auto w-full max-w-2xl pb-6">
        <PreviewSetView
          asset={measured.asset}
          // 주소가 이 워크스페이스 자산이 아니면 '사진 없음'이 아니라 그 사유를 말한다.
          assetBlocker={snapshotAssetIssue(snapshot, origin, datasetMode)}
          datasetMode={datasetMode}
          state={state}
          capabilities={capabilities}
          load={load}
          onChange={setState}
          // 승인 화면으로 이동만 한다. 게시 명령은 이 화면에서 보내지 않는다.
          onReview={reviewApproval}
          onRetry={() => {
            setAttempt((value) => value + 1)
            router.refresh()
          }}
          visibleChannels={visibleChannels}
          // 원고 저장 API 가 없다. 고친 척하는 입력 상자를 두지 않는다.
          readOnly
        />
      </div>
    </>
  )
}
