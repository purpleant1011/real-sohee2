import { buildBaseDraft } from '../base-draft'
import { checkBusinessClaims } from '../claim-guard'
import { editChannelDraftVariant } from '../edit'
import { generateChannelDraft } from '../generate'
import type { ChannelDraftRepository } from '../ports'
import type { ChannelDraftResult, GroundedBusinessContext } from '../types'
import { createGeminiTextGenerator } from '@/features/vault/transform/adapters/gemini'

/**
 * 개발 전용 라이브 데모 구성. 로그인·DB 없이 실제 Gemini로 4채널 글을 만들어 화면을 눈으로 확인한다.
 * 운영 코드 경로(compose.ts)와 같은 생성·수정 서비스를 쓰되, 저장소만 메모리 구현이고 보관(vault)은 하지 않는다.
 */
export const LIVE_DEMO_BUSINESSES = {
  cafe: {
    label: '성수동 모모 카페 (가격 정보 없음)',
    ctx: {
      businessName: '모모 카페', industry: '카페', location: '성수동',
      facts: [
        { kind: 'profile', label: '소개', value: '직접 로스팅한 원두로 내리는 동네 카페' },
        { kind: 'offering', label: '대표 메뉴', value: '딸기라떼' },
        { kind: 'offering', label: '대표 메뉴', value: '수제 스콘' },
      ],
      tone: { presetKey: 'friendly', brandVoice: '이웃에게 말을 건네듯 친근하고 다정한 존댓말' },
      knowledgeVersion: 3, warnings: ['가격 정보가 없어서 가격·할인 문구는 넣지 않아요'],
    },
  },
  nail: {
    label: '연남동 라온 네일 (기본 젤 55,000원 확인됨)',
    ctx: {
      businessName: '라온 네일', industry: '네일', location: '연남동',
      facts: [
        { kind: 'profile', label: '소개', value: '1:1 예약제로 운영하는 아담한 네일 공간' },
        { kind: 'offering', label: '대표 서비스', value: '젤 네일 (기본 55,000원)' },
        { kind: 'policy', label: '예약', value: '전 시술 1:1 예약제' },
      ],
      tone: { presetKey: 'calm', brandVoice: '꾸밈을 줄이고 담백하며 정갈한 존댓말' },
      knowledgeVersion: 2, warnings: [],
    },
  },
  academy: {
    label: '목동 새빛 수학학원 (수강료 정보 없음)',
    ctx: {
      businessName: '새빛 수학학원', industry: '학원', location: '목동',
      facts: [
        { kind: 'profile', label: '소개', value: '초·중등 수학을 소수 정원으로 가르치는 동네 학원' },
        { kind: 'offering', label: '대표 과정', value: '중등 내신 대비반' },
        { kind: 'policy', label: '운영', value: '반별 정원 8명' },
      ],
      tone: { presetKey: 'professional', brandVoice: '전문가다운 차분하고 신뢰감 있는 존댓말' },
      knowledgeVersion: 1, warnings: ['수강료 정보가 없어서 가격 문구는 넣지 않아요'],
    },
  },
} as const satisfies Record<string, { label: string; ctx: GroundedBusinessContext }>

export type LiveDemoBusinessKey = keyof typeof LIVE_DEMO_BUSINESSES
export const isLiveDemoBusiness = (value: string | null): value is LiveDemoBusinessKey =>
  value !== null && Object.hasOwn(LIVE_DEMO_BUSINESSES, value)

const drafts = new Map<string, ChannelDraftResult>()
const reserved = new Set<string>()
const versions = new Map<string, number>()
const memoryRepo: ChannelDraftRepository = {
  async reserve(input) {
    const key = `${input.workspaceId}:${input.requestKey}`
    const existing = drafts.get(key)
    if (existing) return { kind: 'existing', result: existing }
    if (reserved.has(key)) return { kind: 'pending' }
    if ([...drafts.keys()].filter((k) => k.startsWith(`${input.workspaceId}:`)).length >= 30) return { kind: 'limit' }
    reserved.add(key)
    return { kind: 'acquired' }
  },
  async release(workspaceId, requestKey) { reserved.delete(`${workspaceId}:${requestKey}`) },
  async findByRequestKey(workspaceId, requestKey) { return drafts.get(`${workspaceId}:${requestKey}`) ?? null },
  async findEditSnapshot(workspaceId, requestKey) {
    const draft = drafts.get(`${workspaceId}:${requestKey}`)
    return draft ? { draft, knowledgeVersion: versions.get(`${workspaceId}:${requestKey}`) ?? 0 } : null
  },
  async updateVariant(workspaceId, requestKey, channel, expected, next) {
    const key = `${workspaceId}:${requestKey}`
    const draft = drafts.get(key)
    const current = draft?.variants.find((v) => v.channel === channel)
    if (!draft || !current || JSON.stringify(current) !== JSON.stringify(expected)) return null
    const updated = { ...draft, variants: draft.variants.map((v) => (v.channel === channel ? demoVariant(next) : v)) }
    drafts.set(key, updated)
    return updated
  },
  async countSince(workspaceId) { return [...drafts.keys()].filter((k) => k.startsWith(`${workspaceId}:`)).length },
  async save(input) {
    const result: ChannelDraftResult = {
      requestKey: input.requestKey, topic: input.topic, createdAt: new Date().toISOString(),
      basisNotes: input.basisNotes, imageNotice: input.imageNotice,
      variants: input.variants.map(({ savableReason, ...variant }) => demoVariant({
        ...variant, contentId: null, versionId: null, vaultSavable: false, blockedReason: savableReason,
      })),
    }
    const key = `${input.workspaceId}:${input.requestKey}`
    drafts.set(key, result)
    versions.set(key, input.knowledgeVersion)
    reserved.delete(key)
    return result
  },
  async listRecent(workspaceId, limit) {
    return [...drafts.entries()].filter(([k]) => k.startsWith(`${workspaceId}:`)).map(([, v]) => v).slice(-limit).reverse()
  },
}

const DEMO_NOTICE = '개발용 화면이라 보관은 하지 않아요. 로그인한 소희 화면에서 보관할 수 있어요.'
function demoVariant<T extends { vaultSavable: boolean; blockedReason: string | null }>(variant: T): T {
  return { ...variant, vaultSavable: false, blockedReason: variant.blockedReason ?? DEMO_NOTICE }
}

export function createLiveDemoService(business: LiveDemoBusinessKey) {
  const ctx = LIVE_DEMO_BUSINESSES[business].ctx as GroundedBusinessContext
  const deps = {
    loadContext: async () => ctx,
    buildBaseDraft,
    checkClaims: checkBusinessClaims,
    text: createGeminiTextGenerator(),
    image: async () => ({ imageIds: [], notice: '개발용 화면에서는 사진을 만들지 않아요.', media: [] }),
    repo: memoryRepo,
  }
  const workspaceId = `00000000-0000-4000-8000-${business === 'cafe' ? '0000000000c1' : business === 'nail' ? '0000000000c2' : '0000000000c3'}`
  const userId = '00000000-0000-4000-8000-0000000000aa'
  return {
    generate: (topic: string, requestKey: string) =>
      generateChannelDraft({ workspaceId, userId, topic, requestKey, includeImage: false }, deps),
    edit: (requestKey: string, channel: Parameters<typeof editChannelDraftVariant>[0]['channel'], edits: Parameters<typeof editChannelDraftVariant>[0]['edits']) =>
      editChannelDraftVariant({ workspaceId, userId, requestKey, channel, edits }, deps),
  }
}
