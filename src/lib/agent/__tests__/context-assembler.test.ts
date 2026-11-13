import { describe, it, expect, vi } from 'vitest'
import {
  ContextAssembler,
  type AssembledEmployeeContext,
} from '../context-assembler'

describe('Durable Employee Memory & ContextAssembler (ANI-992)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001'

  it('assembles business, brand, knowledge facts, and rules with exact provenance source IDs', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: workspaceId,
                    business_name: '테스트 네일샵',
                    industry: '뷰티/네일',
                    location: '서울 마포구',
                    summary: '맞춤 젤네일 전문점입니다.',
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'brand_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    workspace_id: workspaceId,
                    voice: '상냥한 설명체 (~해요)',
                    keywords: ['꼼꼼 시술', '손톱 손상 최소화'],
                    prohibited_terms: ['무조건 1위'],
                    updated_at: '2026-09-07T12:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'fact-111',
                      workspace_id: workspaceId,
                      category: '가격표',
                      content: '이달의 아트 65,000원, 기본 젤 40,000원',
                      status: 'active',
                      approved_at: '2026-09-07T10:00:00Z',
                      created_at: '2026-09-07T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'harness_rules') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'rule-222',
                      workspace_id: workspaceId,
                      rule_key: 'no-discount-claim',
                      rule_type: 'guardrail',
                      title: '할인 과장 금지',
                      description: '10% 초과 할인은 안내하지 않음',
                      structured_rule: { maxDiscount: 10 },
                      status: 'active',
                      version: 1,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const context: AssembledEmployeeContext = await ContextAssembler.assembleContext({
      workspaceId,
      client: mockSupabase as any,
    })

    expect(context.workspaceId).toBe(workspaceId)
    expect(context.business?.business_name).toBe('테스트 네일샵')
    expect(context.brand?.voice).toBe('상냥한 설명체 (~해요)')
    expect(context.facts).toHaveLength(1)
    expect(context.facts[0].sourceId).toBe('knowledge_facts:fact-111')
    expect(context.facts[0].content).toContain('이달의 아트')
    expect(context.rules).toHaveLength(1)
    expect(context.rules[0].sourceId).toBe('harness_rules:rule-222')
    expect(context.provenance.some((p) => p.sourceId === 'knowledge_facts:fact-111')).toBe(true)
    expect(context.systemPromptContext).toContain('[사업장: 테스트 네일샵]')
    expect(context.systemPromptContext).toContain('이달의 아트 65,000원')
    expect(context.systemPromptContext).toContain('Source: knowledge_facts:fact-111')
  })

  it('next session recall uses stored provenance and does not fall back to hardcoded seeds', async () => {
    const emptySupabase = {
      from: vi.fn().mockImplementation((_table: string) => {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }
      }),
    }

    const context = await ContextAssembler.assembleContext({
      workspaceId,
      datasetMode: 'ACTUAL',
      client: emptySupabase as any,
    })

    // In ACTUAL mode with empty DB, MUST NOT fabricate Byreum or fake mem-seed-*
    expect(context.facts).toHaveLength(0)
    expect(context.rules).toHaveLength(0)
    expect(context.systemPromptContext).not.toContain('바이름 청라점')
    expect(context.systemPromptContext).not.toContain('mem-seed-')
  })
})
