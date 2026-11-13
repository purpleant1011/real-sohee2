import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  resolve: vi.fn(),
  loadReadiness: vi.fn(),
  compose: vi.fn(),
  propose: vi.fn(),
  actualPropose: null as any,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServer }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.createAdmin }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolve }))
vi.mock('@/features/readiness/load', () => ({ loadReadiness: mocks.loadReadiness }))
vi.mock('@/features/missions/conversational-first-post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/missions/conversational-first-post')>()
  mocks.actualPropose = actual.proposeFirstPostMission
  mocks.propose.mockImplementation((params: any) => actual.proposeFirstPostMission(params))
  return {
    ...actual,
    composeFirstPostWithGemini: mocks.compose,
    proposeFirstPostMission: mocks.propose,
  }
})
import { POST } from './route'
import {
  proposeFirstPostMission,
  calculateApprovalFingerprint,
} from '@/features/missions/conversational-first-post'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const defaultValidAsset = {
  id: '33333333-3333-4333-8333-333333333333',
  workspace_id: workspaceId,
  provenance_kind: 'USER_UPLOAD',
  lifecycle_status: 'READY',
  rights_status: 'confirmed',
  publish_eligibility: true,
  generation_metadata: {
    uploadRights: {
      copyright: 'owned',
      commercialUse: true,
      identifiablePeople: 'none',
      consentReference: null,
    },
  },
}

function db(opts: {
  channels?: any[]
  offerings?: any[]
  registry?: any
  connectionsError?: any
  mediaAssets?: any[]
  mediaError?: any
  imageHarness?: any
  approvalPolicy?: any
  inserted?: any[]
  facts?: any[]
  factsError?: unknown
  factsCount?: number
} = {}) {
  const rows: Record<string, any> = {
    workspaces: { name: '가게' },
    workspace_knowledge_harnesses: { harness_version_id: 'v1', version_no: 1, offerings: opts.offerings ?? [], policies: [] },
    harness_rules_text_generation: { version: 1, structured_rule: { brandVoice: '친절한', rules: { brandVoice: '친절한' } } },
    harness_rules_image_generation: opts.imageHarness !== undefined ? opts.imageHarness : { version: 1, structured_rule: { goldenImageIds: ['1', '2', '3'], rules: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' } } },
    harness_rules_approval_policy: opts.approvalPolicy !== undefined ? opts.approvalPolicy : { version: 1, structured_rule: { publishApprovalLevel: 'MANUAL' } },
    workspace_registry: opts.registry !== undefined ? opts.registry : { dataset_mode: 'ACTUAL' },
  }
  const resolvedMedia = opts.mediaAssets !== undefined ? opts.mediaAssets : [defaultValidAsset]
  return { from(table: string) {
    let rule = ''
    const chain: any = {
      select: () => chain,
      eq: (field: string, value: string) => { if (field === 'rule_type') rule = value; return chain },
      in: () => chain, limit: () => chain, order: () => chain,
      maybeSingle: async () => {
        if (table === 'media_assets') {
          return { data: opts.mediaError ? null : (resolvedMedia[0] ?? null), error: opts.mediaError ?? null }
        }
        return { data: rows[rule ? `${table}_${rule}` : table] ?? null, error: null }
      },
      then: (done: any) => {
        if (table === 'media_assets') {
          return done({
            data: opts.mediaError ? null : resolvedMedia,
            error: opts.mediaError ?? null,
          })
        }
        if (table === 'knowledge_facts') {
          return done({ data: opts.facts ?? [], error: opts.factsError ?? null, count: opts.factsCount ?? (opts.facts ?? []).length })
        }
        return done({
          data: table === 'channel_connections' ? (opts.channels ?? []) : [],
          error: table === 'channel_connections' ? (opts.connectionsError ?? null) : null,
        })
      },
      insert: async (row: any) => {
        if (opts.inserted) opts.inserted.push(row)
        return { error: null }
      },
    }
    return chain
  } }
}

describe('first post propose PREPARE_ONLY', () => {
  it('creates a draft without a verified or linked channel when quick facts are prepared', async () => {
    mocks.createServer.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })
    mocks.createAdmin.mockReturnValue(db())
    mocks.resolve.mockResolvedValue({ success: true, workspaceId })
    mocks.loadReadiness.mockResolvedValue({ stage: 'PREPARE_ONLY', prepared: true, verifiedChannels: [], facts: {}, blockers: [] })
    mocks.compose.mockResolvedValue({ instagram: { caption: '안녕' }, threads: { content: '안녕' } })
    mocks.propose.mockReturnValue({ missionId: 'draft-1', channels: [], approvalFingerprint: 'hash', copies: {}, selectedImageIds: [], boundVersions: {}, rights: {} })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))
    expect(response.status).toBe(200)
    expect((await response.json()).draft.channels).toEqual([])
    expect(vi.mocked(proposeFirstPostMission).mock.calls[0]?.[0]).toMatchObject({ admission: 'DRAFT', connectedChannels: [] })
  })
})

describe('first post propose — 서버 사실 스냅샷', () => {
  const fact = {
    id: 'fact-1', workspace_id: workspaceId, category: 'service', content: '확정된 서비스',
    status: 'active', source_candidate_id: 'candidate-1', approved_by_user_id: 'owner',
    approved_at: '2026-01-01T00:00:00Z', valid_from: '2026-01-01T00:00:00Z',
    valid_until: null, supersedes_fact_id: null, created_at: '2026-01-01T00:00:00Z',
  }

  function arrange(opts: Parameters<typeof db>[0]) {
    mocks.createServer.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })
    mocks.createAdmin.mockReturnValue(db(opts))
    mocks.resolve.mockResolvedValue({ success: true, workspaceId })
    mocks.loadReadiness.mockResolvedValue({ stage: 'PREPARE_ONLY', prepared: true, verifiedChannels: [], facts: {}, blockers: [] })
    mocks.compose.mockResolvedValue({ instagram: { caption: '안녕' }, threads: { content: '안녕' } })
    mocks.propose.mockReturnValue({ missionId: 'draft-1', channels: [], approvalFingerprint: 'hash', copies: {}, selectedImageIds: [], boundVersions: {}, rights: {} })
  }

  it('서버 조회 스냅샷을 영속화하여 승인 재검증에 사용하고 클라이언트 위조를 무시한다', async () => {
    const inserted: any[] = []
    arrange({ facts: [fact], inserted })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST', body: JSON.stringify({ workspaceId, factSnapshot: { hash: 'forged' } }),
    }))
    expect(response.status).toBe(200)
    const snapshot = inserted[0].metadata.factSnapshot
    const { revalidateApprovedFactSnapshot, getDefaultFactSnapshotResolver } = await import('@/features/publishing/fact-snapshot-gate')
    expect(snapshot).toMatchObject({ workspaceId, facts: [fact], hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const current = await revalidateApprovedFactSnapshot({ admin: db({ facts: [fact] }), workspaceId, previousSnapshot: snapshot, resolver: getDefaultFactSnapshotResolver() })
    expect(current.ok).toBe(true)
    const changed = await revalidateApprovedFactSnapshot({ admin: db({ facts: [{ ...fact, content: '변경된 서비스' }] }), workspaceId, previousSnapshot: snapshot, resolver: getDefaultFactSnapshotResolver() })
    expect(changed).toMatchObject({ ok: false, code: 'FACT_REVIEW_REQUIRED', reason: 'FACTS_CHANGED' })
  })

  it.each([
    { factsError: { message: 'private database failure' } },
    { facts: [fact], factsCount: 2 },
    { facts: [{ ...fact, workspace_id: 'another-workspace' }] },
  ])('사실 조회 실패·누락·다른 테넌트 결과는 초안 저장 전에 차단한다: %j', async (options) => {
    const inserted: any[] = []
    arrange({ ...options, inserted })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ workspaceId }) }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'FACT_READ_FAILED', error: '가게 정보를 불러오지 못했어요.' })
    expect(inserted).toEqual([])
  })
})

describe('first post propose — 채널별 CTA (ANI-1775)', () => {
  function arrange(opts: { channels?: any[]; offerings?: any[] }) {
    mocks.createServer.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })
    mocks.createAdmin.mockReturnValue(db(opts))
    mocks.resolve.mockResolvedValue({ success: true, workspaceId })
    mocks.loadReadiness.mockResolvedValue({ stage: 'PREPARE_ONLY', prepared: true, verifiedChannels: [], facts: {}, blockers: [] })
    mocks.compose.mockResolvedValue({ instagram: { caption: '안녕' }, threads: { content: '안녕' } })
    mocks.propose.mockReturnValue({ missionId: 'draft-1', channels: [], approvalFingerprint: 'hash', copies: {}, selectedImageIds: [], boundVersions: {}, rights: {} })
  }

  function lastProposeArgs() {
    return vi.mocked(proposeFirstPostMission).mock.calls.at(-1)?.[0] as any
  }

  it('연결된 채널에만 확정 지식 근거로 만든 cta 를 넘긴다', async () => {
    arrange({
      channels: [{ channel: 'instagram', status: 'connected', account_label: '@shop', external_account_id: 'ig-1' }],
      offerings: [{ key: '시술', value: '속눈썹 연장' }],
    })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))

    expect(response.status).toBe(200)
    const copies = lastProposeArgs().copies
    expect(copies.instagram.cta).toBe('매장에서 속눈썹 연장 만나보세요.')
    expect('cta' in copies.threads).toBe(false)
  })

  it('연결된 채널이 없으면 cta 필드를 만들지 않는다', async () => {
    arrange({ channels: [], offerings: [{ key: '시술', value: '속눈썹 연장' }] })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))

    expect(response.status).toBe(200)
    const copies = lastProposeArgs().copies
    expect('cta' in copies.instagram).toBe(false)
    expect('cta' in copies.threads).toBe(false)
  })

  it('연결 상태가 connected 가 아니면 핸들이 남아 있어도 cta 를 만들지 않는다', async () => {
    arrange({
      channels: [{ channel: 'instagram', status: 'disconnected', account_label: '@shop', external_account_id: 'ig-1' }],
      offerings: [{ key: '시술', value: '속눈썹 연장' }],
    })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))

    expect(response.status).toBe(200)
    expect('cta' in lastProposeArgs().copies.instagram).toBe(false)
  })

  it('확정된 서비스·영업시간이 없으면 채널이 연결돼 있어도 cta 를 만들지 않는다', async () => {
    arrange({
      channels: [{ channel: 'instagram', status: 'connected', account_label: '@shop', external_account_id: 'ig-1' }],
      offerings: [],
    })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))

    expect(response.status).toBe(200)
    expect('cta' in lastProposeArgs().copies.instagram).toBe(false)
  })
})

describe('first post propose — datasetMode 가산 및 evidence fallback', () => {
  function arrange(opts: { registry?: any; connectionsError?: any } = {}) {
    mocks.createServer.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })
    mocks.createAdmin.mockReturnValue(db(opts))
    mocks.resolve.mockResolvedValue({ success: true, workspaceId })
    mocks.loadReadiness.mockResolvedValue({ stage: 'PREPARE_ONLY', prepared: true, verifiedChannels: [], facts: {}, blockers: [] })
    mocks.compose.mockResolvedValue({ instagram: { caption: '안녕' }, threads: { content: '안녕' } })
    mocks.propose.mockReturnValue({ missionId: 'draft-1', channels: [], approvalFingerprint: 'hash', copies: {}, selectedImageIds: [], boundVersions: {}, rights: {} })
  }

  it('workspace_registry 에서 ACTUAL 모드를 읽어 draft.datasetMode 에 가산한다', async () => {
    arrange({ registry: { dataset_mode: 'ACTUAL' } })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.draft.datasetMode).toBe('ACTUAL')
  })

  it('workspace_registry 가 TEST 이면 draft.datasetMode: TEST', async () => {
    arrange({ registry: { dataset_mode: 'TEST' } })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.draft.datasetMode).toBe('TEST')
  })

  it('evidence 조회가 실패하면(null fallback) draft.datasetMode: UNKNOWN', async () => {
    arrange({ connectionsError: { message: 'db error' } })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', body: JSON.stringify({ utterance: '소개', workspaceId }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.draft.datasetMode).toBe('UNKNOWN')
  })
})

describe('first post propose — 실사진 resolver (ANI-1764 Stage 2)', () => {
  const validAsset = {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: workspaceId,
    provenance_kind: 'USER_UPLOAD',
    lifecycle_status: 'READY',
    rights_status: 'confirmed',
    publish_eligibility: true,
    generation_metadata: {
      uploadRights: {
        copyright: 'owned',
        commercialUse: true,
        identifiablePeople: 'none',
        consentReference: null,
      },
    },
  }

  function arrange(opts: {
    mediaAssets?: any[]
    mediaError?: any
    imageHarness?: any
    approvalPolicy?: any
    inserted?: any[]
  } = {}) {
    mocks.createServer.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })
    mocks.createAdmin.mockReturnValue(db(opts))
    mocks.resolve.mockResolvedValue({ success: true, workspaceId })
    mocks.loadReadiness.mockResolvedValue({
      stage: 'PREPARE_ONLY',
      prepared: true,
      verifiedChannels: [],
      facts: {
        BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true },
        TEXT_HARNESS_CONFIRMED: { verified: true },
        IMAGE_HARNESS_CONFIRMED: { verified: true },
        OPERATING_POLICY_CONFIRMED: { verified: true },
      },
      blockers: [],
    })
    mocks.compose.mockResolvedValue({ instagram: { caption: '안녕' }, threads: { content: '안녕' } })
    // 실제 빌더 복원 (고정 mock 지문 금지, 실제 fingerprint/payload 계산)
    mocks.propose.mockImplementation((params: any) => mocks.actualPropose(params))
  }

  it('실제 builder 연동: user asset ≠ golden ID 입력 시 지문이 실제 user asset 페이로드로 계산되고 DB 영속과 1:1 일치한다', async () => {
    const inserted: any[] = []
    arrange({ mediaAssets: [validAsset], inserted })

    const response = await POST(
      new Request('http://localhost/api/missions/first-post/propose', {
        method: 'POST',
        body: JSON.stringify({ utterance: '소개', workspaceId, explicitAssetId: validAsset.id }),
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    const draft = body.draft

    // 1. 골든 이미지(1,2,3)가 아니라 실제 사용자 에셋 ID 바인딩
    expect(draft.selectedImageIds).toEqual([validAsset.id])
    expect(draft.mediaPreviews).toEqual([
      {
        id: validAsset.id,
        url: `/api/workspaces/${encodeURIComponent(workspaceId)}/media/${encodeURIComponent(validAsset.id)}`,
      },
    ])

    // 2. 권리는 골든(imageRules)이 아니라 실제 업로드 asset 권리에서 도출
    expect(draft.rights).toEqual({
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
    })

    // 3. approvalFingerprint 는 실제 user asset payload 로 계산된 지문과 정확히 일치 (고정 mock 지문 아님)
    const persistedRow = inserted[0]
    expect(inserted).toHaveLength(1)
    const expectedPayload = persistedRow.metadata.payload
    expect(expectedPayload.imageIds).toEqual([validAsset.id])
    expect(expectedPayload.rights).toEqual({
      rightsStatus: 'OWNED',
      consentStatus: 'NOT_APPLICABLE',
    })
    const calculatedFp = calculateApprovalFingerprint(expectedPayload)
    expect(draft.approvalFingerprint).toBe(calculatedFp)
    expect(persistedRow.metadata.draftFingerprint).toBe(calculatedFp)
    expect(persistedRow.metadata.draft.approvalFingerprint).toBe(calculatedFp)
  })

  it('레거시 명시 승인 정책을 보존하여 초안을 저장하고 정책 버전을 바인딩한다', async () => {
    const inserted: any[] = []
    arrange({ approvalPolicy: { version: 3, structured_rule: { autonomyLevel: 'semi_autonomous', requireExplicitApproval: true } }, inserted })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST', body: JSON.stringify({ workspaceId, explicitAssetId: validAsset.id }),
    }))
    expect(response.status).toBe(200)
    const { draft } = await response.json()
    expect(inserted).toHaveLength(1)
    expect(draft.boundVersions.operatingPolicyVersion).toBe(3)
    expect(inserted[0].status).toBe('AWAITING_APPROVAL')
    expect(mocks.propose.mock.calls.at(-1)?.[0].operatingPolicySnapshot.publishApprovalLevel).toBe('ALWAYS_REQUIRE')
  })

  it.each([false, 'true', undefined])('명시 승인이 확정되지 않은 레거시 정책은 추정하지 않는다: %s', async (requireExplicitApproval) => {
    const inserted: any[] = []
    arrange({ approvalPolicy: { version: 3, structured_rule: { autonomyLevel: 'semi_autonomous', requireExplicitApproval } }, inserted })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST', body: JSON.stringify({ workspaceId, explicitAssetId: validAsset.id }),
    }))
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('HARNESS_RULE_MISSING')
    expect(inserted).toHaveLength(0)
  })

  it.each([
    { version: 2, structured_rule: {} },
    { version: 2, structured_rule: { goldenImageIds: ['reference'], goldenAssets: [{ id: 'reference', rightsStatus: 'UNKNOWN' }] } },
  ])('스타일 참고 이미지가 불완전해도 검증된 업로드의 권리와 지문으로 초안을 저장한다: %j', async (imageHarness) => {
    const inserted: any[] = []
    arrange({ mediaAssets: [validAsset], imageHarness, inserted })

    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '소개', workspaceId, explicitAssetId: validAsset.id }),
    }))

    expect(response.status).toBe(200)
    const { draft } = await response.json()
    expect(draft.selectedImageIds).toEqual([validAsset.id])
    expect(draft.rights).toEqual({ rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' })
    expect(draft.boundVersions.imageHarnessVersion).toBe(2)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].metadata.payload.imageIds).toEqual([validAsset.id])
    expect(inserted[0].metadata.draftFingerprint).toBe(draft.approvalFingerprint)
  })

  it.each([
    [],
    [{ ...validAsset, workspace_id: 'other-workspace' }],
    [{ ...validAsset, lifecycle_status: 'PENDING_VALIDATION' }],
    [{ ...validAsset, rights_status: 'pending' }],
    [{ ...validAsset, generation_metadata: { ...validAsset.generation_metadata, rightsWithdrawnAt: '2026-10-27T00:00:00Z' } }],
    [{ ...validAsset, generation_metadata: { uploadRights: { ...validAsset.generation_metadata.uploadRights, commercialUse: false } } }],
  ])('참고 사진이 없어도 부적격 업로드는 삽입 없이 차단한다: %j', async (...assets) => {
    const inserted: any[] = []
    arrange({ mediaAssets: assets, imageHarness: { version: 2, structured_rule: {} }, inserted })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '소개', workspaceId, explicitAssetId: validAsset.id }),
    }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('MEDIA_SELECTION_INVALID')
    expect(inserted).toHaveLength(0)
  })

  it('확정된 이미지 기준 버전이 없으면 업로드가 유효해도 삽입하지 않는다', async () => {
    const inserted: any[] = []
    arrange({ imageHarness: null, inserted })
    const response = await POST(new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST', body: JSON.stringify({ workspaceId, explicitAssetId: validAsset.id }),
    }))
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('HARNESS_RULE_MISSING')
    expect(inserted).toHaveLength(0)
  })

  it('none 선택 시 409 MEDIA_SELECTION_REQUIRED 로 차단하고 DB insert 는 0건이다 (삽입 0)', async () => {
    const inserted: any[] = []
    arrange({ mediaAssets: [validAsset], inserted })

    const response = await POST(
      new Request('http://localhost/api/missions/first-post/propose', {
        method: 'POST',
        body: JSON.stringify({ utterance: '소개', workspaceId, explicitAssetId: 'none' }),
      }),
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('MEDIA_SELECTION_REQUIRED')
    expect(inserted).toHaveLength(0) // DB 삽입 0건 보증
  })

  it('권리 미확인 사진 선택 시 409 FirstValueSourceError 로 차단하고 DB insert 는 0건이다', async () => {
    const inserted: any[] = []
    const invalidAsset = {
      ...validAsset,
      rights_status: 'pending',
      publish_eligibility: false,
    }
    arrange({ mediaAssets: [invalidAsset], inserted })

    const response = await POST(
      new Request('http://localhost/api/missions/first-post/propose', {
        method: 'POST',
        body: JSON.stringify({ utterance: '소개', workspaceId, explicitAssetId: validAsset.id }),
      }),
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('MEDIA_SELECTION_INVALID')
    expect(inserted).toHaveLength(0) // DB 삽입 0건 보증
  })

  it('타 tenant 사진 선택 시 409 FirstValueSourceError 로 차단하고 DB insert 는 0건이다', async () => {
    const inserted: any[] = []
    const foreignAsset = {
      ...validAsset,
      workspace_id: 'other-workspace-uuid',
    }
    arrange({ mediaAssets: [foreignAsset], inserted })

    const response = await POST(
      new Request('http://localhost/api/missions/first-post/propose', {
        method: 'POST',
        body: JSON.stringify({ utterance: '소개', workspaceId, explicitAssetId: validAsset.id }),
      }),
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('MEDIA_SELECTION_INVALID')
    expect(inserted).toHaveLength(0) // DB 삽입 0건 보증
  })
})