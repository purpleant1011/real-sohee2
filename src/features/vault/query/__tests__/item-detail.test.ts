import { describe, expect, it } from 'vitest'
import { VaultEditError } from '../../edit'
import { generateCopyBundle } from '../../bundle/generator'
import type { VaultItem, VaultVariantPayload } from '../../types'
import { toUserVaultItemDto } from '../formatters'
import { getVaultItemDetail, toVaultItemDetailDto } from '../item-detail'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '99999999-9999-4999-8999-999999999999'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const DIGEST = 'a'.repeat(64)
const FINGERPRINT = 'b'.repeat(64)

const item: VaultItem = {
  id: ITEM_ID, workspaceId: WS, contentId: '33333333-3333-4333-8333-333333333333', versionId: '44444444-4444-4444-8444-444444444444',
  channel: 'naver_blog', releaseGate: 'HELD_USER', holdReason: 'USER_HELD', heldAt: '2026-10-07T00:00:00Z', heldBy: '55555555-5555-4555-8555-555555555555',
  targetDate: '2026-10-12', approvedFingerprint: FINGERPRINT, fingerprintSchemaVersion: 3, policyVersion: 'vault-save-v1', specVersion: '2026.10.1',
  approvalState: 'APPROVED', approvedBy: null, bundleId: null, idempotencyKey: 'key-1', deletedAt: null, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z',
}
const payload: VaultVariantPayload = {
  id: '66666666-6666-4666-8666-666666666666', workspaceId: WS, vaultItemId: ITEM_ID, previewArtifacts: {}, createdAt: '', updatedAt: '',
  payload: {
    title: '  가을 신메뉴  ', text: '밤 라떼가 나왔어요.\n\n따뜻하게 드세요.', hashtags: ['#카페', ' 가을 ', '#', ''],
    media: [
      { position: 1, type: 'image', mimeType: 'image/png', sizeBytes: 2048, renditionContentDigest: DIGEST },
      { position: 0, type: 'image', mimeType: 'image/jpeg', sizeBytes: 1024, renditionContentDigest: DIGEST },
    ],
    settings: { approved_target_account_id: 'unconnected:internal', approved_policy_versions: { 'vault-save': 'vault-save-v1' }, category: '일상', coupon: null },
    targetAccountId: 'unconnected:internal',
    textBlockRenderSpec: { channel: 'naver_blog', blocks: [{ type: 'body', text: '밤 라떼가 나왔어요.' }], digest: DIGEST },
  },
}

function repo(rows: { item?: VaultItem | null; payload?: VaultVariantPayload | null } = {}) {
  const calls: string[] = []
  return {
    calls,
    getItem: async (workspaceId: string, id: string) => { calls.push(`item:${workspaceId}:${id}`); return rows.item === undefined ? item : rows.item },
    getPayload: async (workspaceId: string, id: string) => { calls.push(`payload:${workspaceId}:${id}`); return rows.payload === undefined ? payload : rows.payload },
  }
}
const ref = toUserVaultItemDto(item).item_ref

describe('보관 항목 상세 DTO (미리보기·수정 시트용, 읽기 전용)', () => {
  it('본문·제목·태그는 복사 번들과 같은 읽기 함수에서 나오고 이미지는 파일 식별 정보 없이 형식만 내려간다', () => {
    const detail = toVaultItemDetailDto(item, payload)
    const bundle = generateCopyBundle({ item, payload, signedImages: [], manualPublish: null, itemRef: detail.item_ref })
    expect(detail.content).toEqual({ title: bundle.title, body: bundle.body, tags: bundle.tags })
    expect(detail.content).toEqual({ title: '가을 신메뉴', body: '밤 라떼가 나왔어요.\n\n따뜻하게 드세요.', tags: ['카페', '가을'] })
    expect(detail.media).toEqual([
      { type: 'image', mime_type: 'image/jpeg', size_bytes: 1024 },
      { type: 'image', mime_type: 'image/png', size_bytes: 2048 },
    ])
    expect(detail.settings).toEqual({ category: '일상', coupon: null })
    expect(detail).toMatchObject({ channel: 'naver_blog', channel_label: '네이버 블로그', status_label: '발행 준비 완료 · 외부 게시 전', hold_reason_label: '사용자 보류', target_date: '2026-10-12', needs_reapproval: false, is_user_held: true, is_deleted: false, deleted_at: null })
  })

  it('고유 식별자·승인 값·내부 코드가 응답 어디에도 없다', () => {
    const json = JSON.stringify(toVaultItemDetailDto(item, payload))
    for (const secret of [ITEM_ID, WS, item.contentId, item.versionId, FINGERPRINT, DIGEST, 'unconnected:internal', 'HELD_USER', 'USER_HELD', 'APPROVED', 'vault-save-v1', 'targetAccountId', 'renditionContentDigest', 'approvedFingerprint', '예약됨']) {
      expect(json, secret).not.toContain(secret)
    }
  })

  it('승인이 풀린 항목은 서버가 "승인이 풀렸어요"를 내려주고, 삭제된 항목은 복구 기간 문구를 내려준다', () => {
    expect(toVaultItemDetailDto({ ...item, approvalState: 'INVALIDATED', approvedFingerprint: null }, payload)).toMatchObject({ status_label: '승인이 풀렸어요', needs_reapproval: true })
    expect(toVaultItemDetailDto({ ...item, approvalState: 'NEEDS_REAPPROVAL' }, payload)).toMatchObject({ status_label: '재확인 필요', needs_reapproval: true })
    expect(toVaultItemDetailDto({ ...item, deletedAt: '2026-10-08T00:00:00Z' }, payload)).toMatchObject({ status_label: '삭제됨 · 30일 안에 복구 가능', is_deleted: true, deleted_at: '2026-10-08T00:00:00Z' })
  })

  it('형식이 맞지 않는 이미지 항목은 건너뛰고, 보류가 아닌 항목은 사용자 보류로 표시하지 않는다', () => {
    const odd: VaultVariantPayload = { ...payload, payload: { ...payload.payload, media: [null, 'x', { type: 'audio' }, { type: 'video', mimeType: 5, sizeBytes: 'big' }], settings: [] } }
    const detail = toVaultItemDetailDto({ ...item, releaseGate: 'HELD_CONNECTION_PENDING', holdReason: 'CHANNEL_NOT_CONNECTED' }, odd)
    expect(detail.media).toEqual([{ type: 'video', mime_type: null, size_bytes: null }])
    expect(detail.settings).toEqual({ category: null, coupon: null })
    expect(detail.is_user_held).toBe(false)
    expect(detail.hold_reason_label).toBe('채널 연결 필요')
  })

  it('조회는 요청한 매장 범위로만 하고, 찾지 못하면 404, 내용이 없으면 빈 화면이 아니라 오류(409)로 알린다', async () => {
    const ok = repo()
    await expect(getVaultItemDetail(ok, { workspaceId: WS, itemRef: ref })).resolves.toMatchObject({ item_ref: ref, channel: 'naver_blog' })
    expect(ok.calls).toEqual([`item:${WS}:${ITEM_ID}`, `payload:${WS}:${ITEM_ID}`])
    await expect(getVaultItemDetail(repo({ item: null }), { workspaceId: WS, itemRef: ref })).rejects.toMatchObject({ status: 404, message: '보관 항목을 찾을 수 없어요.' })
    await expect(getVaultItemDetail(repo({ item: { ...item, workspaceId: OTHER_WS } }), { workspaceId: WS, itemRef: ref })).rejects.toMatchObject({ status: 404 })
    await expect(getVaultItemDetail(repo({ payload: null }), { workspaceId: WS, itemRef: ref })).rejects.toMatchObject({ status: 409 })
    await expect(getVaultItemDetail(repo({ payload: { ...payload, workspaceId: OTHER_WS } }), { workspaceId: WS, itemRef: ref })).rejects.toMatchObject({ status: 409 })
    await expect(getVaultItemDetail(ok, { workspaceId: WS, itemRef: 'not-a-reference' })).rejects.toBeInstanceOf(VaultEditError)
  })
})
