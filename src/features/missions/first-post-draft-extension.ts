/**
 * 첫 포스팅 초안 DTO 가산 확장 (ANI-1768).
 *
 * 모바일 화면(M06~M08)이 fail-closed 로 읽는 값을 서버가 근거와 함께 채운다. 기존 필드·승인 지문은 바꾸지 않는다.
 * - `channels[].connection`: channel_connections.status 에서만. 'error'·미상은 생략.
 * - `channels[].publishPermission`: 게시 가능 판정(scope·토큰·최근 readback)이 통과했을 때만 'GRANTED'. 못 하면 생략(DENIED 로 단정하지 않는다).
 * - `costQuote`: 게시 자체는 quick-post 레인에서 크레딧을 받지 않는다(quick-post-credits.ts 주석) → 0원, source 'POLICY'.
 * - `executionSurface`: 게시는 서버가 Meta API 로 실행하므로 화면 기기와 무관 → 'MOBILE_OK'.
 * - 사진 가로·세로는 media_assets 에 컬럼이 없어 서버가 주지 않는다(화면이 실제 이미지에서 측정).
 * - 채널별 CTA 는 이 확장이 만들지 않는다. 초안 생성 단계(`first-post-cta.ts`, ANI-1775)가
 *   채널 연결·확정 지식 근거를 확인해 `copies[channel].cta` 로 이미 채워 둔다. 근거가 없으면 필드가 없다.
 */
import { isMetaChannelPublishVerified } from '@/features/quick-start/quick-post-approval-readiness'

export type DraftChannelRow = { channel: string; status: string | null }

export type FirstPostDatasetMode = 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST' | 'UNKNOWN'

export interface DraftExtensionEvidence {
  connections: readonly DraftChannelRow[]
  credentials: any[]
  receipts: any[]
  datasetMode?: FirstPostDatasetMode
  now?: number
}

type DraftLike = { channels?: ReadonlyArray<{ provider: string }> }

export function extendFirstPostDraft<T extends DraftLike>(draft: T, evidence: DraftExtensionEvidence): T & { datasetMode: FirstPostDatasetMode } & Record<string, unknown> {
  const channels = (draft.channels ?? []).map((channel) => {
    const provider = channel.provider
    const row = evidence.connections.find((c) => c.channel === provider)
    const extra: { connection?: 'CONNECTED' | 'NOT_CONNECTED'; publishPermission?: 'GRANTED' } = {}
    if (row?.status === 'connected') extra.connection = 'CONNECTED'
    else if (row?.status === 'disconnected') extra.connection = 'NOT_CONNECTED'
    if (
      (provider === 'instagram' || provider === 'threads') &&
      isMetaChannelPublishVerified(provider, evidence.credentials, evidence.receipts, evidence.now)
    ) {
      extra.publishPermission = 'GRANTED'
    }
    return { ...channel, ...extra }
  })

  const datasetMode: FirstPostDatasetMode =
    evidence.datasetMode === 'ACTUAL' ||
    evidence.datasetMode === 'SHOWCASE_DEMO' ||
    evidence.datasetMode === 'TEST'
      ? evidence.datasetMode
      : 'UNKNOWN'

  return {
    ...draft,
    channels,
    costQuote: { amountKrw: 0, source: 'POLICY' as const },
    executionSurface: 'MOBILE_OK' as const,
    datasetMode,
  }
}

/** 확장에 쓰는 근거를 읽는다. 읽기 실패는 null — 호출 측은 확장 없이(UNKNOWN) 응답한다. */
export async function readDraftExtensionEvidence(admin: any, workspaceId: string): Promise<DraftExtensionEvidence | null> {
  const [connections, credentials, receipts, registry] = await Promise.all([
    admin.from('channel_connections').select('channel,status').eq('workspace_id', workspaceId).in('channel', ['instagram', 'threads']),
    admin.from('meta_channel_credentials').select('provider,status,granted_scopes,token_expires_at,channel_connections(external_account_id)').eq('workspace_id', workspaceId),
    admin.from('channel_verification_runs').select('channel,status,read_after_write_at,created_at').eq('workspace_id', workspaceId).in('channel', ['instagram', 'threads']).in('status', ['VERIFIED', 'success']).order('created_at', { ascending: false }),
    admin.from('workspace_registry').select('dataset_mode').eq('workspace_id', workspaceId).maybeSingle(),
  ])
  if ([connections, credentials, receipts].some((r) => r.error || !Array.isArray(r.data))) return null

  let datasetMode: FirstPostDatasetMode = 'UNKNOWN'
  if (!registry?.error && registry?.data) {
    const rawMode = registry.data.dataset_mode
    if (rawMode === 'ACTUAL' || rawMode === 'SHOWCASE_DEMO' || rawMode === 'TEST') {
      datasetMode = rawMode
    } else {
      datasetMode = 'UNKNOWN'
    }
  }

  return {
    connections: connections.data,
    credentials: credentials.data,
    receipts: receipts.data,
    datasetMode,
  }
}
