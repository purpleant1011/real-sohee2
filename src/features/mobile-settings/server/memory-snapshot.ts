import type { MemoryCandidate, MemoryKind } from '../memory-approval'
import type { MemoryApprovalViewSnapshot } from '../memory-approval-view'
import type { SourceResult } from './more-snapshot'

/** 조회 결과 한 갈래. ok=false 는 '값이 없음'이 아니라 '확인 실패'다. */
export type { SourceResult }

/** 서버 원본 한 줄 — 소희와의 대화에서 나온 '확인 대기' 제안(sohee_studio_proposals). */
export interface MemoryProposalRow {
  id: string
  category: string
  content: string
  createdAt: string
  /** 제안의 근거가 된 대화 메시지. 없으면 소희가 혼자 만든 값이다. */
  sourceMessageId: string | null
}

/** 지금 확정된 지식 한 줄(knowledge_facts, active). 제안과 같은 분류이면 '지금' 값이 된다. */
export interface MemoryFactRow {
  id: string
  category: string
  content: string
  approvedAt: string | null
}

export interface MemorySnapshotInput {
  workspaceId: string
  now: string
  proposals: SourceResult<MemoryProposalRow[]>
  facts: SourceResult<MemoryFactRow[]>
}

/** 화면 스냅샷 + 어느 가게 것인지. 다른 가게 응답을 그리지 않기 위해 클라이언트가 대조한다. */
export interface MemoryApiSnapshot extends MemoryApprovalViewSnapshot {
  workspaceId: string
}

/**
 * 분류 문자열 → 화면 라벨. 분류는 사장님이 쓴 자유 문구라 확실한 낱말이 있을 때만 좁힌다.
 * 애매하면 '가게 정보'로 남긴다(값을 지어내지 않는다).
 */
const KIND_RULES: ReadonlyArray<{ kind: MemoryKind; keywords: readonly string[] }> = [
  { kind: 'price', keywords: ['가격', '요금', '금액', '할인', 'price'] },
  { kind: 'hours', keywords: ['영업시간', '운영시간', '영업 시간', '운영 시간', '휴무', 'hours'] },
  { kind: 'policy', keywords: ['정책', '규칙', '취소', '환불', '예약금', 'policy', 'rule'] },
  { kind: 'service', keywords: ['서비스', '시술', '상품', '메뉴', 'service'] },
]

export function memoryKindOf(category: string): MemoryKind {
  const text = category.trim().toLowerCase()
  for (const rule of KIND_RULES) {
    if (rule.keywords.some(keyword => text.includes(keyword))) return rule.kind
  }
  return 'other'
}

/** 같은 분류인지 비교하는 키. 띄어쓰기·대소문자만 다르면 같은 항목으로 본다. */
function categoryKey(category: string): string {
  return category.toLowerCase().replace(/\s+/g, '')
}

function validProposal(row: MemoryProposalRow): boolean {
  return typeof row?.id === 'string' && row.id.trim() !== ''
    && typeof row?.category === 'string' && row.category.trim() !== ''
    && typeof row?.content === 'string' && row.content.trim() !== ''
    && typeof row?.createdAt === 'string'
}

function validFact(row: MemoryFactRow): boolean {
  return typeof row?.id === 'string' && row.id.trim() !== ''
    && typeof row?.category === 'string' && row.category.trim() !== ''
    && typeof row?.content === 'string' && row.content.trim() !== ''
}

/** 분류별 최신 확정값. 같은 분류가 여러 번 확정됐으면 가장 최근 것만 '지금' 값으로 쓴다. */
function indexFacts(rows: MemoryFactRow[]): Map<string, MemoryFactRow> {
  const byCategory = new Map<string, MemoryFactRow>()
  for (const row of rows) {
    if (!validFact(row)) continue
    const key = categoryKey(row.category)
    const kept = byCategory.get(key)
    if (!kept || approvedAtOf(row) >= approvedAtOf(kept)) byCategory.set(key, row)
  }
  return byCategory
}

function approvedAtOf(row: MemoryFactRow): number {
  const at = row.approvedAt ? Date.parse(row.approvedAt) : NaN
  return Number.isNaN(at) ? 0 : at
}

function createdAtOf(row: MemoryProposalRow): number {
  const at = Date.parse(row.createdAt)
  return Number.isNaN(at) ? 0 : at
}

/**
 * M22(ANI-1709) 가게 기억 승인 스냅샷 — 확인 대기 제안 + 현재 확정 지식만 읽는다.
 *
 * 후보는 '아직 승인되지 않은 제안'뿐이다. 확정된 지식은 이미 고객 안내에 쓰이고 있어 승인 대상이 아니다.
 * 한쪽 원천이라도 확인하지 못하면 후보를 만들지 않고 complete=false 로 남긴다:
 * 확정값을 못 읽은 상태에서 currentValue=null 을 쓰면 '아직 기억하지 못했어요' 라는 거짓 표시가 된다.
 */
export function buildMemorySnapshot(input: MemorySnapshotInput): MemoryApiSnapshot {
  const proposalsOk = input.proposals.ok && input.proposals.value !== null
  const factsOk = input.facts.ok && input.facts.value !== null
  const anyOk = proposalsOk || factsOk

  if (!anyOk) {
    return { loadState: 'error', workspaceId: input.workspaceId, candidates: [], complete: false, checkedAt: null }
  }
  if (!proposalsOk || !factsOk) {
    return { loadState: 'ready', workspaceId: input.workspaceId, candidates: [], complete: false, checkedAt: input.now }
  }

  const facts = indexFacts(input.facts.value ?? [])
  const seen = new Set<string>()
  const candidates: MemoryCandidate[] = []
  let rejected = 0

  const proposals = [...(input.proposals.value ?? [])].sort((a, b) => createdAtOf(b) - createdAtOf(a))
  for (const row of proposals) {
    if (!validProposal(row)) { rejected += 1; continue }
    const key = categoryKey(row.category)
    // 같은 분류의 옛 제안은 최신 제안으로 대체된 것으로 보고 한 줄만 남긴다.
    if (seen.has(key)) continue
    seen.add(key)

    const kind = memoryKindOf(row.category)
    const current = facts.get(key) ?? null
    const sourced = typeof row.sourceMessageId === 'string' && row.sourceMessageId.trim() !== ''
    candidates.push({
      key: `${kind}:${key}`,
      kind,
      proposalId: row.id,
      proposedValue: row.content,
      currentValue: current ? current.content : null,
      // 출처가 되는 대화가 없으면 소희가 혼자 만든 값이다. 확정값처럼 다루지 않는다.
      origin: sourced ? 'owner_stated' : 'sohee_inferred',
      source: sourced
        ? { label: '소희와의 대화', href: null, observedAt: row.createdAt }
        : null,
      // 근거 있는 제안만 승인 후 고객 안내에 쓰인다. 추측은 고객에게 나가지 않는다.
      customerVisible: sourced,
    })
  }

  return {
    loadState: 'ready',
    workspaceId: input.workspaceId,
    candidates,
    complete: rejected === 0,
    checkedAt: input.now,
  }
}

/** 다른 가게·형식 불일치 스냅샷은 그리지 않는다. */
export function isMemoryApiSnapshot(value: unknown, workspaceId: string): value is MemoryApiSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.loadState === 'string'
    && v.workspaceId === workspaceId
    && Array.isArray(v.candidates)
    && typeof v.complete === 'boolean'
    && (v.checkedAt === null || typeof v.checkedAt === 'string')
}
