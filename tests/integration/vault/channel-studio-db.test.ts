import { beforeAll, describe, expect, it } from 'vitest'
import { SupabaseChannelDraftRepository } from '../../../src/features/channel-studio/supabase-repository'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { pgClient, query } from './pg-client'

const imageId = '94888888-8888-4888-8888-888888888888'
const imageKey = '95999999-9999-4999-8999-999999999999'
const userA = '71333333-3333-4333-8333-333333333333'
const userB = '72444444-4444-4244-8244-444444444444'
const wsA = '81555555-5555-4155-8155-555555555555'
const wsB = '82666666-6666-4266-8266-666666666666'
const requestKey = '93777777-7777-4377-8377-777777777777'
const db = pgClient()
const reservationDb = { ...db, rpc(name: string, args: Record<string, string | number | string[]>) {
  const fn = name === 'reserve_channel_draft_ani1538' || name === 'release_channel_draft_ani1538' ? name : (() => { throw new Error('Unexpected RPC') })()
  const quote = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`
  const params = name === 'reserve_channel_draft_ani1538'
    ? [args.p_workspace_id, args.p_request_key, args.p_created_by, args.p_topic, args.p_knowledge_version, JSON.stringify(args.p_basis_notes)]
    : [args.p_workspace_id, args.p_request_key, args.p_created_by]
  const values = params.map(quote).join(',')
  try {
    const result = query<{ outcome: string }>(`select public.${fn}(${values}) as outcome`)
    return Promise.resolve({ data: result[0]?.outcome ?? null, error: null })
  } catch (error) { return Promise.resolve({ data: null, error: { message: (error as Error).message } }) }
} }
// The test-only psql adapter serializes JS arrays as JSON rather than PostgreSQL text[];
// adapt just the array column, leaving every query and constraint backed by real PG.
const studioDb = { ...db, rpc(name: string, args: Record<string, unknown>) {
  if (name !== 'finalize_channel_draft_ani1538') throw new Error('Unexpected RPC')
  const quote = (value: unknown) => value === null ? 'null' : `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`
  const values = [args.p_workspace_id, args.p_request_key, args.p_created_by, args.p_topic,
    args.p_knowledge_version, args.p_basis_notes, args.p_image_notice, args.p_variants]
  const media = args.p_media_ids as string[]
  const mediaSql = `array[${media.map(quote).join(',')}]::uuid[]`
  try {
    const rows = query<Record<string, unknown>>(`select public.${name}(${values.map(quote).join(',')},${mediaSql}) as result`)
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  } catch (error) { return Promise.resolve({ data: null, error: { message: (error as Error).message } }) }
} }
const repo = new SupabaseChannelDraftRepository(studioDb as never)
const editingDb = { ...studioDb, rpc(name: string, args: Record<string, unknown>) {
  if (name !== 'edit_channel_draft_variant_ani1538') throw new Error('Unexpected RPC')
  const quote = (value: unknown) => `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`
  try {
    const result = query<{ result: Record<string, unknown> | null }>(`select public.${name}(${[
      args.p_workspace_id, args.p_request_key, args.p_channel, args.p_expected, args.p_next, args.p_created_by, args.p_content_id,
    ].map(quote).join(',')}) as result`)
    return Promise.resolve({ data: result[0] ?? null, error: null })
  } catch (error) { return Promise.resolve({ data: null, error: { message: (error as Error).message } }) }
} }
const editingRepo = new SupabaseChannelDraftRepository(editingDb as never)

beforeAll(() => {
  query(`with u as (insert into auth.users (id) values ('${userA}'), ('${userB}') returning id) select id from u`)
  query(`with w as (insert into public.workspaces (id,name,created_by) values ('${wsA}','가게 A','${userA}'), ('${wsB}','가게 B','${userB}') returning id) select id from w`)
})

function count(table: string) {
  return query<{ n: number }>(`select count(*)::int as n from public.${table} where workspace_id='${wsA}'`)[0].n
}
const actions = () => ['external_action_requests', 'external_action_attempts', 'external_action_receipts'].map(count)

describe('four-channel drafts in isolated PostgreSQL', () => {
  it('materialises four channel versions exactly once, scopes reads and counts, saves text-only Threads without an external action', async () => {
    const first = await repo.save({ workspaceId: wsA, userId: userA, requestKey, topic: '우리 가게 소개', knowledgeVersion: 3,
      basisNotes: ['지식 v3 기준'], imageNotice: '이미지 없이 글을 만들었어요', imageIds: [],
      variants: [
        { channel: 'instagram', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { caption: '인스타그램 소식', hashtags: ['가게'] } },
        { channel: 'threads', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { text: '스레드 소식' } },
        { channel: 'naver_blog', status: 'NEEDS_FIX', statusLabel: '수정 필요', issues: ['네이버 블로그는 이미지가 필요해요'], savableReason: '네이버 블로그는 이미지가 필요해요', payload: { title: '가게 제목', blocks: [{ type: 'paragraph', text: '블로그 본문' }], hashtags: [] } },
        { channel: 'daangn_business', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { text: '동네 소식' } },
      ] })
    const replay = await repo.save({ workspaceId: wsA, userId: userA, requestKey, topic: '바뀐 주제', knowledgeVersion: 4, basisNotes: [], imageNotice: null, imageIds: [], variants: [] })
    expect(replay).toEqual(first)
    expect(first.variants.map(variant => variant.contentId)).toEqual(replay.variants.map(variant => variant.contentId))
    expect(first.variants[2]).toMatchObject({ vaultSavable: false, blockedReason: '네이버 블로그는 이미지가 필요해요' })
    expect(first.variants[1]).toMatchObject({ vaultSavable: true, blockedReason: null })
    expect(count('channel_drafts')).toBe(1)
    expect(count('content_items')).toBe(3)
    expect(count('content_versions')).toBe(3)
    expect(first.variants[2]).toMatchObject({ contentId: null, versionId: null })
    expect(await repo.findByRequestKey(wsB, requestKey)).toBeNull()
    expect(await repo.listRecent(wsB, 10)).toEqual([])
    expect(await repo.countSince(wsB, '2020-01-01T00:00:00Z')).toBe(0)
    expect(await repo.countSince(wsA, '2020-01-01T00:00:00Z')).toBe(1)
    expect(await repo.countSince(wsA, '2999-01-01T00:00:00Z')).toBe(0)
    expect((await repo.listRecent(wsA, 10))[0]).toEqual(first)
    expect(query(`select id from public.channel_drafts where workspace_id='${wsA}'`, userB)).toHaveLength(0)
    expect(query(`select id from public.channel_drafts where workspace_id='${wsB}'`, userA)).toHaveLength(0)
    expect(query(`select id from public.channel_drafts where workspace_id='${wsA}'`, userA)).toHaveLength(1)
    expect(actions()).toEqual([0, 0, 0])
    const threads = first.variants[1]
    const stored = await new SupabaseVaultSaveRepository(db as never).getDraft(wsA, threads.contentId!, threads.versionId!)
    expect(stored).toMatchObject({ title: '우리 가게 소개', caption: '스레드 소식', hashtags: [] })
    const saved = await saveToVault({ workspaceId: wsA, actorId: userA, contentId: threads.contentId!, versionId: threads.versionId!, channels: ['threads'], targetDate: null, idempotencyKey: 'studio-save-threads' }, { repository: new SupabaseVaultSaveRepository(db as never) })
    expect(saved.saved).toHaveLength(1)
    expect(count('vault_items')).toBe(1)
    expect(actions()).toEqual([0, 0, 0])
  })

  it('atomically edits just one variant, creates an immutable next version and rejects stale or foreign writes without external actions', async () => {
    const original = (await editingRepo.findEditSnapshot(wsA, requestKey))!
    expect(original.knowledgeVersion).toBe(3)
    const before = original.draft.variants.find(v => v.channel === 'threads')!
    const changed = { ...before, payload: { text: '수정된 소식' }, versionId: null }
    const updated = await editingRepo.updateVariant(wsA, requestKey, 'threads', before, changed, userA)
    expect(updated).not.toBeNull()
    const after = updated!.variants.find(v => v.channel === 'threads')!
    expect(after).toMatchObject({ status: 'READY', vaultSavable: true, contentId: before.contentId, versionId: expect.any(String) })
    expect(after.versionId).not.toBe(before.versionId)
    expect(updated!.variants.find(v => v.channel === 'instagram')).toEqual(original.draft.variants.find(v => v.channel === 'instagram'))
    expect(query<{ version_number: number; caption: string }>(`select version_number,caption from public.content_versions where workspace_id='${wsA}' and content_id='${before.contentId}' order by version_number`)).toEqual([
      { version_number: 1, caption: '스레드 소식' }, { version_number: 2, caption: '수정된 소식' },
    ])
    expect(await editingRepo.updateVariant(wsA, requestKey, 'threads', before, changed, userA)).toBeNull()
    expect(await editingRepo.updateVariant(wsB, requestKey, 'threads', before, changed, userB)).toBeNull()
    const blocked = { ...after, payload: { text: '근거 없는 가격 9000원' }, status: 'NEEDS_CHECK' as const, vaultSavable: false, contentId: null, versionId: null, blockedReason: '가격 정보를 확인해 주세요.' }
    const unsafe = (await editingRepo.updateVariant(wsA, requestKey, 'threads', after, blocked, userA))!
    expect(unsafe.variants.find(v => v.channel === 'threads')).toMatchObject({ status: 'NEEDS_CHECK', vaultSavable: false, contentId: null, versionId: null })
    expect(count('content_versions')).toBe(4)
    expect(actions()).toEqual([0, 0, 0])
  })

  it('atomically reserves before generation, blocks duplicate and eleventh drafts, releases failed reservations', async () => {
    const reservations = new SupabaseChannelDraftRepository(reservationDb as never)
    const input = { workspaceId: wsB, userId: userB, requestKey: '96111111-1111-4111-8111-111111111111', topic: '원자적 예약', knowledgeVersion: 1, basisNotes: [], imageNotice: null }
    expect(await reservations.reserve(input)).toEqual({ kind: 'acquired' })
    expect(await reservations.reserve(input)).toEqual({ kind: 'pending' })
    expect(await reservations.findByRequestKey(wsB, input.requestKey)).toMatchObject({ variants: [] })
    await reservations.release(wsB, input.requestKey, userB)
    expect(await reservations.findByRequestKey(wsB, input.requestKey)).toBeNull()
    for (let n = 0; n < 10; n++) {
      expect(await reservations.reserve({ ...input, requestKey: `96222222-2222-4222-8222-${String(n).padStart(12, '0')}` })).toEqual({ kind: 'acquired' })
    }
    expect(await reservations.reserve({ ...input, requestKey: '96333333-3333-4333-8333-333333333333' })).toEqual({ kind: 'limit' })
    expect(await reservations.countSince(wsB, '2020-01-01T00:00:00Z')).toBe(10)
    expect(actions()).toEqual([0, 0, 0])
  })

  it('finalizes the reservation it made instead of failing, and an edited Naver title travels with the new version', async () => {
    const reservations = new SupabaseChannelDraftRepository(reservationDb as never)
    const key = '97111111-1111-4111-8111-111111111111'
    const base = { workspaceId: wsA, userId: userA, requestKey: key, topic: '예약 후 저장', knowledgeVersion: 1, basisNotes: [], imageNotice: null }
    expect(await reservations.reserve(base)).toEqual({ kind: 'acquired' })
    const saved = await repo.save({ ...base, imageIds: [], variants: [
      { channel: 'threads', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { text: '예약 뒤 저장한 글' } },
    ] })
    expect(saved.variants).toHaveLength(1)
    expect(saved.variants[0]).toMatchObject({ vaultSavable: true })
    expect((await repo.findByRequestKey(wsA, key))?.variants).toHaveLength(1)
    expect(actions()).toEqual([0, 0, 0])
  })

  it('rolls back every content row when a linked image is invalid and stores the retry caption exactly', async () => {
    const key = '98222222-2222-4222-8222-222222222222'
    const badImage = '98333333-3333-4333-8333-333333333333'
    query(`with m as (insert into public.media_assets (id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values ('${badImage}','${wsA}','knowledge-files','${wsA}/${userA}/${badImage}/photo.png','knowledge','image/png',1024,'confirmed','${userA}','${'b'.repeat(64)}') returning id) select id from m`)
    const before = [count('content_items'), count('content_versions'), count('content_version_media')]
    const base = { workspaceId: wsA, userId: userA, requestKey: key, topic: '실패 후 재시도', knowledgeVersion: 1, basisNotes: [], imageNotice: null }
    const reservations = new SupabaseChannelDraftRepository(reservationDb as never)
    expect(await reservations.reserve(base)).toEqual({ kind: 'acquired' })
    const variant = (caption: string) => ({ channel: 'threads' as const, status: 'READY' as const, statusLabel: '준비 완료', issues: [], savableReason: null, payload: { text: caption } })
    await expect(repo.save({ ...base, imageIds: [badImage], variants: [variant('저장하면 안 되는 이전 글')] })).rejects.toThrow()
    expect([count('content_items'), count('content_versions'), count('content_version_media')]).toEqual(before)
    expect((await repo.findByRequestKey(wsA, key))?.variants).toEqual([])
    const result = await repo.save({ ...base, imageIds: [], variants: [variant('재시도에서 고친 새 글')] })
    expect(result.variants[0].payload.text).toBe('재시도에서 고친 새 글')
    expect(query<{ caption: string }>(`select caption from public.content_versions where workspace_id='${wsA}' and id='${result.variants[0].versionId}'`)).toEqual([{ caption: '재시도에서 고친 새 글' }])
    expect([count('content_items'), count('content_versions'), count('content_version_media')]).toEqual([before[0] + 1, before[1] + 1, before[2]])
    expect(actions()).toEqual([0, 0, 0])
  })

  it('links a persisted PNG to four versions and allows image-required Naver vault saving', async () => {
    query(`with m as (insert into public.media_assets (id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values ('${imageId}','${wsA}','content-media','${wsA}/${userA}/${imageId}/photo.png','content','image/png',1024,'confirmed','${userA}', '${'a'.repeat(64)}') returning id) select id from m`)
    const variants = [
      { channel: 'instagram', status: 'NEEDS_FIX', statusLabel: '수정 필요', issues: ['이미지 형식을 확인해 주세요.'], savableReason: '이미지 형식을 확인해 주세요.', payload: { caption: '인스타 소식' } },
      { channel: 'threads', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { text: '스레드 소식' } },
      { channel: 'naver_blog', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { title: '블로그 소식', blocks: [{ type: 'paragraph', text: '네이버 소식' }] } },
      { channel: 'daangn_business', status: 'READY', statusLabel: '준비 완료', issues: [], savableReason: null, payload: { text: '동네 소식' } },
    ] as const
    const result = await repo.save({ workspaceId: wsA, userId: userA, requestKey: imageKey, topic: '사진 소식', knowledgeVersion: 3,
      basisNotes: ['지식 v3 기준'], imageNotice: null, imageIds: [imageId], variants: variants.map(v => ({ ...v, issues: [...v.issues], payload: v.payload })) })
    expect(result.variants).toHaveLength(4)
    expect(result.variants[2]).toMatchObject({ vaultSavable: true, blockedReason: null })
    expect(result.variants[0]).toMatchObject({ vaultSavable: false, contentId: null, versionId: null })
    expect(query<{ n: number }>(`select count(*)::int as n from public.content_version_media where workspace_id='${wsA}' and media_asset_id='${imageId}'`)[0].n).toBe(3)
    const naver = result.variants[2]
    const stored = await new SupabaseVaultSaveRepository(db as never).getDraft(wsA, naver.contentId!, naver.versionId!)
    expect(stored?.media).toMatchObject([{ type: 'image', mimeType: 'image/png', renditionContentDigest: 'a'.repeat(64) }])
    const saved = await saveToVault({ workspaceId: wsA, actorId: userA, contentId: naver.contentId!, versionId: naver.versionId!, channels: ['naver_blog'], targetDate: null, idempotencyKey: 'studio-save-naver-image' }, { repository: new SupabaseVaultSaveRepository(db as never) })
    expect(saved.saved).toHaveLength(1)
    expect(actions()).toEqual([0, 0, 0])
  })
})
