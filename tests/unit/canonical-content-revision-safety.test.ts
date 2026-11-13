import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, any>[]>,
  beforeVersionInsert: null as (() => void) | null,
  mediaReadError: false,
  failMissionBinding: false,
  beforeApprovalExpire: null as (() => void) | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from(table: string) {
      let operation = 'select'
      let payload: any
      const filters: Array<[string, unknown]> = []
      const execute = () => {
        const rows = state.rows[table] ||= []
        // These tables expose content_id, not the work_items column content_item_id.
        if (['marketing_missions', 'content_versions'].includes(table)
          && (filters.some(([key]) => key === 'content_item_id') || (payload && 'content_item_id' in payload))) {
          return { data: null, error: { message: 'column content_item_id does not exist', code: '42703' } }
        }
        if (operation === 'update' && table === 'agent_approvals') state.beforeApprovalExpire?.()
        if (operation === 'update' && table === 'marketing_missions' && payload.content_version_id && state.failMissionBinding) {
          return { data: null, error: { message: 'mission binding unavailable' } }
        }
        const matches = rows.filter(row => filters.every(([key, value]) => row[key] === value))
        if (operation === 'insert') {
          if (table === 'content_versions') state.beforeVersionInsert?.()
          const inserted = (Array.isArray(payload) ? payload : [payload]).map(row => ({ ...row }))
          rows.push(...inserted)
          return { data: inserted, error: null }
        }
        if (operation === 'update') matches.forEach(row => Object.assign(row, payload))
        if (table === 'content_version_media' && state.mediaReadError) {
          return { data: null, error: { message: 'media unavailable' } }
        }
        return { data: matches.map(row => ({ ...row })), error: null }
      }
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        order: () => query,
        insert: (value: any) => { operation = 'insert'; payload = value; return query },
        upsert: (value: any) => { operation = 'insert'; payload = value; return query },
        update: (value: any) => { operation = 'update'; payload = value; return query },
        maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
        single: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
        then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
      }
      return query
    },
  }),
}))

const revise = () => CanonicalContentLifecycleService.reviseContent({
  workspaceId: 'workspace-a', contentId: 'content-a', expectedVersionId: 'version-1',
  caption: '수정한 본문', revisedBy: 'owner-a',
})

beforeEach(() => {
  state.beforeVersionInsert = null
  state.mediaReadError = false
  state.failMissionBinding = false
  state.beforeApprovalExpire = null
  state.rows = {
    content_items: [{ id: 'content-a', workspace_id: 'workspace-a', current_version_id: 'version-1', status: 'approved', channel: 'instagram', title: '소식' }],
    content_versions: [{ id: 'version-1', workspace_id: 'workspace-a', content_id: 'content-a', version_number: 1, caption: '원본', hashtags: ['#소식'], rights: { mediaUrls: ['/photo-a'], consent: 'confirmed' }, disclosure: '광고' }],
    content_version_media: [
      { workspace_id: 'workspace-a', version_id: 'version-1', media_asset_id: 'photo-a', position: 0 },
      { workspace_id: 'workspace-b', version_id: 'version-1', media_asset_id: 'foreign-photo', position: 1 },
    ],
    approvals: [{ id: 'approval-1', workspace_id: 'workspace-a', version_id: 'version-1', status: 'approved' }],
  }
})

describe('미션 콘텐츠 생성 계보', () => {
  const create = () => CanonicalContentLifecycleService.createContent({
    workspaceId: 'workspace-a', channel: 'instagram', title: '새 소식', caption: '새 원고',
    createdBy: 'owner-a', missionId: 'mission-a',
  })

  it('실제 content_id 컬럼으로 생성한 원고와 버전을 같은 미션에 연결한다', async () => {
    state.rows.marketing_missions = [{ id: 'mission-a', workspace_id: 'workspace-a', status: 'PRODUCING' }]
    const result = await create()
    expect(state.rows.marketing_missions[0]).toMatchObject({
      content_id: result.contentId, content_version_id: result.versionId,
    })
    expect(state.rows.content_versions.find(row => row.id === result.versionId)).toMatchObject({ content_id: result.contentId })
  })

  it.each(['missing', 'other-workspace', 'write-error'])('미션 연결이 %s이면 생성 성공을 반환하지 않는다', async failure => {
    state.rows.marketing_missions = failure === 'missing' ? [] : [{
      id: 'mission-a', workspace_id: failure === 'other-workspace' ? 'workspace-b' : 'workspace-a', status: 'PRODUCING',
    }]
    state.failMissionBinding = failure === 'write-error'
    await expect(create()).rejects.toMatchObject({ code: 'MISSION_CONTENT_BINDING_FAILED' })
    expect(state.rows.content_drafts || []).toHaveLength(0)
    expect(state.rows.marketing_missions[0]?.content_id).toBeUndefined()
  })
})

describe('일반 콘텐츠 수정 안전 경계', () => {
  it('본문만 수정하면 기존 사진 연결·권리·광고 표시·해시태그를 새 버전에 보존한다', async () => {
    const result = await revise()
    expect(state.rows.content_versions.find(row => row.id === result.versionId)).toMatchObject({
      caption: '수정한 본문', hashtags: ['#소식'], rights: { mediaUrls: ['/photo-a'], consent: 'confirmed' }, disclosure: '광고', created_by: 'owner-a',
    })
    expect(state.rows.content_version_media.filter(row => row.version_id === result.versionId)).toEqual([
      { workspace_id: 'workspace-a', version_id: result.versionId, media_asset_id: 'photo-a', position: 0 },
    ])
    expect(state.rows.content_items[0]).toMatchObject({ status: 'draft', current_version_id: result.versionId })
    expect(state.rows.approvals).toEqual([{ id: 'approval-1', workspace_id: 'workspace-a', version_id: 'version-1', status: 'approved' }])
  })

  it('연결된 미션의 이전 대기 승인을 만료하고 같은 미션에 새 콘텐츠 버전을 연결한다', async () => {
    state.rows.marketing_missions = [{ id: 'mission-a', workspace_id: 'workspace-a', content_id: 'content-a', content_version_id: 'version-1', source_conversation_job_id: 'run-a', status: 'AWAITING_APPROVAL', updated_at: 'before', approval_id: 'approval-1' }]
    state.rows.agent_approvals = [{ id: 'decision-a', workspace_id: 'workspace-a', action_run_id: 'run-a', status: 'PENDING', version: 2 }]
    const result = await revise()
    expect(state.rows.agent_approvals[0]).toMatchObject({ status: 'EXPIRED', version: 3 })
    expect(state.rows.marketing_missions[0]).toMatchObject({ id: 'mission-a', content_version_id: result.versionId, approval_id: null, status: 'AWAITING_APPROVAL' })
  })

  it('연결된 실행 승인이 이미 선점되었으면 원고를 수정하지 않는다', async () => {
    state.rows.marketing_missions = [{ id: 'mission-a', workspace_id: 'workspace-a', content_id: 'content-a', content_version_id: 'version-1', source_conversation_job_id: 'run-a', status: 'AWAITING_APPROVAL', updated_at: 'before' }]
    state.rows.agent_approvals = [{ id: 'decision-a', workspace_id: 'workspace-a', action_run_id: 'run-a', status: 'APPROVED', version: 3 }]
    await expect(revise()).rejects.toMatchObject({ code: 'STALE_VERSION_CONFLICT' })
    expect(state.rows.content_versions).toHaveLength(1)
  })

  it('승인 조회 후 실행이 승인을 선점하면 만료 CAS가 실패하고 원고는 바뀌지 않는다', async () => {
    state.rows.marketing_missions = [{ id: 'mission-a', workspace_id: 'workspace-a', content_id: 'content-a', content_version_id: 'version-1', source_conversation_job_id: 'run-a', status: 'AWAITING_APPROVAL', updated_at: 'before' }]
    state.rows.agent_approvals = [{ id: 'decision-a', workspace_id: 'workspace-a', action_run_id: 'run-a', status: 'PENDING', version: 2 }]
    state.beforeApprovalExpire = () => Object.assign(state.rows.agent_approvals[0], { status: 'APPROVED', version: 3 })
    await expect(revise()).rejects.toMatchObject({ code: 'STALE_VERSION_CONFLICT' })
    expect(state.rows.content_versions).toHaveLength(1)
    expect(state.rows.marketing_missions[0].status).toBe('AWAITING_APPROVAL')
  })

  it('새 원고 저장 후 미션 연결이 실패하면 재확인 오류를 반환하고 이전 승인으로 복귀하지 않는다', async () => {
    state.rows.marketing_missions = [{ id: 'mission-a', workspace_id: 'workspace-a', content_id: 'content-a', content_version_id: 'version-1', source_conversation_job_id: 'run-a', status: 'AWAITING_APPROVAL', updated_at: 'before', approval_id: 'approval-1' }]
    state.rows.agent_approvals = [{ id: 'decision-a', workspace_id: 'workspace-a', action_run_id: 'run-a', status: 'PENDING', version: 2 }]
    state.failMissionBinding = true
    await expect(revise()).rejects.toMatchObject({ code: 'REVISION_RECONCILIATION_REQUIRED' })
    expect(state.rows.content_items[0].current_version_id).not.toBe('version-1')
    expect(state.rows.marketing_missions[0]).toMatchObject({ status: 'PRODUCING', approval_id: null, content_version_id: 'version-1' })
    expect(state.rows.agent_approvals[0]).toMatchObject({ status: 'EXPIRED', version: 3 })
    expect(state.rows.content_drafts || []).toHaveLength(0)
  })

  it('사진을 명시적으로 교체하면 이전 사진의 권리 확인을 새 사진에 승계하지 않는다', async () => {
    const result = await CanonicalContentLifecycleService.reviseContent({
      workspaceId: 'workspace-a', contentId: 'content-a', expectedVersionId: 'version-1',
      caption: '새 사진 본문', mediaUrls: ['/new-photo'],
    })
    expect(state.rows.content_versions.find(row => row.id === result.versionId)?.rights).toEqual({ mediaUrls: ['/new-photo'] })
    expect(state.rows.content_version_media.filter(row => row.version_id === result.versionId)).toHaveLength(0)
  })

  it('조회 이후 다른 수정이 선점하면 새 현재 버전과 승인 상태를 덮어쓰지 않는다', async () => {
    state.beforeVersionInsert = () => Object.assign(state.rows.content_items[0], { current_version_id: 'winner-version', status: 'approved' })
    await expect(revise()).rejects.toMatchObject({ code: 'STALE_VERSION_CONFLICT' })
    expect(state.rows.content_items[0]).toMatchObject({ current_version_id: 'winner-version', status: 'approved' })
    expect(state.rows.content_drafts || []).toHaveLength(0)
  })

  it('기존 사진 연결 조회가 실패하면 사진 없는 새 버전을 현재 버전으로 만들지 않는다', async () => {
    state.mediaReadError = true
    await expect(revise()).rejects.toThrow()
    expect(state.rows.content_items[0].current_version_id).toBe('version-1')
    expect(state.rows.content_versions).toHaveLength(1)
  })
})
