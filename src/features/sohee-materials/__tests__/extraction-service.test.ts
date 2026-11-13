import { describe, expect, it, vi } from 'vitest'
import {
  extractFactsFromContent,
  promoteSuggestionsToFacts,
} from '../extraction-service'
import type { PromoteSuggestionsInput } from '../types'

describe('extractFactsFromContent', () => {
  it('빈 텍스트 입력 시 빈 배열을 반환한다', () => {
    expect(extractFactsFromContent('', 'menu.txt')).toEqual([])
    expect(extractFactsFromContent('   ', 'intro.pdf')).toEqual([])
  })

  it('텍스트에서 메뉴 및 가격 패턴을 올바르게 추출한다', () => {
    const raw = `
      [매장 안내]
      대표 메뉴 안내:
      - 제주 흑돼지 김치찌개: 11,000원
      - 직화 제육볶음정식 12000원
      가격: 1인 11,000원부터
    `
    const suggestions = extractFactsFromContent(raw, 'menu.txt')
    expect(suggestions.length).toBeGreaterThan(0)
    const menuOrPrice = suggestions.filter((s) => s.category === 'MENU' || s.category === 'PRICE')
    expect(menuOrPrice.length).toBeGreaterThan(0)
    expect(menuOrPrice.some((s) => s.content.includes('김치찌개') || s.content.includes('11,000원'))).toBe(true)
  })

  it('영업시간 및 휴무일 패턴을 올바르게 추출한다', () => {
    const raw = `
      영업시간: 매일 11:00 ~ 21:30
      브레이크타임 15:00~17:00
      매주 일요일 정기 휴무
    `
    const suggestions = extractFactsFromContent(raw, 'hours.txt')
    const hours = suggestions.find((s) => s.category === 'HOURS')
    expect(hours).toBeDefined()
    expect(hours?.content).toContain('11:00')
    expect(hours?.content).toContain('휴무')
  })

  it('주차 및 위치(FAQ) 패턴을 올바르게 추출한다', () => {
    const raw = `
      오시는 길: 강남역 4번 출구 도보 5분
      주차: 건물 지하 주차장 2시간 무료 지원 가능합니다.
    `
    const suggestions = extractFactsFromContent(raw, 'location.pdf')
    const faq = suggestions.find((s) => s.category === 'FAQ')
    expect(faq).toBeDefined()
    expect(faq?.content).toContain('주차')
  })

  it('매장 특징 및 차별점(DIFFERENTIATOR) 패턴을 올바르게 추출한다', () => {
    const raw = `
      매장 특징:
      국내산 1등급 한우만을 고집합니다.
      수제 특제 양념 소스로 48시간 저온 숙성합니다.
    `
    const suggestions = extractFactsFromContent(raw, 'about.txt')
    const diff = suggestions.find((s) => s.category === 'DIFFERENTIATOR')
    expect(diff).toBeDefined()
    expect(diff?.content).toMatch(/(국내산|수제|숙성)/)
  })

  it('주의사항 및 금지어(PROHIBITED) 패턴을 올바르게 추출한다', () => {
    const raw = `
      주의사항: 알레르기 유발 물질(땅콩, 새우) 포함.
      외부 음식 반입 금지입니다.
    `
    const suggestions = extractFactsFromContent(raw, 'notice.txt')
    const prohibited = suggestions.find((s) => s.category === 'PROHIBITED')
    expect(prohibited).toBeDefined()
    expect(prohibited?.content).toMatch(/(알레르기|주의|금지)/)
  })

  it('추천 지식은 최대 5개까지 생성되며 고유한 id와 유효한 content를 가진다', () => {
    const richText = `
      [매장 종합 안내]
      대표 메뉴:
      1. 삼겹살 16,000원
      2. 목살 15,000원
      영업시간: 11:30 ~ 22:00 (월요일 휴무)
      주차안내: 건물 뒤 전용 주차장 무료 주차 가능
      매장 비법: 100% 제주산 암퇘지를 직접 선별하여 14일간 웻에이징
      주의사항: 애완동물 동반 불가, 예약 필수
    `
    const suggestions = extractFactsFromContent(richText, 'full.txt')
    expect(suggestions.length).toBeLessThanOrEqual(5)
    expect(suggestions.length).toBeGreaterThan(0)
    const ids = new Set(suggestions.map((s) => s.id))
    expect(ids.size).toBe(suggestions.length)
    for (const s of suggestions) {
      expect(s.content.length).toBeGreaterThan(0)
      expect(s.content.length).toBeLessThanOrEqual(500)
    }
  })
})

describe('promoteSuggestionsToFacts', () => {
  const wsId = 'ws-test-123'
  const userId = 'user-owner-1'
  const materialId = 'mat-item-456'
  const materialName = '2026_신메뉴판.pdf'

  function createMockSupabase(existingSource: { id: string } | null = null) {
    const calls = {
      sourcesSelect: 0,
      sourcesInsert: [] as any[],
      candidatesInsert: [] as any[],
      factsInsert: [] as any[],
      itemsUpdate: [] as any[],
    }

    const client = {
      from(table: string) {
        if (table === 'knowledge_sources') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: existingSource,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            insert: (row: any) => {
              calls.sourcesInsert.push(row)
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: 'created-source-id' },
                    error: null,
                  }),
                }),
              }
            },
          }
        }

        if (table === 'knowledge_candidates') {
          return {
            insert: (row: any) => {
              calls.candidatesInsert.push(row)
              const rowId = `cand-${calls.candidatesInsert.length}`
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: rowId },
                    error: null,
                  }),
                }),
              }
            },
          }
        }

        if (table === 'knowledge_facts') {
          return {
            insert: (row: any) => {
              calls.factsInsert.push(row)
              const factId = `fact-${calls.factsInsert.length}`
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: factId,
                      category: row.category,
                      content: row.content,
                      created_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              }
            },
          }
        }

        if (table === 'knowledge_items') {
          return {
            update: (patch: any) => {
              calls.itemsUpdate.push(patch)
              return {
                eq: () => ({
                  eq: async () => ({
                    data: null,
                    error: null,
                  }),
                }),
              }
            },
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    }

    return { client, calls }
  }

  it('필수 입력값이 누락되면 에러를 던진다', async () => {
    await expect(
      promoteSuggestionsToFacts({
        workspaceId: '',
        userId,
        materialId,
        materialName,
        suggestions: [],
      }),
    ).rejects.toThrow('workspaceId is required')

    await expect(
      promoteSuggestionsToFacts({
        workspaceId: wsId,
        userId: '',
        materialId,
        materialName,
        suggestions: [],
      }),
    ).rejects.toThrow('userId is required')
  })

  it('제안이 비어있으면 승격 없이 0건을 반환한다', async () => {
    const { client } = createMockSupabase()
    const result = await promoteSuggestionsToFacts(
      {
        workspaceId: wsId,
        userId,
        materialId,
        materialName,
        suggestions: [],
      },
      client,
    )

    expect(result).toEqual({ promotedCount: 0, factIds: [] })
  })

  it('기존 소스가 없는 경우 knowledge_sources를 새로 생성하고 후보와 팩트를 승격한다', async () => {
    const { client, calls } = createMockSupabase(null)

    const input: PromoteSuggestionsInput = {
      workspaceId: wsId,
      userId,
      materialId,
      materialName,
      suggestions: [
        { category: 'MENU', content: '흑돼지 김치찌개 11,000원' },
        { category: 'HOURS', content: '매일 11:00 ~ 22:00' },
      ],
    }

    const result = await promoteSuggestionsToFacts(input, client)

    expect(result.promotedCount).toBe(2)
    expect(result.factIds).toEqual(['fact-1', 'fact-2'])

    // knowledge_sources 생성 검증
    expect(calls.sourcesInsert.length).toBe(1)
    expect(calls.sourcesInsert[0].workspace_id).toBe(wsId)
    expect(calls.sourcesInsert[0].display_name).toBe(materialName)
    expect(calls.sourcesInsert[0].source_type).toBe('file')
    expect(calls.sourcesInsert[0].status).toBe('approved')

    // knowledge_candidates 생성 검증
    expect(calls.candidatesInsert.length).toBe(2)
    expect(calls.candidatesInsert[0].source_location).toBe(`file:${materialName}`)
    expect(calls.candidatesInsert[0].status).toBe('approved')
    expect(calls.candidatesInsert[0].reviewed_by_user_id).toBe(userId)
    expect(calls.candidatesInsert[0].category).toBe('MENU')
    expect(calls.candidatesInsert[0].content).toBe('흑돼지 김치찌개 11,000원')

    // knowledge_facts 생성 검증
    expect(calls.factsInsert.length).toBe(2)
    expect(calls.factsInsert[0].workspace_id).toBe(wsId)
    expect(calls.factsInsert[0].status).toBe('active')
    expect(calls.factsInsert[0].approved_by_user_id).toBe(userId)
    expect(calls.factsInsert[0].category).toBe('MENU')
    expect(calls.factsInsert[0].content).toBe('흑돼지 김치찌개 11,000원')

    // knowledge_items status -> 'approved' 갱신 검증
    expect(calls.itemsUpdate.length).toBe(1)
    expect(calls.itemsUpdate[0].status).toBe('approved')
  })

  it('기존 소스가 존재하는 경우 기존 소스 ID를 재사용한다', async () => {
    const { client, calls } = createMockSupabase({ id: 'existing-src-999' })

    const input: PromoteSuggestionsInput = {
      workspaceId: wsId,
      userId,
      materialId,
      materialName,
      suggestions: [{ category: 'FAQ', content: '주차는 2시간 무료 지원됩니다.' }],
    }

    const result = await promoteSuggestionsToFacts(input, client)

    expect(result.promotedCount).toBe(1)
    expect(calls.sourcesInsert.length).toBe(0) // 새 소스 삽입 안 함
    expect(calls.candidatesInsert[0].knowledge_source_id).toBe('existing-src-999')
  })
})
