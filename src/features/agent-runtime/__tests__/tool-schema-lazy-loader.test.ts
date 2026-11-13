import { describe, it, expect } from 'vitest'
import {
  ToolSchemaLazyLoader,
  LAZY_TOOL_CATALOG,
} from '../tool-schema-lazy-loader'

describe('Tool Schema Lazy Loading (ANI-813)', () => {
  it('does not expand all 18 schemas unconditionally, but reduces to intent matches', () => {
    const loader = new ToolSchemaLazyLoader(LAZY_TOOL_CATALOG)

    const res = loader.resolveSchemasForIntent({
      query: '인스타그램 피드에 사진이랑 캡션 올려줘',
      workspaceId: 'ws-test',
      planTier: 'TIER_300K_GROWTH',
      creditBalance: 100,
      maxCandidates: 2,
    })

    expect(res.evaluatedCount).toBe(LAZY_TOOL_CATALOG.length)
    expect(res.matchedCandidates).toContain('tool_instagram_feed_publish')
    expect(res.matchedCandidates.length).toBeLessThanOrEqual(2)
    expect(res.expandedSchemas).toHaveLength(1)
    expect(res.expandedSchemas[0].toolId).toBe('tool_instagram_feed_publish')
    expect(res.expandedSchemas[0].schema).toHaveProperty('properties.caption')
    expect(res.decisionTrace).toContain('인스타그램 피드에 사진이랑 캡션 올려줘')
  })

  it('filters out candidate if credit balance is insufficient for tool cost', () => {
    const loader = new ToolSchemaLazyLoader(LAZY_TOOL_CATALOG)

    const res = loader.resolveSchemasForIntent({
      query: '네이버 블로그 포스팅 발행해줘',
      workspaceId: 'ws-test',
      planTier: 'TIER_300K_GROWTH',
      creditBalance: 5, // Blog tool requires 40 credits
      maxCandidates: 2,
    })

    expect(res.matchedCandidates).toContain('tool_naver_blog_publish')
    expect(res.readyCandidates).not.toContain('tool_naver_blog_publish')
    expect(res.blockedCandidates.some((b) => b.toolId === 'tool_naver_blog_publish')).toBe(true)
    expect(res.expandedSchemas).toHaveLength(0)

    const naverTool = LAZY_TOOL_CATALOG.find((t) => t.toolId === 'tool_naver_blog_publish')
    expect(naverTool?.name).toBe('네이버 블로그 원고 준비')
    expect(naverTool?.intentKeywords).not.toContain('상위노출')
    expect(naverTool?.description).toContain('원고')
  })
})
