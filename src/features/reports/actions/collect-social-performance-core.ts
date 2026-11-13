import type { WorkspaceContext } from '@/features/auth/workspace-context'
import type { MetaInsightCollection, MetaInsightMetric, MetaInsightsChannel, SocialMetricName } from '../meta-insights-provider'
import type { PublishedMetricContext, SaveMetricCollectionInput } from '../social-metric-repository'
import type { ActionResult } from '@/lib/errors/result'
import { z } from 'zod'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  publishAttemptId: z.string().uuid(),
  requestKey: z.string().uuid(),
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
}).strict().refine(
  (value) => Date.parse(value.periodEnd) >= Date.parse(value.periodStart),
  'INVALID_PERIOD',
)

export type SocialPerformanceCollectionResult = Readonly<{
  collectionId: string
  status: SaveMetricCollectionInput['status']
}>

type Credential = Readonly<{
  accessToken: string
  provider: MetaInsightsChannel
  externalAccountId: string
  expiresAt: string | null
}>

export type SocialPerformanceDependencies = Readonly<{
  authorize(workspaceId: string): Promise<WorkspaceContext | null>
  loadContext(workspaceId: string, publishAttemptId: string): Promise<PublishedMetricContext>
  loadCredential(
    workspaceId: string,
    connectionId: string,
    provider: MetaInsightsChannel,
  ): Promise<Credential>
  collect(input: Readonly<{
    channel: MetaInsightsChannel
    providerPostId: string
    accessToken: string
  }>): Promise<MetaInsightCollection>
  save(input: SaveMetricCollectionInput): Promise<Readonly<{ collectionId: string }>>
  now(): Date
}>

const supportedMetrics: Readonly<Record<MetaInsightsChannel, readonly SocialMetricName[]>> = {
  instagram: ['views', 'likes', 'comments', 'saved', 'shares'],
  threads: ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'],
}
const unsupportedMetrics: Readonly<Record<MetaInsightsChannel, readonly SocialMetricName[]>> = {
  instagram: ['visits', 'inquiries'],
  threads: ['comments', 'saved', 'visits', 'inquiries'],
}

function unavailableMetrics(
  channel: MetaInsightsChannel,
  state: 'permission_denied' | 'failed',
): readonly MetaInsightMetric[] {
  return Object.freeze([
    ...supportedMetrics[channel].map((metric) => Object.freeze({ metric, state, value: null })),
    ...unsupportedMetrics[channel].map((metric) => Object.freeze({
      metric, state: 'not_supported' as const, value: null,
    })),
  ])
}

function providerCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z0-9_]{1,120}$/u.test(code) ? code : null
}

export type CollectionStage = 'authorize' | 'loadContext' | 'loadCredential' | 'collect' | 'save'

function logStageError(stage: CollectionStage, error: unknown): string | null {
  const code = providerCode(error) ?? (
    typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string' && /^[A-Za-z0-9_]{1,120}$/u.test((error as { code: string }).code)
      ? (error as { code: string }).code
      : null
  )
  console.error('[social-performance]', { stage, code })
  return code
}

function failure(message: string): ActionResult<SocialPerformanceCollectionResult> {
  return { error: { message, requestId: 'social-performance-collect' } }
}

export async function executeSocialPerformanceCollection(
  rawInput: unknown,
  deps: SocialPerformanceDependencies,
): Promise<ActionResult<SocialPerformanceCollectionResult>> {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) return failure('채널 성과 수집 요청을 확인해 주세요.')

  try {
    let context: WorkspaceContext | null
    try {
      context = await deps.authorize(parsed.data.workspaceId)
    } catch (error) {
      logStageError('authorize', error)
      return failure('작업공간 권한을 확인하지 못했어요')
    }

    if (
      !context
      || context.workspaceId !== parsed.data.workspaceId
      || (context.role !== 'owner' && context.role !== 'manager')
    ) {
      return failure('채널 성과 수집은 작업공간 소유자와 관리자만 실행할 수 있습니다.')
    }

    let post: PublishedMetricContext
    try {
      post = await deps.loadContext(parsed.data.workspaceId, parsed.data.publishAttemptId)
    } catch (error) {
      logStageError('loadContext', error)
      return failure('게시 기록을 찾지 못했어요')
    }

    let credential: Credential
    try {
      credential = await deps.loadCredential(
        parsed.data.workspaceId,
        post.channelConnectionId,
        post.channel,
      )
    } catch (error) {
      logStageError('loadCredential', error)
      return failure('채널 연결 정보를 확인해 주세요 (채널 설정에서 다시 연결)')
    }

    const collectedAt = deps.now()
    const common = {
      workspaceId: parsed.data.workspaceId,
      publishAttemptId: parsed.data.publishAttemptId,
      requestKey: parsed.data.requestKey,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      collectedAt: collectedAt.toISOString(),
    }

    let collection: MetaInsightCollection
    try {
      collection = await deps.collect({
        channel: post.channel,
        providerPostId: post.providerPostReference,
        accessToken: credential.accessToken,
      })
    } catch (error) {
      const code = logStageError('collect', error)
      try {
        if (code === 'PERMISSION_DENIED' || code === null) {
          const saved = await deps.save({
            ...common,
            status: 'permission_denied',
            errorCode: null,
            nextAttemptAt: null,
            metrics: unavailableMetrics(post.channel, 'permission_denied'),
          })
          return { data: Object.freeze({ collectionId: saved.collectionId, status: 'permission_denied' }) }
        }
        const retryAt = new Date(collectedAt.getTime() + 15 * 60_000).toISOString()
        const saved = await deps.save({
          ...common,
          status: 'failed',
          errorCode: code,
          nextAttemptAt: retryAt,
          metrics: unavailableMetrics(post.channel, 'failed'),
        })
        return { data: Object.freeze({ collectionId: saved.collectionId, status: 'failed' }) }
      } catch (saveError) {
        logStageError('save', saveError)
        return failure('성과를 저장하지 못했어요')
      }
    }

    try {
      const status = collection.metrics.some((metric) => metric.state === 'available')
        ? 'succeeded' as const
        : 'no_data' as const
      const saved = await deps.save({
        ...common,
        status,
        errorCode: null,
        nextAttemptAt: null,
        metrics: collection.metrics,
      })
      return { data: Object.freeze({ collectionId: saved.collectionId, status }) }
    } catch (saveError) {
      logStageError('save', saveError)
      return failure('성과를 저장하지 못했어요')
    }
  } catch {
    return failure('채널 성과를 수집하지 못했습니다. 게시 결과와 연결 상태를 확인해 주세요.')
  }
}
