import { describe, expect, it } from 'vitest'
import { applyVaultEdit } from './index'
import { toUserVaultItemDto } from '../query/formatters'
import { createMemoryVault, MEMORY_ACTOR, MEMORY_WORKSPACE } from '../test-support/memory-vault'

/**
 * Cross-service regression: the payload written by the real save service must be editable and
 * re-approvable by the real edit service. A save payload carries no category/visibility/coupon
 * settings (the save fingerprint uses the defaults), so the edit path must apply the same defaults.
 */
async function setup() {
  const vault = createMemoryVault()
  const saved = await vault.save(['instagram'])
  expect(saved.saved).toHaveLength(1)
  const current = () => vault.items[0]
  const base = { workspaceId: MEMORY_WORKSPACE, actorId: MEMORY_ACTOR, itemRef: toUserVaultItemDto(current()).item_ref, now: new Date('2026-10-07T12:00:00Z') }
  const edit = (operation: 'edit' | 'reapprove', changes?: { text?: string; targetDate?: string }) => applyVaultEdit(vault.editRepository, { ...base, expectedVersion: current().updatedAt, operation, changes })
  return { current, edit }
}

describe('저장한 보관 글을 수정하고 다시 승인하는 흐름', () => {
  it('저장 서비스가 만든 보관 글을 수정하면 승인이 풀리고, 다시 승인하면 보관으로 돌아온다', async () => {
    const { current, edit } = await setup()
    const originalFingerprint = current().approvedFingerprint

    await expect(edit('edit', { text: '밤 라떼가 새로 나왔어요' })).resolves.toMatchObject({ status_label: '재승인 필요' })
    expect(current().approvalState).toBe('INVALIDATED')
    expect(current().approvedFingerprint).toBeNull()

    await expect(edit('reapprove')).resolves.toMatchObject({ status_label: '발행 준비 완료 · 외부 게시 전' })
    expect(current().approvalState).toBe('APPROVED')
    expect(current().approvedFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(current().approvedFingerprint).not.toBe(originalFingerprint)
  })

  it('내용을 바꿨다가 원래대로 되돌려 다시 승인하면 처음 승인과 같은 값으로 돌아온다', async () => {
    const { current, edit } = await setup()
    const originalFingerprint = current().approvedFingerprint
    await edit('edit', { text: '잠깐 바꿈' })
    await edit('edit', { text: '밤 라떼가 나왔어요' })
    await edit('reapprove')
    expect(current().approvedFingerprint).toBe(originalFingerprint)
  })

  it('예정일만 바꾸면 승인은 그대로다', async () => {
    const { current, edit } = await setup()
    await edit('edit', { targetDate: '2026-10-20' })
    expect(current()).toMatchObject({ approvalState: 'APPROVED', targetDate: '2026-10-20' })
  })
})
