import {
  type Capability,
  LearningError,
  type LearningPlatform,
  type LearningSource,
  type RegisterLearningSourceInput,
  registerLearningSourceSchema,
} from './contracts'
import type { LearningRepository } from './repository'

export type ChannelIdentityNormalizer = (
  platform: LearningPlatform,
  url: string,
) => { canonicalUrl: string; canonicalIdentity: string }

export type CapabilityResolver = () => readonly Capability[]

export type SourceServiceDependencies = Readonly<{
  repository: LearningRepository
  normalizeUrl: ChannelIdentityNormalizer
  getCapabilities: CapabilityResolver
}>

export async function registerLearningSource(
  actor: { userId: string; workspaceId: string; role: string },
  input: RegisterLearningSourceInput,
  deps: SourceServiceDependencies,
): Promise<LearningSource> {
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new LearningError('FORBIDDEN', '채널을 등록할 권한이 없습니다.')
  }

  const parsed = registerLearningSourceSchema.safeParse(input)
  if (!parsed.success) {
    throw new LearningError('INVALID_INPUT', '입력값이 올바르지 않습니다.')
  }

  const capabilities = deps.getCapabilities()
  const capability = capabilities.find((cap) => cap.platform === parsed.data.platform)
  if (!capability || capability.collectionMode === 'blocked' || capability.blockerCode !== null) {
    throw new LearningError('CAPABILITY_BLOCKED', '현재 지원되지 않거나 차단된 채널입니다.')
  }

  const normalized = deps.normalizeUrl(parsed.data.platform, parsed.data.url)

  return deps.repository.registerSource({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    platform: parsed.data.platform,
    canonicalUrl: normalized.canonicalUrl,
    canonicalIdentity: normalized.canonicalIdentity,
    consent: parsed.data.consent,
  })
}
