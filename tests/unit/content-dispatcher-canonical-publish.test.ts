import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contentDispatcher } from '@/features/tool-runtime/dispatchers/content-dispatcher'
import { SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), legacy: vi.fn(), latest: vi.fn(), byId: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({}) }))
vi.mock('@/features/publishing/canonical-publish-facade', () => ({ CanonicalPublishFacade: class { executePublish = mocks.execute } }))
vi.mock('@/features/creative/creative-bundle-store', () => ({ SupabaseCreativeBundleStore: class { getLatestBundleForVersion = mocks.latest; getBundleById = mocks.byId } }))
vi.mock('@/lib/agent-os/executors/publishing-executor', () => ({ PublishingExecutor: { executePublish: mocks.legacy } }))
const context = { workspaceId: 'workspace', actorId: 'actor', correlationId: 'turn', intentMode: 'EXECUTE' as const, isTestAccount: false }

describe('대화 게시 canonical 연결', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.latest.mockResolvedValue({ bundleId: 'bundle', workspaceId: 'workspace', versionId: 'version', channel: 'threads', bundleFingerprint: 'fingerprint', caption: '서버 원고', approvalStatus: 'APPROVED', approvedFingerprint: 'fingerprint' }); mocks.execute.mockResolvedValue({ success: true, results: { threads: { success: true, verified: false, stage: 'PROVIDER_ACCEPTED', postId: 'post', message: '접수됨' } } }) })
  it('승인된 버전의 bundle로 실행하며 원시 caption을 보내지 않는다', async () => {
    const result = await contentDispatcher.execute({ _toolName: 'publish.create', channel: 'THREADS', contentVersionId: 'version', expectedFingerprint: 'fingerprint', caption: 'untrusted' }, context)
    expect(mocks.latest).toHaveBeenCalledWith('workspace', 'version', 'threads')
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ bundleId: 'bundle', expectedFingerprint: 'fingerprint', actorUserId: 'actor' }))
    expect(mocks.legacy).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('공식 게시 완료')
    expect(result.evidence).toBeUndefined()
  })
  it('승인 proposal에 정확 버전과 지문을 보존한다', async () => {
    const result = await contentDispatcher.execute({ _toolName: 'publish.create', channel: 'THREADS', contentVersionId: 'version', expectedFingerprint: 'fingerprint', caption: '원고' }, { ...context, intentMode: 'DRAFT' })
    expect(result.proposal?.description).toBe('서버 원고')
    expect(result.proposal?.proposedValue).toMatchObject({ bundleId: 'bundle', contentVersionId: 'version', expectedFingerprint: 'fingerprint' })
  })
  it('아직 정확 승인되지 않은 묶음은 일반 대화 승인으로 우회하지 않는다', async () => {
    mocks.latest.mockResolvedValue({ bundleId: 'bundle', channel: 'threads', bundleFingerprint: 'fingerprint', approvalStatus: 'PENDING' })
    const result = await contentDispatcher.execute({ _toolName: 'publish.create', channel: 'THREADS', contentVersionId: 'version', expectedFingerprint: 'fingerprint' }, { ...context, intentMode: 'DRAFT' })
    expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
    expect(result.proposal).toBeUndefined()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('capability는 실제 구현된 두 채널만 광고한다', () => {
    const capability = SOHEE_CAPABILITY_REGISTRY['publish.create']
    expect(capability.supportedChannels).toEqual(['INSTAGRAM', 'THREADS'])
    expect(capability.parametersSchema.properties.channel.enum).toEqual(['INSTAGRAM', 'THREADS'])
  })
  it('bundle만 주어져도 proposal 버전과 제어 epoch를 서버 묶음 기준으로 보존한다', async () => {
    mocks.byId.mockResolvedValue(await mocks.latest())
    const result = await contentDispatcher.execute({ _toolName: 'publish.create', channel: 'THREADS', bundleId: 'bundle', expectedFingerprint: 'fingerprint', workerObservedEpoch: 3 }, { ...context, intentMode: 'DRAFT' })
    expect(result.proposal?.proposedValue).toMatchObject({ contentVersionId: 'version', workerObservedEpoch: 3 })
  })
  it('명시된 버전과 다른 bundle로 게시하지 않는다', async () => {
    mocks.byId.mockResolvedValue({ ...(await mocks.latest()), versionId: 'other-version' })
    const result = await contentDispatcher.execute({ _toolName: 'publish.create', channel: 'THREADS', contentVersionId: 'version', bundleId: 'bundle', expectedFingerprint: 'fingerprint' }, context)
    expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('정확 원고가 없으면 레거시 게시 대신 원고 준비 경로를 안내한다', async () => {
    const result = await contentDispatcher.execute({ _toolName: 'publish.create', channel: 'THREADS', caption: '원고' }, context)
    expect(mocks.legacy).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
    expect(result.data).toMatchObject({ reviewHref: '/app/work/new' })
  })
})
