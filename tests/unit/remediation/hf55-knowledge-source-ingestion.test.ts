import { describe, it, expect, beforeEach } from 'vitest'
import {
  KnowledgeSourceIngestionService,
  type IngestionSource,
} from '@/features/knowledge-source-ingestion'

describe('HF-55 / ANI-1405 · Business Knowledge Source Ingestion & Provenance Engine', () => {
  const WORKSPACE_ID = 'ws-kn-ingest-1'
  const OTHER_WORKSPACE_ID = 'ws-kn-ingest-2'

  let service: KnowledgeSourceIngestionService

  beforeEach(() => {
    service = new KnowledgeSourceIngestionService()
  })

  // Test 1: manual source -> candidate -> user confirm -> version
  it('1. transitions manual source input to candidate and requires user confirm before versioning', async () => {
    const source: IngestionSource = {
      workspaceId: WORKSPACE_ID,
      sourceType: 'MANUAL',
      locator: 'direct-input-form',
      content: '영업시간은 매일 오전 10시부터 오후 9시까지입니다.',
      actorId: 'user-owner-1',
    }

    const { candidates, sourceRecord } = await service.ingestSource(source)
    expect(candidates.length).toBeGreaterThan(0)
    expect(sourceRecord.sourceType).toBe('MANUAL')

    const hoursCandidate = candidates.find((c) => c.domain === 'Location & Hours')
    expect(hoursCandidate).toBeDefined()
    expect(hoursCandidate?.status).toBe('CANDIDATE')

    // 사용자 confirm 전에는 active runtime facts에 반영되지 않음
    expect(service.getActiveFacts(WORKSPACE_ID)).toEqual({})

    // 사용자의 명시적 confirm
    const confirmedVersion = await service.confirmCandidate({
      workspaceId: WORKSPACE_ID,
      candidateId: hoursCandidate!.id,
      userId: 'user-owner-1',
    })

    expect(confirmedVersion.versionNumber).toBe(1)
    expect(service.getActiveFacts(WORKSPACE_ID)['Location & Hours']).toContain('오전 10시')
  })

  // Test 2: URL source -> candidate provenance 유지
  it('2. extracts candidate from URL source and maintains exact URL provenance', async () => {
    const source: IngestionSource = {
      workspaceId: WORKSPACE_ID,
      sourceType: 'URL',
      locator: 'https://myshop.example.com/about',
      content: '저희 매장은 유기농 원두만을 사용하는 스페셜티 카페입니다.',
      actorId: 'user-owner-1',
    }

    const { candidates } = await service.ingestSource(source)
    const offeringCandidate = candidates.find((c) => c.domain === 'Offerings')
    expect(offeringCandidate).toBeDefined()
    expect(offeringCandidate?.provenance.sourceType).toBe('URL')
    expect(offeringCandidate?.provenance.locator).toBe('https://myshop.example.com/about')
    expect(offeringCandidate?.provenance.contentHash).toBeDefined()
  })

  // Test 3: file/document source -> candidate provenance 유지
  it('3. extracts candidate from file document and preserves document provenance', async () => {
    const source: IngestionSource = {
      workspaceId: WORKSPACE_ID,
      sourceType: 'FILE_DOCUMENT',
      locator: 'brand_guideline.pdf',
      fileSize: 1024 * 50, // 50KB
      mimeType: 'application/pdf',
      content: '대표 시그니처 메뉴: 바닐라빈 라떼 6,500원',
      actorId: 'user-owner-1',
    }

    const { candidates } = await service.ingestSource(source)
    const pricingCandidate = candidates.find((c) => c.domain === 'Pricing')
    expect(pricingCandidate).toBeDefined()
    expect(pricingCandidate?.provenance.sourceType).toBe('FILE_DOCUMENT')
    expect(pricingCandidate?.provenance.locator).toBe('brand_guideline.pdf')
  })

  // Test 4: SNS source -> candidate provenance 유지
  it('4. extracts candidate from SNS profile or post and retains SNS provenance', async () => {
    const source: IngestionSource = {
      workspaceId: WORKSPACE_ID,
      sourceType: 'SNS',
      locator: 'instagram:@sohee_cafe',
      content: '예약은 네이버 예약 또는 인스타그램 DM으로만 가능합니다.',
      actorId: 'user-owner-1',
    }

    const { candidates } = await service.ingestSource(source)
    const bookingCandidate = candidates.find((c) => c.domain === 'Reservation / Booking Rules')
    expect(bookingCandidate).toBeDefined()
    expect(bookingCandidate?.provenance.sourceType).toBe('SNS')
    expect(bookingCandidate?.provenance.locator).toBe('instagram:@sohee_cafe')
  })

  // Test 5: auto extracted candidate가 confirm 없이 runtime grounding에 사용되지 않음
  it('5. never exposes unconfirmed candidates to runtime grounding', async () => {
    await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'MANUAL',
      locator: 'memo',
      content: '위험 물질이나 화학 방부제는 절대 사용하지 않습니다.',
      actorId: 'user-owner-1',
    })

    const groundingContext = service.getRuntimeGroundingContext(WORKSPACE_ID)
    expect(groundingContext).not.toContain('화학 방부제')
  })

  // Test 6: conflicting source -> conflict state
  it('6. isolates conflicting facts into CONFLICT state instead of latest-win', async () => {
    // 1차 입력: 가격 5,000원
    await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'MANUAL',
      locator: 'input-1',
      content: '아메리카노 가격은 5,000원입니다.',
      actorId: 'user-owner-1',
    })

    // 2차 입력: 가격 6,000원 (상충)
    const { candidates } = await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'URL',
      locator: 'https://myshop.com/menu',
      content: '아메리카노 가격은 6,000원입니다.',
      actorId: 'user-owner-1',
    })

    const priceCandidates = service.getCandidatesByDomain(WORKSPACE_ID, 'Pricing')
    expect(priceCandidates.length).toBe(2)
    const conflictingCandidate = candidates.find((c) => c.domain === 'Pricing')
    expect(conflictingCandidate?.conflictState).toBe('CONFLICT')
    expect(conflictingCandidate?.conflictMessage).toContain('상충하는 정보')
  })

  // Test 7: stale source -> freshness warning
  it('7. marks candidates from outdated sources with freshness warning', async () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const { candidates } = await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'URL',
      locator: 'https://old-blog.example.com/2025-post',
      content: '이벤트 할인 50% 진행 중',
      sourceCreatedAt: oneYearAgo,
      actorId: 'user-owner-1',
    })

    const promoCandidate = candidates.find((c) => c.domain === 'Promotions')
    expect(promoCandidate?.freshness).toBe('STALE')
    expect(promoCandidate?.freshnessWarning).toBeDefined()
  })

  // Test 8: confirmed fact를 새 source가 자동 overwrite하지 않음
  it('8. prevents newly ingested candidates from overwriting confirmed facts', async () => {
    // 1. 기존 Confirmed 사실 생성
    const { candidates } = await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'MANUAL',
      locator: 'initial',
      content: '매장 주소: 서울시 강남구 테헤란로 123',
      actorId: 'user-owner-1',
    })
    const addrCandidate = candidates.find((c) => c.domain === 'Location & Hours')!
    await service.confirmCandidate({
      workspaceId: WORKSPACE_ID,
      candidateId: addrCandidate.id,
      userId: 'user-owner-1',
    })

    expect(service.getActiveFacts(WORKSPACE_ID)['Location & Hours']).toBe('매장 주소: 서울시 강남구 테헤란로 123')

    // 2. 새 소스에서 다른 주소 유입
    await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'SNS',
      locator: 'threads:@new_location',
      content: '매장 주소: 제주시 서귀포 올레길 45',
      actorId: 'user-owner-1',
    })

    // Confirmed 사실은 유지되어야 함
    expect(service.getActiveFacts(WORKSPACE_ID)['Location & Hours']).toBe('매장 주소: 서울시 강남구 테헤란로 123')
  })

  // Test 9: cross-tenant source/file injection deny
  it('9. blocks cross-tenant candidate queries and confirms', async () => {
    const { candidates } = await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'MANUAL',
      locator: 'tenant-a-memo',
      content: '기밀 비즈니스 레시피',
      actorId: 'user-owner-1',
    })
    const candidateId = candidates[0].id

    // 다른 워크스페이스에서 해당 후보 조회 시 거부
    expect(() => {
      service.getCandidate(OTHER_WORKSPACE_ID, candidateId)
    }).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)

    // 다른 워크스페이스에서 confirm 시도 시 거부
    await expect(
      service.confirmCandidate({
        workspaceId: OTHER_WORKSPACE_ID,
        candidateId,
        userId: 'user-attacker',
      })
    ).rejects.toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
  })

  // Test 10: URL ingestion SSRF/private IP deny
  it('10. denies SSRF and private network URLs during ingestion', async () => {
    const privateUrls = [
      'http://127.0.0.1:8080/internal-data',
      'http://localhost/admin',
      'http://10.0.0.1/metadata',
      'http://192.168.1.1/router',
      'http://169.254.169.254/latest/meta-data',
    ]

    for (const url of privateUrls) {
      await expect(
        service.ingestSource({
          workspaceId: WORKSPACE_ID,
          sourceType: 'URL',
          locator: url,
          content: 'test',
          actorId: 'user-1',
        })
      ).rejects.toThrowError(/SSRF_PROTECTION_BLOCKED/)
    }
  })

  // Test 11: malformed/oversize file fail-closed
  it('11. fails closed when file document is oversized or invalid type', async () => {
    // 10MB 초과 파일
    await expect(
      service.ingestSource({
        workspaceId: WORKSPACE_ID,
        sourceType: 'FILE_DOCUMENT',
        locator: 'huge_dump.bin',
        fileSize: 15 * 1024 * 1024,
        mimeType: 'application/octet-stream',
        content: 'huge',
        actorId: 'user-1',
      })
    ).rejects.toThrowError(/FILE_TOO_LARGE/)

    // 비허용 파일 타입
    await expect(
      service.ingestSource({
        workspaceId: WORKSPACE_ID,
        sourceType: 'FILE_DOCUMENT',
        locator: 'malicious.exe',
        fileSize: 1024,
        mimeType: 'application/x-msdownload',
        content: 'malware',
        actorId: 'user-1',
      })
    ).rejects.toThrowError(/INVALID_FILE_TYPE/)
  })

  // Test 12: confirmed Knowledge version에서 source lineage 역추적 가능
  it('12. allows full retrospective lineage traversal from confirmed version to original source', async () => {
    const { candidates, sourceRecord } = await service.ingestSource({
      workspaceId: WORKSPACE_ID,
      sourceType: 'URL',
      locator: 'https://sohee.ai/story',
      content: '핵심 차별화: 100% 국산 재료만을 고집합니다.',
      actorId: 'user-owner-1',
    })

    const diffCandidate = candidates.find((c) => c.domain === 'Differentiation')!
    const version = await service.confirmCandidate({
      workspaceId: WORKSPACE_ID,
      candidateId: diffCandidate.id,
      userId: 'user-owner-1',
    })

    const lineage = service.getVersionLineage(WORKSPACE_ID, version.versionNumber)
    expect(lineage.sourceRecordId).toBe(sourceRecord.id)
    expect(lineage.sourceType).toBe('URL')
    expect(lineage.sourceLocator).toBe('https://sohee.ai/story')
    expect(lineage.confirmedBy).toBe('user-owner-1')
  })
})
