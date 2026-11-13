import 'server-only'
import { z } from 'zod'
import type { LearningServiceAdapters } from './service'
import type { LearningRepository } from './repository'
import { verifyLearningOwnership, type OAuthCredentialData } from './ownership'
import { fetchLearningProvider, type FetchLearningProviderInput } from './provider-fetch'
import { getLearningCapabilities } from './capabilities'
import { normalizeLearningUrl } from './identity'
import { LearningHttpError } from './http'

export type ProductionLearningOptions = {
  repository: LearningRepository
  enabled?: boolean
  now?: () => Date
  getCredential?: (workspaceId: string, platform: 'instagram' | 'threads') => Promise<OAuthCredentialData | null>
  providerFetch?: (input: FetchLearningProviderInput) => Promise<unknown>
  getQueue?: () => Promise<{ send(message: unknown): Promise<void> } | null>
}
const providerMe = z.object({ id: z.string().min(1), user_id: z.string().min(1).optional(), username: z.string().min(1) })

async function getCredential(workspaceId: string, platform: 'instagram' | 'threads'): Promise<OAuthCredentialData | null> {
  const { loadChannelCredentialByChannel } = await import('@/features/channels/credential-repository')
  const credential = await loadChannelCredentialByChannel(workspaceId, platform, undefined,
    process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? '', 'read')
  if (!credential) return null
  return { accessToken: credential.accessToken, scopes: [...credential.grantedScopes],
    providerAccountId: credential.externalAccountId, expiresAt: credential.expiresAt ?? undefined }
}

async function getQueue(): Promise<{ send(message: unknown): Promise<void> } | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    return (env as unknown as { CONVERSATION_JOBS_QUEUE?: { send(message: unknown): Promise<void> } }).CONVERSATION_JOBS_QUEUE ?? null
  } catch { return null }
}

/** Server-only production dependencies. No browser-selected adapter, token or fixture state. */
export function createProductionLearningAdapters(options: ProductionLearningOptions): LearningServiceAdapters {
  const fetchProvider = options.providerFetch ?? fetchLearningProvider
  const loadCredential = options.getCredential ?? getCredential
  const enabled = options.enabled ?? process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'
  return {
    normalizeUrl: normalizeLearningUrl,
    getCapabilities() {
      return getLearningCapabilities().map((capability) => !enabled && capability.collectionMode === 'official_api'
        ? { ...capability, collectionMode: 'blocked' as const, blockerCode: 'RELEASE_GATE_PENDING' } : capability)
    },
    async verify(source) {
      return verifyLearningOwnership(source, {
        getOAuthCredential: loadCredential,
        now: options.now,
        async fetchProviderMe(platform, accessToken) {
          const result = providerMe.parse(await fetchProvider({ provider: platform, path: '/me', accessToken,
            maxBytes: 64 * 1024, query: { fields: platform === 'instagram' ? 'id,user_id,username' : 'id,username' } }))
          return { id: result.user_id ?? result.id, username: result.username }
        },
      })
    },
    async enqueue(source, actor, kind) {
      if (!enabled) throw new LearningHttpError('CAPABILITY_BLOCKED')
      if (actor.workspaceId !== source.workspaceId || !['owner', 'manager'].includes(actor.role)) throw new LearningHttpError('FORBIDDEN')
      const queue = await (options.getQueue ?? getQueue)()
      if (!queue || typeof queue.send !== 'function') {
        if (kind === 'delete') {
          // Privacy deletion job creates a durable pending record so an outbox worker can forward it later.
          // Never return a fake completion or drop the deletion request.
          const job = await options.repository.createJob({
            workspaceId: source.workspaceId,
            sourceId: source.sourceId,
            sourceRevision: source.revision,
            kind: 'delete',
            idempotencyKey: `delete:${source.sourceId}:${source.revision}:${source.consent.revision}`,
          })
          return { jobId: job.id }
        }
        throw new LearningHttpError('UNAVAILABLE')
      }
      const job = await options.repository.createJob({ workspaceId: source.workspaceId,
        sourceId: source.sourceId, sourceRevision: source.revision, kind,
        idempotencyKey: `${kind}:${source.sourceId}:${source.revision}:${source.consent.revision}` })
      await queue.send({ schemaVersion: 2, kind: kind === 'delete' ? 'knowledge_delete' : 'knowledge_collect',
        jobId: job.id, workspaceId: source.workspaceId })
      return { jobId: job.id }
    },
  }
}
