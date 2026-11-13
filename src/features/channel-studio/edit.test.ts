import { describe, expect, it, vi } from 'vitest'
import { checkBusinessClaims } from './claim-guard'
import { editChannelDraftVariant } from './edit'
import type { ChannelDraftRepository } from './ports'
import type { ChannelDraftEditSnapshot, ChannelDraftResult, GroundedBusinessContext } from './types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const requestKey = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const context: GroundedBusinessContext = { businessName: '카페', industry: '카페', location: '서울', facts: [{ kind: 'offering', label: '음료', value: '커피' }], tone: { presetKey: null, brandVoice: '' }, knowledgeVersion: 3, warnings: [] }
const variants: ChannelDraftResult['variants'] = [
  { channel: 'threads', payload: { text: '원본 커피' }, status: 'READY', statusLabel: '보관할 수 있어요', issues: [], contentId: '44444444-4444-4444-8444-444444444444', versionId: '55555555-5555-4555-8555-555555555555', vaultSavable: true, blockedReason: null },
  { channel: 'instagram', payload: { caption: '커피 소식', hashtags: [] }, status: 'READY', statusLabel: '보관할 수 있어요', issues: [], contentId: null, versionId: null, vaultSavable: false, blockedReason: null },
]
const initial: ChannelDraftEditSnapshot = { knowledgeVersion: 3, draft: { requestKey, topic: '카페 소개', createdAt: '2026-10-08T00:00:00Z', basisNotes: [], imageNotice: null, variants } }
function setup(snapshot: ChannelDraftEditSnapshot | null = initial) {
  const stored = structuredClone(snapshot)
  const repo = {
    findEditSnapshot: vi.fn(async (workspace: string) => workspace === workspaceId ? structuredClone(stored) : null),
    updateVariant: vi.fn(async (_workspace: string, _key: string, channel: string, expected: typeof variants[number], next: typeof variants[number]) => {
      if (!stored?.draft.variants.some(v => v.channel === channel && JSON.stringify(v) === JSON.stringify(expected))) return null
      stored.draft.variants = stored.draft.variants.map(v => v.channel === channel ? { ...next, contentId: next.status === 'READY' ? v.contentId ?? crypto.randomUUID() : null, versionId: next.status === 'READY' ? crypto.randomUUID() : null } : v)
      return structuredClone(stored.draft)
    }),
  }
  const deps = { repo: repo as unknown as ChannelDraftRepository, loadContext: vi.fn(async () => context), checkClaims: checkBusinessClaims }
  const req = { workspaceId, requestKey, userId, channel: 'threads' as const, edits: { text: '수정한 커피' } }
  return { deps, repo, req }
}

describe('채널 글 수정 재검사', () => {
  it('채널 허용 키만 반영하고 제어문자를 정리하며 다른 채널은 보존한다', async () => {
    const { deps, req } = setup()
    const result = await editChannelDraftVariant({ ...req, edits: { text: '  새 커피\u0000 소식 ', caption: '금지', hashtags: ['금지'], title: '금지' } }, deps)
    expect(result.variants[0].payload).toEqual({ text: '새 커피 소식' })
    expect(result.variants[1]).toEqual(variants[1])
    expect(result.variants[0]).toMatchObject({ status: 'READY', vaultSavable: true, versionId: expect.any(String) })
    expect(result.variants[0].versionId).not.toBe(variants[0].versionId)
  })
  it('확인되지 않은 가격은 확인 필요, 보관 불가로 재평가한다', async () => {
    const { deps, req } = setup()
    const result = await editChannelDraftVariant({ ...req, edits: { text: '커피는 9000원입니다.' } }, deps)
    expect(result.variants[0]).toMatchObject({ status: 'NEEDS_CHECK', vaultSavable: false, contentId: null, versionId: null })
    expect(result.variants[0].issues.join(' ')).toMatch(/가격/)
  })
  it('네이버 본문 수정은 단일 문단 블록과 동일한 본문으로 저장한다', async () => {
    const draft = structuredClone(initial)
    draft.draft.variants.push({ channel: 'naver_blog', payload: { title: '제목', text: '옛 글', blocks: [{ type: 'paragraph', text: '옛 글' }] }, status: 'NEEDS_FIX', statusLabel: '수정이 필요해요', issues: ['이미지를 추가해 주세요.'], contentId: null, versionId: null, vaultSavable: false, blockedReason: '이미지를 추가해 주세요.' })
    const { deps, req } = setup(draft)
    const result = await editChannelDraftVariant({ ...req, channel: 'naver_blog', edits: { title: '새 제목', text: '새 본문' } }, deps)
    expect(result.variants.find(v => v.channel === 'naver_blog')?.payload).toMatchObject({ title: '새 제목', text: '새 본문', blocks: [{ type: 'paragraph', text: '새 본문' }] })
  })
  it('규격이 풀리면 새 버전을 생성하고 원본은 불변이다', async () => {
    const broken = structuredClone(initial)
    broken.draft.variants[0] = { ...broken.draft.variants[0], payload: { text: '커피'.repeat(300) }, status: 'NEEDS_FIX', contentId: null, versionId: null, vaultSavable: false, blockedReason: '수정 필요' }
    const { deps, req } = setup(broken)
    const result = await editChannelDraftVariant(req, deps)
    expect(result.variants[0]).toMatchObject({ status: 'READY', vaultSavable: true, contentId: expect.any(String), versionId: expect.any(String) })
    expect(broken.draft.variants[0].versionId).toBeNull()
  })
  it('없는 매장 키는 404, 생성 중인 빈 초안은 409로 거절한다', async () => {
    const { deps, req } = setup()
    await expect(editChannelDraftVariant({ ...req, workspaceId: '77777777-7777-4777-8777-777777777777' }, deps)).rejects.toMatchObject({ status: 404 })
    const pending = setup({ ...initial, draft: { ...initial.draft, variants: [] } })
    await expect(editChannelDraftVariant(pending.req, pending.deps)).rejects.toMatchObject({ status: 409 })
  })
  it('동일한 스냅샷에서 경합하면 첫 수정만 성공한다', async () => {
    const { deps, repo, req } = setup()
    const first = await editChannelDraftVariant(req, deps)
    expect(first.variants[0].payload.text).toBe('수정한 커피')
    // Two reads have the same expected snapshot, but only one compare-and-set succeeds.
    repo.findEditSnapshot.mockResolvedValueOnce(structuredClone(initial))
    await expect(editChannelDraftVariant({ ...req, edits: { text: '나중 수정' } }, deps)).rejects.toMatchObject({ status: 409 })
  })
  it('보관함 한도보다 긴 당근 글은 READY로 표시하지 않는다', async () => {
    const draft = structuredClone(initial)
    draft.draft.variants.push({ channel: 'daangn_business', payload: { text: '짧은 글' }, status: 'READY', statusLabel: '보관할 수 있어요', issues: [], contentId: null, versionId: null, vaultSavable: false, blockedReason: null })
    const { deps, req } = setup(draft)
    const result = await editChannelDraftVariant({ ...req, channel: 'daangn_business', edits: { text: '가'.repeat(2201) } }, deps)
    expect(result.variants.find(v => v.channel === 'daangn_business')).toMatchObject({ status: 'NEEDS_FIX', vaultSavable: false, contentId: null, versionId: null })
  })
  it('지식 버전이 바뀌면 이전 근거로 READY를 허용하지 않는다', async () => {
    const { deps, req, repo } = setup()
    deps.loadContext = vi.fn(async () => ({ ...context, knowledgeVersion: 4 }))
    await expect(editChannelDraftVariant(req, deps)).rejects.toMatchObject({ status: 409 })
    expect(repo.updateVariant).not.toHaveBeenCalled()
  })
  it('본문과 블록에 남은 가격 주장은 본문 수정으로도 보관 불가로 처리한다', async () => {
    const draft = structuredClone(initial)
    draft.draft.variants.push({ channel: 'naver_blog', payload: { title: '제목', text: '커피 소식', blocks: [{ type: 'paragraph', text: '커피 소식' }] }, status: 'NEEDS_FIX', statusLabel: '수정이 필요해요', issues: [], contentId: null, versionId: null, vaultSavable: false, blockedReason: '이미지가 없어요.' })
    const { deps, req } = setup(draft)
    const result = await editChannelDraftVariant({ ...req, channel: 'naver_blog', edits: { text: '커피 9000원' } }, deps)
    expect(result.variants.find(v => v.channel === 'naver_blog')).toMatchObject({ status: 'NEEDS_FIX', vaultSavable: false, contentId: null, versionId: null })
  })
  it('편집 가능한 모든 필드가 금지 키면 기존 글을 덮어쓰지 않는다', async () => {
    const { deps, req, repo } = setup()
    await expect(editChannelDraftVariant({ ...req, edits: { caption: '금지' } }, deps)).rejects.toMatchObject({ status: 400 })
    expect(repo.updateVariant).not.toHaveBeenCalled()
  })
  it('입력 상한을 넘으면 저장하지 않는다', async () => {
    const { deps, req, repo } = setup()
    await expect(editChannelDraftVariant({ ...req, edits: { text: '가'.repeat(20001) } }, deps)).rejects.toMatchObject({ status: 400 })
    expect(repo.updateVariant).not.toHaveBeenCalled()
  })
})
