import type { SupportedChannel } from '@/features/channels/channel-capabilities'
import type { ActionResult } from '@/lib/errors/result'
import type { UrlCollectionState, UrlSourceOwnership } from './url-source-schema'

export type UrlSourceRecord = Readonly<{
  id: string
  workspaceId: string
  channel: SupportedChannel
  ownership: UrlSourceOwnership
  url: string
  collectionState: UrlCollectionState
  lastCheckedAt?: string
  safeFailureReason?: string
}>

export type NormalizedUrlObservation = Readonly<{
  category: string
  content: string
  sourceExcerpt?: string
  sourceLocation?: string
  confidence?: number
}>

export type UrlCollectionResult = Readonly<{
  collectionState: UrlCollectionState
  observations: readonly NormalizedUrlObservation[]
  safeFailureReason?: string
}>

export type UrlSourceCollectionGateway = Readonly<{
  load(input: Readonly<{ workspaceId: string; sourceId: string }>): Promise<UrlSourceRecord | null>
  save(source: UrlSourceRecord): Promise<UrlSourceRecord>
  saveCandidates(input: Readonly<{
    workspaceId: string
    sourceId: string
    observations: readonly NormalizedUrlObservation[]
  }>): Promise<void>
}>

export type UrlSourceCollector = Readonly<{
  collect(source: UrlSourceRecord): Promise<UrlCollectionResult>
}>

const barrierStates = new Set<UrlCollectionState>([
  'connection_required',
  'file_required',
  'access_limited',
])

function failure(message: string, requestId: string): ActionResult<UrlSourceRecord> {
  return { error: { message, requestId } }
}

export async function collectKnowledgeSource(
  input: Readonly<{ workspaceId: string; sourceId: string }>,
  gateway: UrlSourceCollectionGateway,
  adapters: Partial<Record<SupportedChannel, UrlSourceCollector>>,
): Promise<ActionResult<UrlSourceRecord>> {
  const source = await gateway.load(input)
  if (!source || source.workspaceId !== input.workspaceId) {
    return failure('주소 출처를 찾을 수 없습니다.', 'knowledge-url-collection-not-found')
  }
  if (barrierStates.has(source.collectionState)) return { data: source }

  const collector = adapters[source.channel]
  if (!collector) {
    const saved = await gateway.save({
      ...source,
      collectionState: 'refresh_required',
      safeFailureReason: 'collector_unavailable',
      lastCheckedAt: new Date().toISOString(),
    })
    return { data: saved }
  }

  try {
    const collected = await collector.collect(source)
    if (barrierStates.has(collected.collectionState) && collected.observations.length > 0) {
      return failure('접근 제한 수집 결과를 저장하지 않았습니다.', 'knowledge-url-collection-invalid')
    }
    await gateway.saveCandidates({
      workspaceId: source.workspaceId,
      sourceId: source.id,
      observations: collected.observations,
    })
    const saved = await gateway.save({
      ...source,
      collectionState: collected.collectionState,
      safeFailureReason: collected.safeFailureReason,
      lastCheckedAt: new Date().toISOString(),
    })
    return { data: saved }
  } catch {
    const saved = await gateway.save({
      ...source,
      collectionState: 'refresh_required',
      safeFailureReason: 'collector_failed',
      lastCheckedAt: new Date().toISOString(),
    })
    return { data: saved }
  }
}
