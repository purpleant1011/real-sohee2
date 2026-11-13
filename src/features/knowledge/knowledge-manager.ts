/**
 * SOHEE V0.91 · M2 Business Knowledge Manager (HF-13)
 * 
 * Rules:
 * 1. Lineage: Source -> Candidate -> Confirmed Fact -> Immutable Version.
 * 2. Pre-confirm Grounding Prohibition: Candidate items (status='PENDING_REVIEW')
 *    MUST NOT be used in AI agent grounding until confirmed by human owner.
 * 3. Immutable Versioning: Confirmed facts are snapshotted into KnowledgeHarnessVersion.
 */

export type KnowledgeCategory =
  | 'MENU'
  | 'PRICE'
  | 'HOURS'
  | 'PARKING'
  | 'DIFFERENTIATOR'
  | 'FAQ'
  | 'PROHIBITED'

export type CandidateStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'

export interface KnowledgeCandidate {
  id: string
  workspaceId: string
  sourceId: string
  category: KnowledgeCategory
  key: string
  candidateValue: string
  confidence: number
  status: CandidateStatus
  createdAt: string
}

export interface ConfirmedKnowledgeFact {
  id: string
  workspaceId: string
  candidateId: string
  category: KnowledgeCategory
  factKey: string
  factValue: string
  status: 'ACTIVE' | 'ARCHIVED'
  confirmedBy: string
  confirmedAt: string
}

export interface KnowledgeHarnessVersion {
  id: string
  workspaceId: string
  versionNumber: number
  factsSnapshot: ConfirmedKnowledgeFact[]
  createdAt: string
  createdBy: string
}

export interface CreateCandidateParams {
  workspaceId: string
  sourceId: string
  category: KnowledgeCategory
  key: string
  candidateValue: string
  confidence: number
}

export function createKnowledgeCandidate(
  params: CreateCandidateParams
): KnowledgeCandidate {
  return {
    id: `cand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    workspaceId: params.workspaceId,
    sourceId: params.sourceId,
    category: params.category,
    key: params.key,
    candidateValue: params.candidateValue,
    confidence: params.confidence,
    status: 'PENDING_REVIEW',
    createdAt: new Date().toISOString(),
  }
}

export interface ConfirmKnowledgeFactsParams {
  workspaceId: string
  approvedCandidates: KnowledgeCandidate[]
  userId: string
  previousVersionNumber?: number
}

export function confirmKnowledgeFacts(
  params: ConfirmKnowledgeFactsParams
): KnowledgeHarnessVersion {
  const confirmedAt = new Date().toISOString()
  const confirmedFacts: ConfirmedKnowledgeFact[] = params.approvedCandidates.map(
    (cand, idx) => ({
      id: `fact_${Date.now()}_${idx}`,
      workspaceId: params.workspaceId,
      candidateId: cand.id,
      category: cand.category,
      factKey: cand.key,
      factValue: cand.candidateValue,
      status: 'ACTIVE',
      confirmedBy: params.userId,
      confirmedAt,
    })
  )

  const newVersionNumber = (params.previousVersionNumber ?? 0) + 1

  return {
    id: `kn_ver_${Date.now()}_v${newVersionNumber}`,
    workspaceId: params.workspaceId,
    versionNumber: newVersionNumber,
    factsSnapshot: confirmedFacts,
    createdAt: confirmedAt,
    createdBy: params.userId,
  }
}

export interface GroundingKnowledgeResult {
  facts: ConfirmedKnowledgeFact[]
  groundingText: string
}

/**
 * HF-13: Strict Grounding Safety Gate
 * ONLY confirmed facts are included. Unconfirmed candidates are strictly omitted.
 */
export function getGroundingKnowledge(inputs: {
  candidates?: KnowledgeCandidate[]
  confirmedFacts?: ConfirmedKnowledgeFact[]
}): GroundingKnowledgeResult {
  const activeFacts = (inputs.confirmedFacts || []).filter(
    (f) => f.status === 'ACTIVE'
  )

  if (activeFacts.length === 0) {
    return {
      facts: [],
      groundingText: '',
    }
  }

  const lines = activeFacts.map(
    (f) => `[${f.category}] ${f.factKey}: ${f.factValue}`
  )

  return {
    facts: activeFacts,
    groundingText: `[소희 공인 매장 정보 정본]\n${lines.join('\n')}`,
  }
}

