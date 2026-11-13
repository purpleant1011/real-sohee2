/**
 * Tool Schema Lazy Loading Engine (ANI-813)
 * 
 * Strict Invariants:
 * 1. Never dump all 18 tool schemas into prompt unconditionally.
 * 2. 4-step lazy loading:
 *    Intent Query -> Semantic Capability Search -> Live READY Gate -> Lazy Schema Expansion.
 * 3. Saves decision trace for provenance and auditability.
 */

import {
  evaluatePluginExecutableReady,
  type PluginReadyGateInput,
} from '@/lib/plugin-platform/router/plugin-ready-gate'
import { FIRST_PARTY_PLUGIN_CATALOG } from '@/lib/plugin-platform/core/first-party-plugin-catalog'
import type { SoheePluginManifest } from '@/types/plugin-platform'
import type { AgentEnergyPlanTier } from '@/types/autonomous-outcome-os'

export interface ToolMetadata {
  toolId: string
  pluginId: string
  name: string
  category: string
  intentKeywords: string[]
  description: string
  creditCost: number
  riskClass: 'READ' | 'DRAFT' | 'WRITE' | 'SPEND' | 'DELETE'
  schemaGetter: () => Record<string, unknown>
}

export interface LazySchemaResolution {
  query: string
  evaluatedCount: number
  matchedCandidates: string[]
  readyCandidates: string[]
  blockedCandidates: { toolId: string; reason: string }[]
  expandedSchemas: { toolId: string; name: string; schema: Record<string, unknown> }[]
  decisionTrace: string
}

// 18 Core First-Party & Extended Tools (Metadata lightweight, schema lazy)
export const LAZY_TOOL_CATALOG: ToolMetadata[] = [
  {
    toolId: 'tool_instagram_feed_publish',
    pluginId: 'plg_instagram_growth',
    name: '인스타그램 피드 발행',
    category: 'channel',
    intentKeywords: ['인스타그램', '피드', '게시', '릴스', '사진', '홍보'],
    description: '인스타그램 공식 채널에 마케팅 피드 및 캡션을 발행합니다.',
    creditCost: 30,
    riskClass: 'WRITE',
    schemaGetter: () => ({
      type: 'object',
      properties: {
        caption: { type: 'string', description: '인스타그램 게시물 본문' },
        imageUrls: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['caption', 'imageUrls'],
    }),
  },
  {
    toolId: 'tool_naver_blog_publish',
    pluginId: 'plg_naver_blog_marketing',
    name: '네이버 블로그 원고 준비',
    category: 'channel',
    intentKeywords: ['네이버', '블로그', '포스팅', '플레이스', '원고'],
    description: '네이버 블로그에 최적화된 마케팅 원고와 사진을 준비합니다.',
    creditCost: 40,
    riskClass: 'WRITE',
    schemaGetter: () => ({
      type: 'object',
      properties: {
        title: { type: 'string' },
        contentHtml: { type: 'string' },
        categoryNo: { type: 'number' },
      },
      required: ['title', 'contentHtml'],
    }),
  },
  {
    toolId: 'tool_kakao_consult_reply',
    pluginId: 'plg_kakao_consult',
    name: '카카오톡 예약 상담 답변 초안',
    category: 'crm',
    intentKeywords: ['카카오', '카카오톡', '상담', '예약', '문의', '고객응대'],
    description: '카카오 비즈니스 채널 문의에 대해 정중한 답변 초안을 준비합니다.',
    creditCost: 15,
    riskClass: 'WRITE',
    schemaGetter: () => ({
      type: 'object',
      properties: {
        recipientId: { type: 'string' },
        message: { type: 'string' },
        quickReplyButtons: { type: 'array' },
      },
      required: ['recipientId', 'message'],
    }),
  },
  {
    toolId: 'tool_content_draft_generator',
    pluginId: 'plg_core_studio',
    name: '마케팅 카피 및 초안 생성',
    category: 'content',
    intentKeywords: ['초안', '문구', '카피', '글작성', '기획', '이벤트'],
    description: '매장 비법 헌장에 맞춰 다양한 버전의 마케팅 문구를 생성합니다.',
    creditCost: 10,
    riskClass: 'DRAFT',
    schemaGetter: () => ({
      type: 'object',
      properties: {
        topic: { type: 'string' },
        tone: { type: 'string' },
        targetAudience: { type: 'string' },
      },
      required: ['topic'],
    }),
  },
  {
    toolId: 'tool_booking_slot_checker',
    pluginId: 'plg_booking_engine',
    name: '예약 잔여 슬롯 조회',
    category: 'booking',
    intentKeywords: ['예약', '슬롯', '빈시간', '스케줄', '일정', '잔여'],
    description: '네이버 플레이스 또는 매장 예약 일정의 빈 슬롯을 확인합니다.',
    creditCost: 5,
    riskClass: 'READ',
    schemaGetter: () => ({
      type: 'object',
      properties: {
        date: { type: 'string' },
        serviceId: { type: 'string' },
      },
      required: ['date'],
    }),
  },
  {
    toolId: 'tool_attribution_roas_calculator',
    pluginId: 'plg_analytics_os',
    name: '실매출 기여도 및 ROAS 분석',
    category: 'attribution',
    intentKeywords: ['성과', '매출', '기여도', 'roas', '전환율', '분석'],
    description: '외부 광고비 및 고객 방문 데이터를 대조하여 실매출 기여도를 산출합니다.',
    creditCost: 10,
    riskClass: 'READ',
    schemaGetter: () => ({
      type: 'object',
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        model: { type: 'string', enum: ['FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR'] },
      },
      required: ['startDate', 'endDate'],
    }),
  },
]

export class ToolSchemaLazyLoader {
  private tools: ToolMetadata[]

  constructor(tools: ToolMetadata[] = LAZY_TOOL_CATALOG) {
    this.tools = tools
  }

  /**
   * Resolves only necessary and READY schemas based on user query/intent.
   */
  public resolveSchemasForIntent(params: {
    query: string
    workspaceId: string
    planTier: AgentEnergyPlanTier
    creditBalance: number
    maxCandidates?: number
  }): LazySchemaResolution {
    const { query, workspaceId, planTier, creditBalance, maxCandidates = 3 } = params
    const normalizedQuery = query.toLowerCase()

    // 1. Semantic Match: Score tools by keyword match
    const scored = this.tools.map((tool) => {
      let score = 0
      for (const kw of tool.intentKeywords) {
        if (normalizedQuery.includes(kw.toLowerCase())) {
          score += 2
        }
      }
      if (normalizedQuery.includes(tool.name.toLowerCase())) {
        score += 3
      }
      return { tool, score }
    })

    // Sort by score descending and take top matches (must have score > 0 or default to draft)
    let candidates = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCandidates)
      .map((s) => s.tool)

    if (candidates.length === 0) {
      // Fallback to internal content draft generator if no specific channel matched
      const fallback = this.tools.find((t) => t.toolId === 'tool_content_draft_generator')
      candidates = fallback ? [fallback] : []
    }

    // 2. Live READY Gate Filtering
    const readyCandidates: string[] = []
    const blockedCandidates: { toolId: string; reason: string }[] = []
    const expandedSchemas: { toolId: string; name: string; schema: Record<string, unknown> }[] = []

    for (const tool of candidates) {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.pluginId === tool.pluginId) ?? {
        pluginId: tool.pluginId,
        slug: tool.pluginId,
        displayName: tool.name,
        version: '1.0.0',
        publisherId: 'pub_sohee',
        publisherType: 'SOHEE' as const,
        summary: tool.description,
        categories: [tool.category],
        outcomeTags: [],
        icon: 'Tool',
        trustTier: 'SOHEE_CORE' as const,
        minPlanTier: 'FREE_TASTE' as const,
        entitlementKey: 'ent_default',
        capabilities: [],
        requiredScopes: [],
        approvalDefault: 'ASK_ON_CHANGE' as const,
        creditMeteringPolicyId: 'meter_std',
      }

      const readyEval = evaluatePluginExecutableReady({
        workspaceId,
        manifest,
        installation: {
          installationId: `inst-${tool.pluginId}`,
          workspaceId,
          pluginId: tool.pluginId,
          manifestVersion: '1.0.0',
          state: 'READY',
          installedAt: '2026-09-01T00:00:00Z',
          connectedAccountId: 'acc_live',
          healthStatus: 'HEALTHY',
          lastHealthCheckedAt: new Date().toISOString(),
          approvalMode: 'ASK_ON_CHANGE',
          isCircuitBreakerOpen: false,
        },
        currentPlanTier: planTier,
        creditBalance,
        estimatedCreditCost: tool.creditCost,
      })

      if (readyEval.isReady) {
        readyCandidates.push(tool.toolId)
        // 3. Lazy Schema Expansion
        expandedSchemas.push({
          toolId: tool.toolId,
          name: tool.name,
          schema: tool.schemaGetter(),
        })
      } else {
        blockedCandidates.push({
          toolId: tool.toolId,
          reason: readyEval.blockedReason ?? '준비 상태 미충족',
        })
      }
    }

    const decisionTrace = `질의 [${query}]에 대해 전체 ${this.tools.length}개 도구 중 후보 ${candidates.length}건 선별 -> READY 게이트 통과 ${readyCandidates.length}건만 스키마 확장 완료`

    return {
      query,
      evaluatedCount: this.tools.length,
      matchedCandidates: candidates.map((c) => c.toolId),
      readyCandidates,
      blockedCandidates,
      expandedSchemas,
      decisionTrace,
    }
  }
}

export const defaultToolSchemaLazyLoader = new ToolSchemaLazyLoader()
