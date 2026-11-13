import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { filteredTableUpdate } from '../../../tests/helpers/filtered-table-update'
import { MissionPublishReviewService } from './mission-publish-review'

const scope = { workspaceId: 'workspace-1', missionId: 'mission-1', runId: 'run-1', contentId: 'content-1', versionId: 'version-1' }
const actorId = 'reviewer-1'
const preview: ApprovalPreviewSnapshot = {
  workspaceId: scope.workspaceId, contentId: scope.contentId, versionId: scope.versionId,
  versionNumber: 1, fingerprint: 'a'.repeat(64), channel: 'instagram',
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  account: { connectionId: 'connection-1', label: '@shop', status: 'connected' },
  caption: '매장 소식', hashtags: [], disclosure: 'AI 보조 제작', text: '매장 소식',
  media: [{ id: 'photo-1', position: 1, mimeType: 'image/jpeg', altText: '매장', src: '/photo-1' }], issues: [],
}
let rows: Record<string, any>[]
let run: Record<string, any>
let writeError: boolean
let thrownWrite: boolean
let lostWrite: boolean
let readbackTamper: boolean
let raced: boolean
let writes: number
let reorderJson: boolean
let tamperAfterWrites: number
const db = { from(table: string) {
  if (table !== 'marketing_missions' && table !== 'conversation_jobs') throw new Error(`Unexpected table: ${table}`)
  return {
    select() {
      const filters: Record<string, unknown> = {}
      const query = { eq(key: string, value: unknown) { filters[key] = value; return query }, async maybeSingle() {
        const candidates = table === 'conversation_jobs' ? [run] : rows
        const row = candidates.find(value => Object.entries(filters).every(([key, expected]) => value[key] === expected))
        const data = row ? structuredClone(row) : null
        if (reorderJson && data?.metadata?.missionPublishQuote) {
          data.metadata.missionPublishQuote = Object.fromEntries(Object.entries(data.metadata.missionPublishQuote).reverse())
        }
        if (readbackTamper && writes >= tamperAfterWrites && data) data.metadata.missionPublishQuote.requiredCredits = 0
        return { data, error: null }
      } }
      return query
    },
    update(patch: Record<string, unknown>) {
      writes++
      if (thrownWrite) throw new Error('PRIVATE_CONNECTION_RESET')
      if (raced) rows[0].updated_at = 'concurrent-update'
      if (writeError || lostWrite) {
        const query: any = { eq: () => query, select: () => query, maybeSingle: async () => ({ data: null, error: writeError ? { message: 'PRIVATE_DB_ERROR' } : null }) }
        return query
      }
      return filteredTableUpdate(rows, patch)
    },
  }
} }
const service = () => new MissionPublishReviewService(db as any, async () => ({ data: preview }))
beforeEach(() => {
  vi.useRealTimers()
  rows = [{ id: scope.missionId, workspace_id: scope.workspaceId, source_conversation_job_id: scope.runId,
    content_id: scope.contentId, content_version_id: scope.versionId, status: 'AWAITING_APPROVAL',
    updated_at: '2026-10-26T00:00:00Z', metadata: { keep: 'existing' } }]
  run = { id: scope.runId, workspace_id: scope.workspaceId, plan_data: { missionId: scope.missionId } }
  thrownWrite = false; writeError = false; lostWrite = false; readbackTamper = false; raced = false; writes = 0; reorderJson = false; tamperAfterWrites = 1
})

describe('미션 게시 영속 견적', () => {
  it('화면용 스냅샷은 저장된 견적과 같은 계정·원고·사진만 반환한다', async () => {
    const quote = await service().issue(scope)
    expect(await service().snapshot(scope, quote.quoteId)).toEqual({ quote, preview })
  })
  it('재발행 전 견적 ID로 다른 검토 화면을 반환하지 않는다', async () => {
    await service().issue(scope)
    await expect(service().snapshot(scope, 'old-quote')).rejects.toMatchObject({ code: 'MISSION_EXACT_REVIEW_REQUIRED' })
  })
  it('JSONB가 키 순서를 바꿔 반환해도 저장된 견적을 확인한다', async () => {
    reorderJson = true
    const issued = await service().issue(scope)
    expect(await service().read(scope)).toEqual(issued)
  })
  it('50크레딧 견적을 정확한 미션·실행·원고 버전에 저장하고 새 서비스에서 조회한다', async () => {
    const issued = await service().issue(scope)
    expect(issued).toMatchObject({ ...scope, actionType: 'SNS_DIRECT_PUBLISH', requiredCredits: 50, executionAllowed: false })
    expect(Date.parse(issued.expiresAt) - Date.parse(issued.issuedAt)).toBe(900000)
    expect(rows[0].metadata.keep).toBe('existing')
    expect(await service().read(scope)).toEqual(issued)
  })
  it.each(['source_conversation_job_id', 'content_id', 'content_version_id', 'workspace_id'])('미션의 %s 결합이 다르면 견적을 저장하지 않는다', async field => {
    rows[0][field] = 'other'
    await expect(service().issue(scope)).rejects.toMatchObject({ code: 'MISSION_REVIEW_CONFLICT' })
    expect(writes).toBe(0)
  })
  it('다른 미션 실행을 끼워 넣으면 견적을 저장하지 않는다', async () => {
    run.plan_data.missionId = 'other'
    await expect(service().issue(scope)).rejects.toMatchObject({ code: 'MISSION_REVIEW_CONFLICT' })
    expect(writes).toBe(0)
  })
  it.each(['writeError', 'lostWrite', 'readbackTamper', 'raced'])('%s는 영속 견적 성공으로 표시하지 않는다', async mode => {
    writeError = mode === 'writeError'; lostWrite = mode === 'lostWrite'; readbackTamper = mode === 'readbackTamper'; raced = mode === 'raced'
    await expect(service().issue(scope)).rejects.toMatchObject({ code: 'MISSION_QUOTE_SAVE_UNCONFIRMED' })
  })
  it('만료된 견적을 승인 가능한 견적으로 반환하지 않는다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
    await service().issue(scope)
    vi.setSystemTime(new Date('2026-10-26T10:15:00Z'))
    expect(await service().read(scope)).toBeNull()
  })
  it.each([
    { account: { ...preview.account, connectionId: 'other-account' } },
    { media: [{ ...preview.media[0], id: 'other-photo' }] },
    { fingerprint: 'b'.repeat(64) },
    { channel: 'threads' as const },
    { issues: [{ code: 'rights', message: '권리 확인 필요' }] },
  ])('검토 대상 또는 권한이 바뀌면 기존 견적을 재사용하지 않는다: %j', async changes => {
    await service().issue(scope)
    const changed = new MissionPublishReviewService(db as any, async () => ({ data: { ...preview, ...changes } }))
    expect(await changed.read(scope)).toBeNull()
  })
  it('미연결 계정에는 견적을 발행하지 않는다', async () => {
    const disconnected = new MissionPublishReviewService(db as any, async () => ({ data: { ...preview, account: { ...preview.account, status: 'disconnected' } } }))
    await expect(disconnected.issue(scope)).rejects.toMatchObject({ code: 'MISSION_REVIEW_BLOCKED' })
    expect(writes).toBe(0)
  })
})

describe('정확 견적 승인', () => {
  it('같은 승인자의 재시도는 기존 결정의 ID와 시각을 보존한다', async () => {
    const quote = await service().issue(scope)
    const consent = { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }
    const decision = await service().approve(scope, consent, actorId)
    const writeCount = writes
    expect(await service().approve(scope, consent, actorId)).toEqual(decision)
    expect(writes).toBe(writeCount)
  })
  it('다른 승인자의 재시도가 기존 승인자를 덮어쓰지 않는다', async () => {
    const quote = await service().issue(scope)
    const consent = { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }
    const decision = await service().approve(scope, consent, actorId)
    await expect(service().approve(scope, consent, 'other-reviewer')).rejects.toMatchObject({ code: 'MISSION_EXACT_REVIEW_REQUIRED' })
    expect(rows[0].metadata.missionPublishApproval).toEqual(decision)
  })
  it('승인 저장 요청의 연결 단절을 결과 미확인으로 처리한다', async () => {
    const quote = await service().issue(scope)
    thrownWrite = true
    await expect(service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }, actorId)).rejects.toMatchObject({ code: 'MISSION_REVIEW_SAVE_UNCONFIRMED' })
  })
  it.each(['writeError', 'lostWrite', 'readbackTamper', 'raced'])('승인 %s는 승인 저장 성공으로 표시하지 않는다', async mode => {
    const quote = await service().issue(scope)
    tamperAfterWrites = 2
    writeError = mode === 'writeError'; lostWrite = mode === 'lostWrite'; readbackTamper = mode === 'readbackTamper'; raced = mode === 'raced'
    await expect(service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }, actorId)).rejects.toMatchObject({ code: 'MISSION_REVIEW_SAVE_UNCONFIRMED' })
  })
  it('만료된 견적은 승인하지 않는다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
    const quote = await service().issue(scope)
    vi.setSystemTime(new Date('2026-10-26T10:15:00Z'))
    await expect(service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }, actorId)).rejects.toMatchObject({ code: 'MISSION_EXACT_REVIEW_REQUIRED' })
    expect(rows[0].metadata.missionPublishApproval).toBeNull()
  })
  it('견적 재발행은 이전 승인 결정을 무효화한다', async () => {
    const quote = await service().issue(scope)
    await service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }, actorId)
    const replacement = await service().issue(scope)
    expect(replacement.quoteId).not.toBe(quote.quoteId)
    expect(rows[0].metadata.missionPublishApproval).toBeNull()
    await expect(service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }, actorId)).rejects.toMatchObject({ code: 'MISSION_EXACT_REVIEW_REQUIRED' })
  })
  it('검토한 견적·권리 동의를 인증된 승인자에 결합해 저장하되 외부 실행은 허용하지 않는다', async () => {
    const quote = await service().issue(scope)
    const decision = await service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true }, actorId)
    expect(decision).toMatchObject({ quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, decidedBy: actorId, state: 'REVIEW_APPROVED', executionAllowed: false })
    expect(rows[0].metadata.missionPublishApproval).toEqual(decision)
    expect(rows[0].status).toBe('AWAITING_APPROVAL')
    expect(rows[0].approval_id).toBeUndefined()
  })
  it.each([
    { quoteId: 'other' }, { reviewFingerprint: 'b'.repeat(64) }, { rightsConfirmed: false }, { disclosureConfirmed: false },
  ])('견적·검토 지문·권리 동의 불일치는 승인하지 않는다: %j', async changes => {
    const quote = await service().issue(scope)
    await expect(service().approve(scope, { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed: true, disclosureConfirmed: true, ...changes }, actorId)).rejects.toMatchObject({ code: 'MISSION_EXACT_REVIEW_REQUIRED' })
    expect(rows[0].metadata.missionPublishApproval).toBeNull()
  })
})
