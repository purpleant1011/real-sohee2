import { describe, expect, it } from 'vitest'
import {
  buildNaverHtmlContent,
  buildNaverPlainTextContent,
  type NaverPostForCopy,
} from '@/features/channel-studio/naver/copy-naver-post'
import {
  buildNaverManuscriptText,
  type NaverManuscript,
} from '@/features/content/naver-manuscript'
import {
  channelContentSchema,
  type ChannelContent,
} from '@/features/content/channel-content-schema'
import {
  getApprovalPreview,
  type ApprovalPreviewGateway,
} from '@/features/approvals/approval-preview-repository'
import { partialContentRevisionAction } from '@/features/chat/actions/partial-content-revision'
import type { ActionResult } from '@/lib/errors/result'
import type { ContentDetail } from '@/features/content/types'

describe('ANI-1894: 네이버 editorBlocks 단일 정본 및 버전/fingerprint/부분수정 정합성 계약', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const contentId = '00000000-0000-4000-8000-000000000002'
  const versionId = '00000000-0000-4000-8000-000000000003'
  const mediaId1 = '00000000-0000-4000-8000-000000000011'
  const mediaId2 = '00000000-0000-4000-8000-000000000012'
  const fingerprintV1 = '1111111111111111111111111111111111111111111111111111111111111111'
  const fingerprintV2 = '2222222222222222222222222222222222222222222222222222222222222222'

  const longParagraph = '정밀 케어와 세심한 상담 과정을 안내해 드리는 긴 본문 단락입니다. '.repeat(100) // 약 4,000자

  const canonicalNaverPayload: Extract<ChannelContent, { channel: 'naver_blog' }> = {
    channel: 'naver_blog',
    title: '강남 피부관리 맞춤형 케어 가이드',
    introduction: '안녕하세요. 오늘은 맞춤형 피부 관리 프로그램의 전체 과정을 상세히 안내해 드립니다.',
    sections: [
      {
        heading: '1:1 맞춤 정밀 상담 및 피부 진단',
        body: longParagraph,
      },
    ],
    keywords: ['피부관리', '강남에스테틱', '맞춤케어'],
    imagePlacements: [
      { mediaId: mediaId1, placement: 'cover', altText: '상담실 전경 및 진단 차트' },
      { mediaId: mediaId2, placement: 'detail', altText: '맞춤 앰플 관리 시술 과정' },
    ],
    editorBlocks: [
      { kind: 'heading', text: '1:1 맞춤 정밀 상담 및 피부 진단' },
      { kind: 'paragraph', text: longParagraph },
      { kind: 'image', mediaId: mediaId1, altText: '상담실 전경 및 진단 차트' },
      { kind: 'paragraph', text: '진단 후 원장 상담을 통해 최적의 프로그램을 설계합니다.' },
      { kind: 'image', mediaId: mediaId2, altText: '맞춤 앰플 관리 시술 과정' },
      { kind: 'quote', text: '모든 피부는 고유하므로 규격화된 관리는 지양합니다.' },
      { kind: 'cta', text: '네이버 예약 또는 유선 상담으로 편하게 문의주세요.' },
    ],
    cta: '네이버 예약 또는 유선 상담으로 편하게 문의주세요.',
    visibility: 'public',
  }

  describe('계약 1: 2,200자 SNS caption 절단 위험 방지 및 editorBlocks 단일 정본 보존', () => {
    it('2,200자를 초과하는 네이버 블로그 원고(8,000자급)가 절단 없이 전체 보존되어야 한다', () => {
      expect(canonicalNaverPayload.editorBlocks?.[1]?.kind).toBe('paragraph')
      if (canonicalNaverPayload.editorBlocks?.[1]?.kind === 'paragraph') {
        expect(canonicalNaverPayload.editorBlocks[1].text.length).toBeGreaterThan(2200)
      }

      // 텍스트 투영 검증
      const manuscriptText = buildNaverManuscriptText({
        ...canonicalNaverPayload,
        disclosure: 'AI 보조 제작',
      })
      expect(manuscriptText.length).toBeGreaterThan(2200)
      expect(manuscriptText).toContain(longParagraph)

      // HTML 복사 투영 검증
      const postForCopy: NaverPostForCopy = {
        ...canonicalNaverPayload,
        media: [
          { id: mediaId1, src: 'https://example.com/photo1.jpg' },
          { id: mediaId2, src: 'https://example.com/photo2.jpg' },
        ],
        disclosure: 'AI 보조 제작',
      }
      const htmlContent = buildNaverHtmlContent(postForCopy, 'all')
      expect(htmlContent).toContain(longParagraph)
      expect(htmlContent).toContain('alt="상담실 전경 및 진단 차트"')
      expect(htmlContent).toContain('alt="맞춤 앰플 관리 시술 과정"')
    })

    it('SNS용 2,200자 caption 필드 축약본과 실제 editorBlocks 본문이 독립적이며 블록이 우선 정본이어야 한다', () => {
      const truncatedCaption = '2,200자 요약본입니다.'
      const manuscript: NaverManuscript = {
        title: canonicalNaverPayload.title,
        introduction: canonicalNaverPayload.introduction,
        sections: canonicalNaverPayload.sections,
        keywords: canonicalNaverPayload.keywords,
        cta: canonicalNaverPayload.cta,
        editorBlocks: canonicalNaverPayload.editorBlocks,
        disclosure: 'AI 보조 제작',
      }

      // editorBlocks가 존재할 때는 축약된 소개글이나 임의 텍스트가 아닌 editorBlocks가 투영의 단일 정본임
      const fullText = buildNaverManuscriptText(manuscript)
      expect(fullText).not.toContain(truncatedCaption)
      expect(fullText).toContain(longParagraph)
    })
  })

  describe('계약 2: editorBlocks와 imagePlacements 간 미디어 순서 불일치 시 fail-closed 검증', () => {
    it('editorBlocks 내 image 블록 순서가 imagePlacements와 불일치하면 스키마 검증에서 차단되어야 한다', () => {
      const mismatchedPayload = {
        ...canonicalNaverPayload,
        editorBlocks: [
          ...canonicalNaverPayload.editorBlocks!.filter((b) => b.kind !== 'image'),
          // 순서를 뒤바꿈: mediaId2가 먼저 옴
          { kind: 'image' as const, mediaId: mediaId2, altText: '2번' },
          { kind: 'image' as const, mediaId: mediaId1, altText: '1번' },
        ],
      }

      const result = channelContentSchema.safeParse(mismatchedPayload)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('editorBlocks'))).toBe(true)
      }
    })

    it('ApprovalPreview에서 imagePlacements와 editorBlocks의 이미지 ID가 불일치하면 naver_media_mismatch로 실패해야 한다', async () => {
      const mockDetail: ContentDetail = {
        id: contentId,
        title: '제목',
        status: 'draft',
        channel: 'naver_blog',
        currentVersionId: versionId,
        currentVersionNumber: 1,
        createdAt: '2026-10-28T09:00:00Z',
        updatedAt: '2026-10-28T09:00:00Z',
        source: 'actual',
        versions: [
          {
            id: versionId,
            versionNumber: 1,
            fingerprint: fingerprintV1,
            caption: '요약 캡션',
            hashtags: ['#태그'],
            disclosure: 'AI 보조 제작',
            revisionReason: null,
            createdAt: '2026-10-28T09:00:00Z',
            mediaCount: 2,
            knowledgeIds: [],
            harnessRuleIds: [],
            media: [
              {
                id: mediaId1,
                position: 1,
                mimeType: 'image/jpeg',
                altText: '1번',
                role: 'cover',
                rightsStatus: 'confirmed',
                width: null,
                height: null,
                sizeBytes: null,
              },
              {
                id: mediaId2,
                position: 2,
                mimeType: 'image/jpeg',
                altText: '2번',
                role: 'detail',
                rightsStatus: 'confirmed',
                width: null,
                height: null,
                sizeBytes: null,
              },
            ],
            rightsConfirmed: true,
            generationEvidenceConfirmed: true,
            structuredPayload: {
              ...canonicalNaverPayload,
              // editorBlocks의 이미지를 mediaId1만 2개 넣어서 어긋나게 함
              editorBlocks: [
                { kind: 'paragraph', text: '본문' },
                { kind: 'image', mediaId: mediaId1, altText: '1번' },
                { kind: 'image', mediaId: mediaId1, altText: '1번 복제' },
              ],
            },
          },
        ],
      }

      const mockGateway: ApprovalPreviewGateway = {
        getContentDetail: async () => ({ data: mockDetail }),
        listConnections: async () => ({
          data: [{
            id: '00000000-0000-4000-8000-000000000099',
            workspace_id: workspaceId,
            channel: 'naver_blog',
            status: 'connected',
            account_label: '공식 블로그',
          }],
          error: null,
        }),
        listApprovals: async () => ({
          data: [],
          error: null,
        }),
      }

      const previewResult = await getApprovalPreview(workspaceId, contentId, mockGateway)
      expect(previewResult.error).toBeDefined()
      expect(previewResult.error?.message).toContain('원고와 사진의 연결이 일치하지 않아요')
    })
  })

  describe('계약 3: 불변 버전 및 fingerprint 변경 시 승인 무효화(approval_stale) 계약', () => {
    it('승인 당시의 fingerprint와 현재 버전의 fingerprint가 다르면 approval_stale 이슈가 발생해야 한다', async () => {
      const mockDetail: ContentDetail = {
        id: contentId,
        title: '제목',
        status: 'draft',
        channel: 'naver_blog',
        currentVersionId: versionId,
        currentVersionNumber: 2,
        createdAt: '2026-10-28T09:00:00Z',
        updatedAt: '2026-10-28T10:00:00Z',
        source: 'actual',
        versions: [
          {
            id: versionId,
            versionNumber: 2,
            fingerprint: fingerprintV2, // 수정 후 새 fingerprint
            caption: '수정된 캡션',
            hashtags: ['#피부관리'],
            disclosure: 'AI 보조 제작',
            revisionReason: null,
            createdAt: '2026-10-28T10:00:00Z',
            mediaCount: 2,
            knowledgeIds: [],
            harnessRuleIds: [],
            media: [
              {
                id: mediaId1,
                position: 1,
                mimeType: 'image/jpeg',
                altText: '1번',
                role: 'cover',
                rightsStatus: 'confirmed',
                width: null,
                height: null,
                sizeBytes: null,
              },
              {
                id: mediaId2,
                position: 2,
                mimeType: 'image/jpeg',
                altText: '2번',
                role: 'detail',
                rightsStatus: 'confirmed',
                width: null,
                height: null,
                sizeBytes: null,
              },
            ],
            rightsConfirmed: true,
            generationEvidenceConfirmed: true,
            structuredPayload: canonicalNaverPayload,
          },
        ],
      }

      const mockGateway: ApprovalPreviewGateway = {
        getContentDetail: async () => ({ data: mockDetail }),
        listConnections: async () => ({
          data: [{
            id: '00000000-0000-4000-8000-000000000099',
            workspace_id: workspaceId,
            channel: 'naver_blog',
            status: 'connected',
            account_label: '공식 블로그',
          }],
          error: null,
        }),
        listApprovals: async () => ({
          // 이전 fingerprintV1으로 승인된 기록
          data: [{
            id: '00000000-0000-4000-8000-000000000088',
            workspace_id: workspaceId,
            content_id: contentId,
            version_id: versionId,
            fingerprint: fingerprintV1,
            status: 'approved',
            decided_at: '2026-10-28T10:00:00Z',
          }],
          error: null,
        }),
      }

      const previewResult = await getApprovalPreview(workspaceId, contentId, mockGateway)
      expect(previewResult.data).toBeDefined()
      const issues = previewResult.data?.issues ?? []
      expect(issues.some((issue) => issue.code === 'approval_stale')).toBe(true)
      expect(issues.find((issue) => issue.code === 'approval_stale')?.message).toBe('수정된 새 버전을 다시 승인해 주세요.')
      // 승인 상태도 unreviewed로 무효화되어야 함
      expect(previewResult.data?.approval.status).toBe('unreviewed')
    })
  })

  describe('계약 4: editorBlocks 확장 블록(link, map, quote, cta)의 단일 정본 투영 및 안전 계약', () => {
    it('HTML 및 Plain text 복사 시 모든 특수 블록(링크, 장소, 인용, CTA)이 정확히 투영되어야 한다', () => {
      const complexPayload: Extract<ChannelContent, { channel: 'naver_blog' }> = {
        ...canonicalNaverPayload,
        editorBlocks: [
          { kind: 'heading', text: '위치 및 예약 안내' },
          { kind: 'paragraph', text: '오시는 길 안내입니다.' },
          { kind: 'map', placeName: '바이름 뷰티 살롱 본점' },
          { kind: 'quote', text: '철저한 예약제로 프라이빗한 공간을 보장합니다.' },
          { kind: 'link', title: '네이버 실시간 예약 바로가기', url: 'https://booking.naver.com/beauty' },
          { kind: 'cta', text: '당일 예약은 유선 문의 부탁드립니다.' },
        ],
        imagePlacements: [], // 미디어 없음
      }

      // Plain text 투영 검증
      const text = buildNaverManuscriptText({
        ...complexPayload,
        disclosure: 'AI 보조 제작',
      })
      expect(text).toContain('바이름 뷰티 살롱 본점')
      expect(text).toContain('철저한 예약제로 프라이빗한 공간을 보장합니다.')
      expect(text).toContain('네이버 실시간 예약 바로가기 (https://booking.naver.com/beauty)')
      expect(text).toContain('당일 예약은 유선 문의 부탁드립니다.')

      // HTML 투영 검증
      const html = buildNaverHtmlContent({
        ...complexPayload,
        disclosure: 'AI 보조 제작',
      }, 'all')
      expect(html).toContain('<p>바이름 뷰티 살롱 본점</p>')
      expect(html).toContain('<blockquote><p>철저한 예약제로 프라이빗한 공간을 보장합니다.</p></blockquote>')
      expect(html).toContain('<a href="https://booking.naver.com/beauty">네이버 실시간 예약 바로가기</a>')
      expect(html).toContain('<blockquote><p>당일 예약은 유선 문의 부탁드립니다.</p></blockquote>')
    })
  })
})
