import {
  type LearningCandidate,
  type LearningPlatform,
  type LearningPurpose,
  type SourceRef,
} from './contracts'

export const MAX_SERVER_CONTEXT_CHARACTERS = 10000

export interface ApprovedCandidateWithSource extends LearningCandidate {
  sourcePlatform: LearningPlatform
  sourceRevision: number
  sourceStatus: 'pending' | 'verified' | 'expired' | 'revoked' | 'failed'
  leaseExpiresAt: string
  isRevoked: boolean
}

export interface ContextDeps {
  getApprovedCandidates: (workspaceId: string, query?: string) => Promise<ApprovedCandidateWithSource[]>
  getWorkspaceEpoch: (workspaceId: string) => Promise<number>
  getManualFacts?: (workspaceId: string) => Promise<Array<{ id: string; category: string; content: string }>>
  now?: () => Date
}

function calculateRelevanceScore(
  candidate: ApprovedCandidateWithSource,
  queryTokens: string[],
  channel: LearningPlatform,
): number {
  let score = 0
  const contentLower = candidate.content.toLowerCase()

  // Channel bonus
  if (candidate.sourcePlatform === channel) {
    score += 5
  }

  // Query token matching
  for (const token of queryTokens) {
    if (token.length > 1 && contentLower.includes(token)) {
      score += 10
    }
  }

  // Category priority for specific queries
  if (queryTokens.some((t) => t.includes('가격') || t.includes('원') || t.includes('메뉴'))) {
    if (candidate.category === 'price' || candidate.category === 'offering') {
      score += 15
    }
  }
  if (queryTokens.some((t) => t.includes('시간') || t.includes('휴무') || t.includes('휴일') || t.includes('주차'))) {
    if (candidate.category === 'hours' || candidate.category === 'policy') {
      score += 15
    }
  }

  // Recency / version bonus
  score += candidate.version

  return score
}

export async function buildLearningContext(
  input: {
    workspaceId: string
    purpose: LearningPurpose
    query: string
    channel: LearningPlatform
    maxCharacters: number
  },
  deps: ContextDeps,
): Promise<{
  text: string
  imageStyle: string | null
  dependencies: SourceRef[]
  epoch: number
}> {
  const getNow = deps.now ?? (() => new Date())
  const now = getNow()
  const cappedMaxChars = Math.min(Math.max(1, input.maxCharacters), MAX_SERVER_CONTEXT_CHARACTERS)

  const epoch = await deps.getWorkspaceEpoch(input.workspaceId)
  const rawCandidates = await deps.getApprovedCandidates(input.workspaceId, input.query)

  // 1. Authoritative security & lease filtering
  const validCandidates = rawCandidates.filter((c) => {
    if (c.source.workspaceId !== input.workspaceId) return false
    if (c.status !== 'approved') return false
    if (c.isRevoked || c.sourceStatus !== 'verified') return false
    if (c.sourceRevision !== c.source.revision) return false
    const expTime = new Date(c.leaseExpiresAt).getTime()
    if (Number.isNaN(expTime) || expTime <= now.getTime()) return false
    return true
  })

  // 2. Purpose: image
  if (input.purpose === 'image') {
    const visualCandidates = validCandidates.filter(
      (c) => c.category === 'visual' && Boolean(c.evidence.visionReceiptId),
    )
    visualCandidates.sort((a, b) => b.version - a.version || b.source.revision - a.source.revision)
    const latestVisual = visualCandidates[0]
    const imageStyle = latestVisual ? latestVisual.content.slice(0, cappedMaxChars) : null
    const dependencies = latestVisual ? [latestVisual.source] : []

    return {
      text: '',
      imageStyle,
      dependencies,
      epoch,
    }
  }

  // 3. Purpose: conversation or content
  const queryTokens = input.query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  // Rank by relevance
  const scored = validCandidates.map((c) => ({
    candidate: c,
    score: calculateRelevanceScore(c, queryTokens, input.channel),
  }))

  scored.sort((a, b) => b.score - a.score)

  const includedTexts: string[] = []
  const dependencies: SourceRef[] = []
  const seenDeps = new Set<string>()
  let currentLength = 0

  const priceRegex = /(?:\d[\d,.]*\s*(?:원|₩)|가격|가격표|정가|판매가|요금|비용|금액|메뉴판)/u
  let hasManualPrice = false

  // Manual facts prioritized first if provided
  if (deps.getManualFacts) {
    const manualList = await deps.getManualFacts(input.workspaceId)
    for (const mf of manualList || []) {
      const line = mf.content.trim()
      if (!line) continue
      if (priceRegex.test(line) || mf.category === 'price') {
        hasManualPrice = true
      }
      const addedLength = line.length + (includedTexts.length > 0 ? 1 : 0)
      if (currentLength + addedLength <= cappedMaxChars) {
        includedTexts.push(line)
        currentLength += addedLength
      }
    }
  }

  let includedChannelPrice = false

  for (const item of scored) {
    // Prevent contradictory price injection:
    // If manual facts already establish authoritative price, skip conflicting channel prices.
    // If no manual price, allow at most one highest-ranking channel price.
    if (item.candidate.category === 'price' || priceRegex.test(item.candidate.content)) {
      if (hasManualPrice || includedChannelPrice) {
        continue
      }
      includedChannelPrice = true
    }

    const line = item.candidate.content.trim()
    const addedLength = line.length + (includedTexts.length > 0 ? 1 : 0)

    if (currentLength + addedLength > cappedMaxChars) {
      if (includedTexts.length === 0) {
        // Truncate to fit if even one line exceeds
        const truncated = line.slice(0, cappedMaxChars)
        includedTexts.push(truncated)
        const depKey = `${item.candidate.source.workspaceId}:${item.candidate.source.sourceId}:${item.candidate.source.revision}`
        if (!seenDeps.has(depKey)) {
          seenDeps.add(depKey)
          dependencies.push(item.candidate.source)
        }
      }
      break
    }

    includedTexts.push(line)
    currentLength += addedLength

    const depKey = `${item.candidate.source.workspaceId}:${item.candidate.source.sourceId}:${item.candidate.source.revision}`
    if (!seenDeps.has(depKey)) {
      seenDeps.add(depKey)
      dependencies.push(item.candidate.source)
    }
  }

  return {
    text: includedTexts.join('\n'),
    imageStyle: null,
    dependencies,
    epoch,
  }
}
