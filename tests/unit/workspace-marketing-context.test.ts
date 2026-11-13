import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildWorkspaceMarketingContext,
  extractStructuredProductsFromSummary,
  type WorkspaceMarketingContext,
} from '@/lib/agent-os/workspace-marketing-context'

describe('ANI-1039 & ANI-1055: Workspace Marketing Context & Structured Products Grounding', () => {
  const targetWorkspaceId = '00000000-0000-4000-8000-0000000000a2'

  const mockBrunchBusiness = {
    workspace_id: targetWorkspaceId,
    business_name: '소희 테스트 키친',
    industry: '캐주얼 브런치 카페',
    location: '인천 서구 청라 커낼로 123',
    summary:
      '인천 청라의 감성 브런치 카페입니다. 직접 재배한 생바질과 통들깨를 갈아 넣은 시그니처 바질 크림 파스타(18,000원), 프랑스 AOP 버터 크루아상에 제철 딸기와 마스카포네 크림을 얹은 딸기 크림 크루아상(8,500원), 18시간 저온 추출 에티오피아 시그니처 콜드브루(6,000원)가 대표 메뉴입니다. 30대 직장인과 여유로운 브런치를 즐기는 주민들이 주 고객층입니다.',
    created_at: '2026-09-07T12:49:42.228Z',
    updated_at: '2026-09-07T12:49:42.228Z',
  }

  const mockBrunchBrand = {
    workspace_id: targetWorkspaceId,
    voice: '친근하고 다정하며 세련된 브런치 카페 매니저 말투 (~해요, ~드려요). 감성적인 묘사와 함께 매장의 따스한 채광과 신선한 재료를 강조하는 톤앤매너',
    keywords: ['청라브런치', '바질크림파스타', '청라카페', '수제크루아상', '콜드브루맛집', '청라데이트'],
    prohibited_terms: ['가성비', '싸구려', '공장제', '즉석식품', '냉동'],
    created_at: '2026-09-07T12:50:56.113Z',
    updated_at: '2026-09-07T12:50:56.113Z',
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('1. extractStructuredProductsFromSummary (ANI-1055)', () => {
    it('accurately parses items, prices, and signature tags from free-form business summary', () => {
      const items = extractStructuredProductsFromSummary(mockBrunchBusiness.summary, targetWorkspaceId)

      expect(items.length).toBeGreaterThanOrEqual(3)

      const pasta = items.find(i => i.name.includes('바질 크림 파스타'))
      expect(pasta).toBeDefined()
      expect(pasta?.price).toBe(18000)
      expect(pasta?.priceFormatted).toBe('18,000원')
      expect(pasta?.isSignature).toBe(true)

      const croissant = items.find(i => i.name.includes('딸기 크림 크루아상'))
      expect(croissant).toBeDefined()
      expect(croissant?.price).toBe(8500)
      expect(croissant?.priceFormatted).toBe('8,500원')

      const coldbrew = items.find(i => i.name.includes('콜드브루'))
      expect(coldbrew).toBeDefined()
      expect(coldbrew?.price).toBe(6000)
      expect(coldbrew?.priceFormatted).toBe('6,000원')
    })

    it('returns empty array when summary is null or empty without crashing', () => {
      expect(extractStructuredProductsFromSummary('', targetWorkspaceId)).toEqual([])
      expect(extractStructuredProductsFromSummary(null as any, targetWorkspaceId)).toEqual([])
    })
  })

  describe('2. buildWorkspaceMarketingContext (ANI-1039 & ANI-1055)', () => {
    it('assembles complete canonical context for configured cafe workspace without beauty persona leakage', async () => {
      // Mock Supabase client
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mockBrunchBusiness, error: null }),
            }
          }
          if (table === 'brand_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mockBrunchBrand, error: null }),
            }
          }
          if (table === 'workspace_products_services') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          if (table === 'work_items') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          if (table === 'external_action_receipts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }),
      }

      const ctx: WorkspaceMarketingContext = await buildWorkspaceMarketingContext(targetWorkspaceId, {
        client: mockClient,
      })

      // 1. Business Profile Facts
      expect(ctx.business.status).toBe('CONFIGURED')
      expect(ctx.business.businessName).toBe('소희 테스트 키친')
      expect(ctx.business.industry).toBe('캐주얼 브런치 카페')
      expect(ctx.business.location).toBe('인천 서구 청라 커낼로 123')

      // 2. Brand Profile & Strict Policies
      expect(ctx.brand.status).toBe('CONFIGURED')
      expect(ctx.brand.voice).toContain('브런치 카페 매니저 말투')
      expect(ctx.brand.keywords).toContain('바질크림파스타')
      expect(ctx.brand.keywords).toContain('청라브런치')
      expect(ctx.brand.prohibitedTerms).toEqual(['가성비', '싸구려', '공장제', '즉석식품', '냉동'])

      // 3. Structured Products Grounding
      expect(ctx.productsServices.status).toBe('CONFIGURED')
      expect(ctx.productsServices.items.length).toBeGreaterThanOrEqual(3)
      const pasta = ctx.productsServices.items.find(i => i.name.includes('바질 크림 파스타'))
      expect(pasta?.price).toBe(18000)

      // 4. Dynamic Persona: Cafe Industry
      expect(ctx.dynamicPersona.addressTerm).toBe('사장님')
      expect(ctx.dynamicPersona.addressTerm).not.toBe('원장님')
      expect(ctx.contextSummary).not.toContain('원장님')
      expect(ctx.contextSummary).not.toContain('자연눈썹')
      expect(ctx.contextSummary).not.toContain('속눈썹')
      expect(ctx.contextSummary).not.toContain('시술')
      expect(ctx.contextSummary).not.toContain('바이름')

      // 5. Hard Policy: Prohibited Terms Stamped
      expect(ctx.contextSummary).toContain('가성비')
      expect(ctx.contextSummary).toContain('절대 사용 금지어')

      // 6. Context Metadata
      expect(ctx.workspaceId).toBe(targetWorkspaceId)
      expect(ctx.contextVersion).toBeDefined()
      expect(ctx.observedAt).toBeDefined()
    })

    it('returns honest SETUP_REQUIRED when business and brand profiles do not exist', async () => {
      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      }

      const emptyWsId = 'ws_empty_setup_required'
      const ctx = await buildWorkspaceMarketingContext(emptyWsId, { client: mockClient })

      expect(ctx.business.status).toBe('SETUP_REQUIRED')
      expect(ctx.brand.status).toBe('SETUP_REQUIRED')
      expect(ctx.productsServices.status).toBe('EMPTY')
      expect(ctx.productsServices.items).toEqual([])

      // Honest notice, NO fake beauty salon fallback
      expect(ctx.contextSummary).toContain('매장 정보 설정 대기')
      expect(ctx.contextSummary).not.toContain('바이름')
      expect(ctx.contextSummary).not.toContain('스튜디오')
      expect(ctx.dynamicPersona.addressTerm).toBe('사장님')
    })

    it('assigns 원장님 addressTerm and beauty vocabulary ONLY when industry is beauty/clinic', async () => {
      const beautyBusiness = {
        workspace_id: 'ws_beauty',
        business_name: '리앤 미용의원',
        industry: '피부과/에스테틱',
        location: '서울 강남구 역삼동',
        summary: '맞춤 피부 재생 관리 및 안티에이징 전문 의원',
        created_at: '2026-09-07T00:00:00Z',
        updated_at: '2026-09-07T00:00:00Z',
      }

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: beautyBusiness, error: null }),
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            not: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }),
      }

      const ctx = await buildWorkspaceMarketingContext('ws_beauty', { client: mockClient })
      expect(ctx.dynamicPersona.addressTerm).toBe('원장님')
      expect(ctx.dynamicPersona.industryCategory).toBe('BEAUTY_CLINIC')
    })
  })
})
