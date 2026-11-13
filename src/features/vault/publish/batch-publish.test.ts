import { describe, expect, it, vi } from 'vitest'
import { publishReleasedItems, type BatchPublishDeps } from './batch-publish'
import type { VaultItem } from '../types'

const now = new Date('2026-10-08T12:00:00Z')
const item = (id: string, channel: VaultItem['channel'] = 'instagram', workspaceId = 'shop'): VaultItem => ({
  id, workspaceId, contentId: 'post', versionId: id, channel, releaseGate: 'RELEASE_REQUESTED', holdReason: 'RELEASE_REQUESTED', heldAt: now.toISOString(), heldBy: null, targetDate: null, approvedFingerprint: 'a'.repeat(64), fingerprintSchemaVersion: 3, policyVersion: 'vault-save-v1', specVersion: '2026.10.1', approvalState: 'APPROVED', approvedBy: null, bundleId: null, idempotencyKey: id, deletedAt: null, createdAt: '', updatedAt: '',
})
function fixture(initial: VaultItem[] = [item('first')]) {
  const rows = initial.map(row => ({ ...row }))
  const events: string[] = []
  const urls: string[] = []
  let enabled = true
  const publish = vi.fn(async (_row?: { id: string }) => ({ success: true, verified: true, stage: 'EXTERNAL_VERIFIED', publishedUrl: 'https://www.instagram.com/p/test/' }))
  const deps: BatchPublishDeps = {
    enabled: () => enabled, now: () => now, ref: id => `opaque-${id}`,
    reevaluate: async () => {},
    listItems: async (ws, ids) => rows.filter(row => row.workspaceId === ws && (!ids || ids.includes(row.id))),
    claim: async (ws, id) => { const row = rows.find(r => r.workspaceId === ws && r.id === id && r.releaseGate === 'RELEASE_REQUESTED' && !r.deletedAt); if (!row) return false; row.releaseGate = 'HELD_USER'; row.holdReason = 'USER_HELD'; return true },
    hold: async (ws, id, reason, gate) => { const row = rows.find(r => r.workspaceId === ws && r.id === id)!; row.releaseGate = gate; row.holdReason = reason },
    complete: async (ws, id) => { const row = rows.find(r => r.workspaceId === ws && r.id === id)!; row.releaseGate = null; row.holdReason = null },
    preflight: async () => ({ overall: 'PASS', canRelease: true, items: [], blockedReasons: [] }),
    publish,
    recordPublished: async (row, _actor, url) => { urls.push(url); events.push(`vault.published:${row.id}`, `publish_verified:${row.id}`) },
    recordEvent: async (row, _actor, event) => { events.push(`${event}:${row.id}`) },
  }
  return { deps, rows, events, urls, publish, disable: () => { enabled = false } }
}
const run = (deps: BatchPublishDeps, itemIds?: string[], workspaceId = 'shop') => publishReleasedItems({ workspaceId, actorId: 'owner', itemIds, now }, deps)

describe('보관함 실제 게시', () => {
  it('스위치가 꺼져 있으면 상태와 공급자 호출을 바꾸지 않는다', async () => {
    const f = fixture(); f.disable()
    const result = await run(f.deps, ['first'])
    expect(result.results[0]).toMatchObject({ status: 'blocked', message: '아직 실제 발행이 켜지지 않았어요' })
    expect(f.rows[0].releaseGate).toBe('RELEASE_REQUESTED')
    expect(f.events).toEqual([]); expect(f.publish).not.toHaveBeenCalled()
  })
  it('특정 작업공간만 enabled인 경우 비허용 작업공간은 발행하지 않는다', async () => {
    const f = fixture([item('first', 'instagram', 'unauthorized-ws')])
    f.deps.enabled = (ws?: string) => ws === 'authorized-ws'
    const result = await publishReleasedItems({ workspaceId: 'unauthorized-ws', actorId: 'owner', itemIds: ['first'], now }, f.deps)
    expect(result.results[0]).toMatchObject({ status: 'blocked', message: '아직 실제 발행이 켜지지 않았어요' })
    expect(f.rows[0].releaseGate).toBe('RELEASE_REQUESTED')
    expect(f.publish).not.toHaveBeenCalled()
  })
  it('미리보기 전용 채널은 절대 실행하지 않는다', async () => {
    const f = fixture([item('naver', 'naver_blog'), item('daangn', 'daangn_business')])
    const result = await run(f.deps)
    expect(result.results.map(r => r.status)).toEqual(['skipped_preview_only', 'skipped_preview_only'])
    expect(result.results.every(r => r.message === '네이버 블로그와 당근은 소희에서 미리보기까지만 지원해요')).toBe(true)
    expect(f.rows.every(r => r.releaseGate === 'RELEASE_REQUESTED')).toBe(true)
    expect(f.publish).not.toHaveBeenCalled()
  })
  it('재검사가 실패하면 보류로 되돌리고 공급자를 호출하지 않는다', async () => {
    const f = fixture(); f.deps.preflight = async () => ({ overall: 'UNKNOWN', canRelease: false, items: [{ code: 'CONNECTION', status: 'UNKNOWN', message: '채널 연결을 확인해 주세요', action: null }], blockedReasons: ['채널 연결을 확인해 주세요'] })
    expect((await run(f.deps)).blocked).toBe(1)
    expect(f.rows[0]).toMatchObject({ releaseGate: 'HELD_CONNECTION_PENDING', holdReason: 'CHANNEL_NOT_CONNECTED' })
    expect(f.publish).not.toHaveBeenCalled()
  })
  it('결과 불확실 시 사람 확인이 필요하고 재실행하지 않는다', async () => {
    const f = fixture(); f.publish.mockResolvedValue({ success: false, verified: false, stage: 'RESULT_UNKNOWN', publishedUrl: '' })
    const first = await run(f.deps)
    expect(first.results[0]).toMatchObject({ status: 'needs_check', message: '게시 여부를 확인해 주세요' })
    expect(f.rows[0].releaseGate).toBe('HELD_USER')
    expect(f.events).toContain('vault.publish_uncertain:first')
    expect((await run(f.deps, ['first'])).blocked).toBe(1)
    expect(f.publish).toHaveBeenCalledTimes(1)
  })
  it('항목별 실패를 격리하고 검증된 결과만 기록한다', async () => {
    const f = fixture([item('first'), item('second')]); f.publish.mockImplementation(async (row?: { id: string }) => { if (row?.id === 'first') throw new Error('외부 통신 오류'); return { success: true, verified: true, stage: 'EXTERNAL_VERIFIED', publishedUrl: 'https://www.instagram.com/p/test/' } })
    const result = await run(f.deps)
    expect(result.needs_check).toBe(1); expect(result.published).toBe(1)
    expect(f.rows.map(r => r.releaseGate)).toEqual(['HELD_USER', null])
    expect(f.urls).toHaveLength(1)
    expect(f.events).toContain('publish_verified:second')
  })
  it('최대 열 건만 순차 처리하고 다른 매장 항목은 게시하지 않는다', async () => {
    const f = fixture([...Array.from({ length: 11 }, (_, i) => item(`p${i}`)), item('foreign', 'threads', 'other')])
    const result = await run(f.deps)
    expect(result.results).toHaveLength(10)
    expect(f.publish).toHaveBeenCalledTimes(10)
    const cross = await run(f.deps, ['foreign'])
    expect(cross.blocked).toBe(1)
    expect(f.publish).toHaveBeenCalledTimes(10)
    expect(f.rows.find(r => r.id === 'foreign')?.releaseGate).toBe('RELEASE_REQUESTED')
  })
  it('중복 호출은 한 번만 전송하고 완료에는 주소·감사·퍼널을 남긴다', async () => {
    const f = fixture()
    expect((await run(f.deps)).published).toBe(1)
    expect((await run(f.deps, ['first'])).blocked).toBe(1)
    expect(f.publish).toHaveBeenCalledTimes(1)
    expect(f.events).toEqual(['vault.published:first', 'publish_verified:first'])
    expect(f.urls).toEqual(['https://www.instagram.com/p/test/'])
    expect(f.rows[0].releaseGate).toBe(null)
  })
  it('사용자 문구는 내부 식별자나 예약 표현 없이 한국어로만 표시한다', async () => {
    const f = fixture([item('first'), item('second', 'naver_blog')]); f.publish.mockResolvedValue({ success: false, verified: false, stage: 'FAILED', publishedUrl: '' })
    const result = await run(f.deps)
    expect(result.results.map(r => r.message).join(' ')).not.toMatch(/예약됨|RESULT_UNKNOWN|HELD_|[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f-]{27}/i)
    expect(result.results.every(r => /[가-힣]/.test(r.message))).toBe(true)
    expect(result.results[0].message).toBe('게시하지 못했어요')
  })

  it('스레드 텍스트 단독 게시 성공 처리와 주소 저장 검증', async () => {
    const f = fixture([item('th-text', 'threads')])
    f.publish.mockResolvedValue({
      success: true,
      verified: true,
      stage: 'EXTERNAL_VERIFIED',
      publishedUrl: 'https://www.threads.com/@user/post/th123',
    })
    const result = await run(f.deps)
    expect(result.published).toBe(1)
    expect(result.results[0]).toMatchObject({ status: 'published', message: '게시 완료' })
    expect(f.urls).toEqual(['https://www.threads.com/@user/post/th123'])
    expect(f.rows[0].releaseGate).toBeNull()
  })

  it('인스타그램 이미지 누락 등 발행 실패 시 FAILED로 보류 처리된다', async () => {
    const f = fixture([item('ig-no-img', 'instagram')])
    f.publish.mockResolvedValue({
      success: false,
      verified: false,
      stage: 'FAILED',
      publishedUrl: '',
    })
    const result = await run(f.deps)
    expect(result.failed).toBe(1)
    expect(result.results[0]).toMatchObject({ status: 'failed', message: '게시하지 못했어요' })
    expect(f.rows[0].releaseGate).toBe('HELD_USER')
    expect(f.events).toContain('vault.publish_failed:ig-no-img')
  })

  it('읽기 검증(readback) 실패 시 needs_check로 전환되고 토큰이나 내부 URL이 유출되지 않는다', async () => {
    const f = fixture([item('th-readback-fail', 'threads')])
    f.publish.mockResolvedValue({
      success: true,
      verified: false,
      stage: 'RESULT_UNKNOWN',
      publishedUrl: '',
    })
    const result = await run(f.deps)
    expect(result.needs_check).toBe(1)
    expect(result.results[0]).toMatchObject({ status: 'needs_check', message: '게시 여부를 확인해 주세요' })
    expect(f.rows[0].releaseGate).toBe('HELD_USER')
    expect(f.events).toContain('vault.publish_uncertain:th-readback-fail')
    // No secret / token / internal URL leakage
    expect(result.results[0].message).not.toMatch(/token|secret|http|graph/i)
  })
})
