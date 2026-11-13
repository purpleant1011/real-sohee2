/**
 * Knowledge Source Ingestion Service (HF-55 / ANI-1405)
 * Handles ingestion from Manual, URL, File, and SNS sources.
 * Enforces provenance, candidate extraction, conflict isolation,
 * freshness tracking, and strict tenant boundary security.
 */

import { randomUUID, createHash } from 'node:crypto'
import type {
  IngestionSource,
  SourceRecord,
  KnowledgeCandidate,
  KnowledgeCandidateDomain,
  ConfirmedKnowledgeVersion,
  VersionLineage,
} from './types'
import { validateUrlForSsrf } from './ssrf-validator'

export class IngestionSecurityError extends Error {
  readonly code: string
  constructor(message: string, code = 'INGESTION_SECURITY_ERROR') {
    super(`${code}: ${message}`)
    this.name = 'IngestionSecurityError'
    this.code = code
  }
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
])

export class KnowledgeSourceIngestionService {
  private sourceRecords = new Map<string, SourceRecord>()
  private candidates = new Map<string, KnowledgeCandidate>()
  private activeFacts = new Map<string, Map<string, string>>() // ws -> (domain -> value)
  private confirmedVersions = new Map<string, ConfirmedKnowledgeVersion[]>() // ws -> versions
  private lineages = new Map<string, VersionLineage>() // `${ws}:${versionNumber}` -> lineage

  /**
   * 소스 수집 및 후보(Candidate) 추출
   */
  async ingestSource(source: IngestionSource): Promise<{
    candidates: KnowledgeCandidate[]
    sourceRecord: SourceRecord
  }> {
    const { workspaceId, sourceType, locator, content, fileSize, mimeType, sourceCreatedAt, actorId } = source

    // 1. URL SSRF 및 사설망 방어
    if (sourceType === 'URL') {
      validateUrlForSsrf(locator)
    }

    // 2. 파일 크기 및 MIME 타입 검증
    if (sourceType === 'FILE_DOCUMENT') {
      if (fileSize && fileSize > 10 * 1024 * 1024) {
        throw new IngestionSecurityError('File size exceeds 10MB limit', 'FILE_TOO_LARGE')
      }
      if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new IngestionSecurityError(`Disallowed mime type: ${mimeType}`, 'INVALID_FILE_TYPE')
      }
    }

    // 3. 소스 레코드 생성 및 해시 보존
    const now = new Date().toISOString()
    const contentHash = createHash('sha256').update(content).digest('hex')
    const sourceRecordId = randomUUID()

    const sourceRecord: SourceRecord = {
      id: sourceRecordId,
      workspaceId,
      sourceType,
      locator,
      contentHash,
      ingestedAt: now,
      actorId,
    }
    this.sourceRecords.set(sourceRecordId, sourceRecord)

    // 4. Freshness 검사 (180일 이상 경과 시 STALE)
    let isStale = false
    let freshnessWarning: string | undefined
    if (sourceCreatedAt) {
      const createdTime = new Date(sourceCreatedAt).getTime()
      const ageDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24)
      if (ageDays > 180) {
        isStale = true
        freshnessWarning = `Source is older than 180 days (${Math.round(ageDays)} days old)`
      }
    }

    // 5. 도메인별 후보 추출
    const extractedCandidates: KnowledgeCandidate[] = []
    const domainsToExtract = this.detectDomainsFromContent(content)

    for (const domain of domainsToExtract) {
      const candidateId = randomUUID()
      const candidate: KnowledgeCandidate = {
        id: candidateId,
        workspaceId,
        domain,
        value: content,
        status: 'CANDIDATE',
        confidence: 0.95,
        freshness: isStale ? 'STALE' : 'FRESH',
        freshnessWarning,
        conflictState: 'NONE',
        provenance: {
          sourceRecordId,
          sourceType,
          locator,
          contentHash,
          extractedAt: now,
        },
      }

      // Conflict 감지: 동일 도메인에 다른 값이 이미 존재하는 경우
      const existingInDomain = this.getCandidatesByDomain(workspaceId, domain)
      if (existingInDomain.length > 0 && existingInDomain.some((c) => c.value !== content)) {
        candidate.conflictState = 'CONFLICT'
        candidate.conflictMessage = '기존 정보와 상충하는 정보가 감지되었습니다. 확인이 필요합니다.'
        // 기존 것도 CONFLICT로 마킹
        for (const exist of existingInDomain) {
          exist.conflictState = 'CONFLICT'
          exist.conflictMessage = '새로 수집된 정보와 상충하는 내용이 감지되었습니다.'
        }
      }

      this.candidates.set(candidateId, candidate)
      extractedCandidates.push(candidate)
    }

    return { candidates: extractedCandidates, sourceRecord }
  }

  /**
   * 키워드 기반 도메인 분류기
   */
  private detectDomainsFromContent(content: string): KnowledgeCandidateDomain[] {
    const domains: KnowledgeCandidateDomain[] = []
    const lower = content.toLowerCase()

    if (lower.includes('오전') || lower.includes('오후') || lower.includes('영업시간') || lower.includes('주소') || lower.includes('휴무') || lower.includes('위치')) {
      domains.push('Location & Hours')
    }
    if (lower.includes('메뉴') || lower.includes('원두') || lower.includes('스페셜티') || lower.includes('카페') || lower.includes('음료')) {
      domains.push('Offerings')
    }
    if (lower.includes('원') || lower.includes('가격') || lower.includes('라떼') || lower.includes('아메리카노') || lower.includes('금액')) {
      domains.push('Pricing')
    }
    if (lower.includes('예약') || lower.includes('네이버') || lower.includes('dm') || lower.includes('인스타그램 dm')) {
      domains.push('Reservation / Booking Rules')
    }
    if (lower.includes('차별화') || lower.includes('국산') || lower.includes('재료') || lower.includes('유기농')) {
      domains.push('Differentiation')
    }
    if (lower.includes('할인') || lower.includes('이벤트') || lower.includes('프로모션') || lower.includes('%')) {
      domains.push('Promotions')
    }
    if (lower.includes('화학') || lower.includes('방부제') || lower.includes('안전') || lower.includes('금지')) {
      domains.push('Safety / Forbidden Claims')
    }
    if (lower.includes('브랜드') || lower.includes('매장') || lower.includes('소희') || lower.includes('상호')) {
      if (!domains.includes('Business Identity')) {
        domains.push('Business Identity')
      }
    }

    if (domains.length === 0) {
      domains.push('Business Identity')
    }

    return domains
  }

  /**
   * 사용자의 명시적 후보 승인 (Confirm) -> 새 버전 발행
   */
  async confirmCandidate(params: {
    workspaceId: string
    candidateId: string
    userId: string
  }): Promise<ConfirmedKnowledgeVersion> {
    const { workspaceId, candidateId, userId } = params
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      throw new IngestionSecurityError(`Candidate ${candidateId} not found`, 'CANDIDATE_NOT_FOUND')
    }

    // 테넌트 격리 검증
    if (candidate.workspaceId !== workspaceId) {
      throw new IngestionSecurityError(
        `Candidate ${candidateId} does not belong to workspace ${workspaceId}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }

    candidate.status = 'CONFIRMED'

    // Active Facts 갱신
    let facts = this.activeFacts.get(workspaceId)
    if (!facts) {
      facts = new Map<string, string>()
      this.activeFacts.set(workspaceId, facts)
    }
    facts.set(candidate.domain, candidate.value)

    // Confirmed Version 생성
    const versions = this.confirmedVersions.get(workspaceId) || []
    const nextVersionNum = versions.length + 1
    const now = new Date().toISOString()

    const versionObj: ConfirmedKnowledgeVersion = {
      versionNumber: nextVersionNum,
      workspaceId,
      facts: Object.fromEntries(facts.entries()),
      candidateId,
      confirmedBy: userId,
      confirmedAt: now,
    }

    versions.push(versionObj)
    this.confirmedVersions.set(workspaceId, versions)

    // Lineage 기록
    this.lineages.set(`${workspaceId}:${nextVersionNum}`, {
      versionNumber: nextVersionNum,
      sourceRecordId: candidate.provenance.sourceRecordId,
      sourceType: candidate.provenance.sourceType,
      sourceLocator: candidate.provenance.locator,
      confirmedBy: userId,
      confirmedAt: now,
    })

    return versionObj
  }

  /**
   * 확정된(Confirmed) 활성 사실 목록 조회
   */
  getActiveFacts(workspaceId: string): Record<string, string> {
    const facts = this.activeFacts.get(workspaceId)
    return facts ? Object.fromEntries(facts.entries()) : {}
  }

  /**
   * 런타임 프롬프트 그라운딩용 컨텍스트 조회 (미확정 Candidate는 원천 배제)
   */
  getRuntimeGroundingContext(workspaceId: string): string {
    const facts = this.getActiveFacts(workspaceId)
    return Object.entries(facts)
      .map(([k, v]) => `[${k}]: ${v}`)
      .join('\n')
  }

  /**
   * 도메인별 후보 목록 조회
   */
  getCandidatesByDomain(workspaceId: string, domain: KnowledgeCandidateDomain): KnowledgeCandidate[] {
    const result: KnowledgeCandidate[] = []
    for (const c of this.candidates.values()) {
      if (c.workspaceId === workspaceId && c.domain === domain) {
        result.push(c)
      }
    }
    return result
  }

  /**
   * 단일 후보 조회 (테넌트 격리)
   */
  getCandidate(workspaceId: string, candidateId: string): KnowledgeCandidate {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      throw new IngestionSecurityError(`Candidate ${candidateId} not found`, 'CANDIDATE_NOT_FOUND')
    }
    if (candidate.workspaceId !== workspaceId) {
      throw new IngestionSecurityError(
        `Candidate ${candidateId} does not belong to workspace ${workspaceId}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }
    return { ...candidate }
  }

  /**
   * 확정된 지식 버전의 출처 계보 역추적
   */
  getVersionLineage(workspaceId: string, versionNumber: number): VersionLineage {
    const key = `${workspaceId}:${versionNumber}`
    const lineage = this.lineages.get(key)
    if (!lineage) {
      throw new IngestionSecurityError(`Lineage for version ${versionNumber} not found`, 'LINEAGE_NOT_FOUND')
    }
    return { ...lineage }
  }
}
