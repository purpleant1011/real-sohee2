import { describe, expect, it } from 'vitest'
import { findChannelPublishConflict } from './channel-publish-guard'

const NOW = Date.parse('2026-10-23T10:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const adminWith = (result: { data: any; error: any }) => {
  const q: any = { select: () => q, eq: () => q, neq: () => q, order: () => q, limit: async () => result }
  return { from: () => q }
}
const row = (status: string, ageMs: number, providers: string[], id = 'other') => ({ id, status, updated_at: ago(ageMs), metadata: { payload: { channels: providers.map((provider) => ({ provider })) } } })
const run = (rows: any[], channels = ['instagram']) => findChannelPublishConflict(adminWith({ data: rows, error: null }), { workspaceId: 'w', missionId: 'me', channels, now: NOW })

describe('G5 channel publish guard (R1 quick-post ↔ R2 propose 교차)', () => {
  it('다른 미션이 같은 채널로 진행 중이면 409 CHANNEL_PUBLISH_IN_PROGRESS', async () => {
    expect(await run([row('EXECUTING', 30_000, ['instagram', 'threads'])])).toMatchObject({ status: 409, body: { code: 'CHANNEL_PUBLISH_IN_PROGRESS', conflictingMissionId: 'other' } })
  })
  it('직전에 게시 확인된 미션은 막지 않는다(연속 정상 게시) — 조회도 EXECUTING만',async () => {
    expect(await run([row('PUBLISHED_VERIFIED', 60_000, ['instagram'])])).toBeNull()
  })
  it('채널이 겹치지 않거나 오래됐으면 통과(좀비 EXECUTING이 채널을 영구 차단하지 않음)', async () => {
    expect(await run([row('EXECUTING', 30_000, ['threads'])])).toBeNull()
    expect(await run([row('EXECUTING', 16 * 60_000, ['instagram'])])).toBeNull()
  })
  it('ANI-1789 특성: 1분 전 PUBLISHED_VERIFIED sibling은 null (동일원고 중복 검증은 guard 범위 밖)', async () => {
    // 직전 성공 미션은 현재 가드가 status=EXECUTING만 조회하므로 차단하지 않음 (null)
    expect(await run([row('PUBLISHED_VERIFIED', 60_000, ['instagram'], 'mission-prev')])).toBeNull()
  })
  it('ANI-1789 특성: 16분 전 EXECUTING sibling은 15분 윈도우 초과로 null (영구 차단 방지)', async () => {
    // 15분(CHANNEL_INFLIGHT_WINDOW_MS) 초과된 in-flight 미션은 좀비로 간주되어 채널을 차단하지 않음 (null)
    expect(await run([row('EXECUTING', 16 * 60_000, ['instagram'], 'mission-zombie')])).toBeNull()
  })
  it('조회 실패는 통과시키지 않고 503 (fail-closed)', async () => {
    const r = await findChannelPublishConflict(adminWith({ data: null, error: { message: 'x' } }), { workspaceId: 'w', missionId: 'me', channels: ['instagram'] })
    expect(r).toMatchObject({ status: 503, body: { code: 'CHANNEL_GUARD_UNAVAILABLE' } })
  })
})
