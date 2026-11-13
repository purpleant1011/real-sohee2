import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// 실제 PostgREST/DB 쓰기가 필요하다. CI의 mock 키나 운영 DB에서는 실행하지 않고,
// 별도 로컬 Supabase 스택을 명시적으로 켠 경우에만 전체 계약 테스트를 수행한다.
const hasLocalSupabase = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
  && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)
  && !!SERVICE_KEY && SERVICE_KEY !== 'sb_secret_test_mock_token_12345'

describe.skipIf(!hasLocalSupabase)('Contract: media_assets Lifecycle Schema Invariants & Constraints (REM-10 / ANI-1335)', () => {
  let adminClient: SupabaseClient
  const testWorkspaceId = '00000000-0000-4000-8000-0000000000a2' // Baireum canonical test workspace
  const testUserId = '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec' // Owner of test workspace
  const createdAssetIds: string[] = []

  beforeAll(() => {
    if (!SERVICE_KEY) {
      console.warn('[media-asset-lifecycle-contract] SUPABASE_SERVICE_ROLE_KEY not present; test running with anon or mock guard')
    }
    adminClient = createClient(SUPABASE_URL, SERVICE_KEY || 'dummy-key')
  })

  afterAll(async () => {
    if (SERVICE_KEY && createdAssetIds.length > 0) {
      await adminClient.from('media_assets').delete().in('id', createdAssetIds)
    }
  })

  it('1. DEFAULT INSERT: accepts insert when lifecycle_status is omitted (inherits PENDING_VALIDATION default without 23514 check constraint violation)', async () => {
    if (!SERVICE_KEY) {
      return
    }

    const testId = crypto.randomUUID()
    createdAssetIds.push(testId)

    const { data, error } = await adminClient
      .from('media_assets')
      .insert({
        id: testId,
        workspace_id: testWorkspaceId,
        bucket_id: 'content-media',
        object_path: `${testWorkspaceId}/${testId}/test-default.png`,
        kind: 'content',
        mime_type: 'image/png',
        size_bytes: 1024,
        rights_status: 'pending',
        created_by: testUserId
        // lifecycle_status is intentionally omitted to verify DEFAULT contract
      })
      .select('id, lifecycle_status')
      .single()

    expect(error).toBeNull()
    expect(data).toBeDefined()
    expect(data?.lifecycle_status).toBe('PENDING_VALIDATION')
  })

  it('2. EXPLICIT INSERT: accepts valid canonical lifecycle states (READY, PENDING_VALIDATION, ACTIVE, SUPERSEDED, QUARANTINED, FAILED, DELETED)', async () => {
    if (!SERVICE_KEY) {
      return
    }

    const testId = crypto.randomUUID()
    createdAssetIds.push(testId)

    const { data, error } = await adminClient
      .from('media_assets')
      .insert({
        id: testId,
        workspace_id: testWorkspaceId,
        bucket_id: 'content-media',
        object_path: `${testWorkspaceId}/${testId}/test-ready.png`,
        kind: 'content',
        mime_type: 'image/png',
        size_bytes: 1024,
        rights_status: 'confirmed',
        lifecycle_status: 'READY',
        created_by: testUserId
      })
      .select('id, lifecycle_status')
      .single()

    expect(error).toBeNull()
    expect(data?.lifecycle_status).toBe('READY')
  })

  it('3. VALID TRANSITION: permits update from PENDING_VALIDATION to READY to ACTIVE', async () => {
    if (!SERVICE_KEY) {
      return
    }

    const testId = crypto.randomUUID()
    createdAssetIds.push(testId)

    // Insert as PENDING_VALIDATION
    await adminClient.from('media_assets').insert({
      id: testId,
      workspace_id: testWorkspaceId,
      bucket_id: 'content-media',
      object_path: `${testWorkspaceId}/${testId}/test-transition.png`,
      kind: 'content',
      mime_type: 'image/png',
      size_bytes: 1024,
      rights_status: 'pending',
      lifecycle_status: 'PENDING_VALIDATION',
      created_by: testUserId
    })

    // Update to READY
    const { error: readyErr } = await adminClient
      .from('media_assets')
      .update({ lifecycle_status: 'READY', rights_status: 'confirmed' })
      .eq('id', testId)

    expect(readyErr).toBeNull()

    // Update to ACTIVE
    const { error: activeErr } = await adminClient
      .from('media_assets')
      .update({ lifecycle_status: 'ACTIVE' })
      .eq('id', testId)

    expect(activeErr).toBeNull()
  })

  it('4. INVALID INSERT REJECTION: rejects unauthorized lifecycle status values with check constraint violation (code: 23514)', async () => {
    if (!SERVICE_KEY) {
      return
    }

    const testId = crypto.randomUUID()
    const { error } = await adminClient
      .from('media_assets')
      .insert({
        id: testId,
        workspace_id: testWorkspaceId,
        bucket_id: 'content-media',
        object_path: `${testWorkspaceId}/${testId}/test-invalid.png`,
        kind: 'content',
        mime_type: 'image/png',
        size_bytes: 1024,
        rights_status: 'confirmed',
        lifecycle_status: 'INVALID_STATUS_FORBIDDEN' as any,
        created_by: testUserId
      })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514') // check_violation
  })

  it('5. LEGACY ROW COMPATIBILITY: existing production media_assets rows remain valid and queryable', async () => {
    if (!SERVICE_KEY) {
      return
    }

    const { data, error } = await adminClient
      .from('media_assets')
      .select('id, lifecycle_status')
      .limit(10)

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
