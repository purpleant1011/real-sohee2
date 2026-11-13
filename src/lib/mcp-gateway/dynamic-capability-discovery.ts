/**
 * Dynamic Capability Discovery Engine (ANI-973)
 * 
 * Invariant: Never dump all 18+ tool schemas unconditionally into agent prompt.
 * 
 * Dynamic Discovery Pipeline:
 * 1. Surface & Goal Context Filter: Maps the 7 canonical surface contexts
 *    (CHAT, CAMPAIGN, CONTENT, CRM, ADS, REPORT, SETTINGS) to relevant domains/capabilities.
 * 2. Operational Readiness Gate: Probes CapabilityStatusRegistry.
 *    Only OPERATIONAL_READY capabilities are returned to the planner.
 * 3. Fail-Closed Exclusion Tracking: Capabilities in NOT_IMPLEMENTED, DISCONNECTED,
 *    BLOCKED, or DEGRADED states are excluded from prompt injection, and explicit exclusionReasons are recorded.
 */

import {
  SOHEE_CAPABILITY_REGISTRY,
  CapabilityDefinition,
  resolveCapabilityId,
} from '@/lib/agent-os/mcp-capability-registry';
import {
  CapabilityStatusRegistry,
  CapabilityOperationalStatus,
} from './capability-status-registry';
import type { CanonicalSurfaceContext } from '@/features/agent-session/types';

export type SurfaceContextType =
  | 'CHAT'
  | 'CAMPAIGN'
  | 'CONTENT'
  | 'CRM'
  | 'ADS'
  | 'REPORT'
  | 'SETTINGS';

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface CapabilityExclusionRecord {
  capabilityId: string;
  status: CapabilityOperationalStatus;
  reason: string;
}

export interface OperationalCapabilityResult {
  surface: SurfaceContextType;
  goal: string;
  workspaceId: string;
  operationalCapabilities: CapabilityDefinition[];
  openAiTools: OpenAIToolDefinition[];
  exclusionReasons: CapabilityExclusionRecord[];
  totalEvaluated: number;
}

export interface DiscoveryInputParams {
  goal: string;
  surfaceContext?: SurfaceContextType | CanonicalSurfaceContext | Record<string, unknown> | string;
  workspaceId: string;
  maxCandidates?: number;
  /** Trusted server policy, never inferred from model arguments. An empty list means no tools. */
  allowedCapabilityIds?: readonly string[];
}

// Surface -> Capability IDs mapping
const SURFACE_CAPABILITY_MAP: Record<SurfaceContextType, string[]> = {
  CONTENT: [
    'content.generate',
    'content.rewrite',
    'content.list',
    'content.schedule',
    'image.generate',
    'image.regenerate',
    'publish.create',
    'publish.verify',
  ],
  CRM: [
    'customer.search',
    'reservation.list',
    'reservation.create',
    'interaction.list',
    'comment.reply',
    'dm.send',
    'review.list',
    'review.respond',
    'recovery.list',
    'recovery.get',
    'recovery.open',
    'recovery.prepare',
    'recovery.request_send_approval',
    'recovery.request_booking_approval',
  ],
  CAMPAIGN: [
    'campaign.create',
    'campaign.plan',
    'campaign.status',
    'channel.list',
    'channel.status',
    'channel.capabilities',
    'channel.test_publish',
    'ads.list',
    'ads.status',
  ],
  ADS: [
    'ads.list',
    'ads.status',
    'campaign.plan',
    'campaign.create',
  ],
  REPORT: [
    'report.generate',
    'performance.summary',
  ],
  SETTINGS: [
    'autonomy.get',
    'autonomy.update',
    'credit.status',
    'emergency_killswitch',
    'channel.list',
    'channel.status',
    'app.navigate',
    'app.focus',
  ],
  CHAT: [
    'knowledge.search',
    'knowledge.propose',
    'app.navigate',
    'credit.status',
    'emergency_killswitch',
  ],
};

// Keyword intent matching rules for CHAT surface
const CHAT_INTENT_KEYWORD_MAP: Array<{
  keywords: string[];
  capabilities: string[];
}> = [
  {
    keywords: ['원고', '글', '작성', '카피', '콘텐츠', '피드', '게시', '인스타', '블로그', '스레드', '당근'],
    capabilities: ['content.generate', 'content.rewrite', 'publish.create'],
  },
  {
    keywords: ['사진', '이미지', '룩북', '시술사진', '비포애프터', '그림', '생성'],
    capabilities: ['image.generate'],
  },
  {
    keywords: ['고객', '손님', '문의', '상담', '채팅', 'dm', '디엠', '댓글', '답변', '답글', '리뷰', '후기'],
    capabilities: ['interaction.list', 'customer.search', 'comment.reply', 'dm.send', 'review.list', 'review.respond'],
  },
  {
    keywords: ['미응답', '미결제', '회수', '예약문의', '문의 답변', '예약 확정'],
    capabilities: [
      'recovery.list',
      'recovery.get',
      'recovery.open',
      'recovery.prepare',
      'recovery.request_send_approval',
      'recovery.request_booking_approval',
    ],
  },
  {
    keywords: ['예약', '일정', '스케줄', '슬롯', '장부', '예약금'],
    capabilities: ['customer.search', 'reservation.list'],
  },
  {
    keywords: ['광고', '소진', '광고비', '소재', '애드'],
    capabilities: ['ads.list', 'ads.status', 'campaign.plan'],
  },
  {
    keywords: ['캠페인', '프로모션', '이벤트', '기획'],
    capabilities: ['campaign.create', 'campaign.plan'],
  },
  {
    keywords: ['성과', '매출', '보고서', '리포트', 'roas', 'cac', '정산', '수익'],
    capabilities: ['report.generate', 'performance.summary'],
  },
  {
    keywords: ['자율', '근무', '킬스위치', '중단', '차단', '크레딧', '잔여', '잔액'],
    capabilities: ['autonomy.update', 'emergency_killswitch', 'credit.status'],
  },
  {
    keywords: ['이동', '화면', '메뉴', '대시보드'],
    capabilities: ['app.navigate'],
  },
];

export class DynamicCapabilityDiscovery {
  /**
   * Resolves canonical surface context from string or structured object
   */
  public static resolveSurfaceContext(
    surfaceContext?: SurfaceContextType | CanonicalSurfaceContext | Record<string, unknown> | string
  ): SurfaceContextType {
    if (!surfaceContext) return 'CHAT';

    if (typeof surfaceContext === 'string') {
      const upper = surfaceContext.toUpperCase().trim();
      if (['CHAT', 'CAMPAIGN', 'CONTENT', 'CRM', 'ADS', 'REPORT', 'SETTINGS'].includes(upper)) {
        return upper as SurfaceContextType;
      }
      // Route matching
      const lower = surfaceContext.toLowerCase();
      if (lower.includes('content') || lower.includes('studio')) return 'CONTENT';
      if (lower.includes('customer') || lower.includes('crm') || lower.includes('interaction')) return 'CRM';
      if (lower.includes('campaign')) return 'CAMPAIGN';
      if (lower.includes('ad')) return 'ADS';
      if (lower.includes('report') || lower.includes('result')) return 'REPORT';
      if (lower.includes('setting') || lower.includes('system') || lower.includes('sohee')) return 'SETTINGS';
      return 'CHAT';
    }

    if (typeof surfaceContext === 'object') {
      const ctx = surfaceContext as CanonicalSurfaceContext;
      const route = ctx.route?.toLowerCase() || '';
      const tab = ctx.tab?.toLowerCase() || '';
      const entity = ctx.entityType?.toLowerCase() || '';

      if (route.includes('content') || entity === 'post') return 'CONTENT';
      if (route.includes('customer') || tab.includes('interaction') || entity === 'customer') return 'CRM';
      if (route.includes('campaign') || entity === 'campaign') return 'CAMPAIGN';
      if (route.includes('ad') || entity === 'ad') return 'ADS';
      if (route.includes('result') || route.includes('report')) return 'REPORT';
      if (route.includes('setting') || entity === 'setting') return 'SETTINGS';
    }

    return 'CHAT';
  }

  /**
   * Core Discovery Function:
   * Discovers and returns strictly OPERATIONAL_READY capabilities matching goal & surface.
   */
  public static async getRelevantOperationalCapabilities(
    paramsOrGoal: DiscoveryInputParams | string,
    surfaceContextArg?: SurfaceContextType | CanonicalSurfaceContext | Record<string, unknown> | string,
    workspaceIdArg?: string,
    _options?: { maxCandidates?: number }
  ): Promise<OperationalCapabilityResult> {
    let goal: string;
    let surfaceContextRaw: SurfaceContextType | CanonicalSurfaceContext | Record<string, unknown> | string | undefined;
    let workspaceId: string;

    if (typeof paramsOrGoal === 'object') {
      goal = paramsOrGoal.goal || '';
      surfaceContextRaw = paramsOrGoal.surfaceContext;
      workspaceId = paramsOrGoal.workspaceId;
    } else {
      goal = paramsOrGoal || '';
      surfaceContextRaw = surfaceContextArg;
      workspaceId = workspaceIdArg || '';
    }

    const surface = this.resolveSurfaceContext(surfaceContextRaw);

    // 1. Determine candidate capability IDs based on Surface Context
    let candidateIds = new Set<string>();

    if (surface === 'CHAT') {
      // In CHAT surface: Base conversational tools
      SURFACE_CAPABILITY_MAP.CHAT.forEach(id => candidateIds.add(id));

      // Plus goal intent matching
      const normalizedGoal = goal.toLowerCase();
      let matchedAnyIntent = false;

      for (const rule of CHAT_INTENT_KEYWORD_MAP) {
        if (rule.keywords.some(kw => normalizedGoal.includes(kw.toLowerCase()))) {
          rule.capabilities.forEach(id => candidateIds.add(id));
          matchedAnyIntent = true;
        }
      }

      // If goal is broad or no specific intent matched, include top operational across all domains
      if (!matchedAnyIntent && !surfaceContextRaw) {
        Object.keys(SOHEE_CAPABILITY_REGISTRY).forEach(id => candidateIds.add(id));
      }
    } else {
      // Specific surface: Only capabilities belonging to this surface
      const surfaceTools = SURFACE_CAPABILITY_MAP[surface] || [];
      surfaceTools.forEach(id => candidateIds.add(id));
    }

    // 2. Filter through Live Operational Readiness Gate
    const operationalCapabilities: CapabilityDefinition[] = [];
    const openAiTools: OpenAIToolDefinition[] = [];
    const exclusionReasons: CapabilityExclusionRecord[] = [];

    const serverCandidates = typeof paramsOrGoal === 'object' ? paramsOrGoal.allowedCapabilityIds : undefined;
    if (serverCandidates !== undefined) candidateIds = new Set(serverCandidates.map(resolveCapabilityId));
    else {
      candidateIds.delete('comment.reply_draft');
      candidateIds.delete('dm.reply_draft');
    }
    const evaluatedArray = Array.from(candidateIds);

    for (const toolId of evaluatedArray) {
      const canonicalId = resolveCapabilityId(toolId);
      const capDef = SOHEE_CAPABILITY_REGISTRY[canonicalId];

      if (!capDef) {
        exclusionReasons.push({
          capabilityId: toolId,
          status: 'NOT_IMPLEMENTED',
          reason: `도구 [${toolId}]가 레지스트리에 등록되지 않았습니다 (Fail-Closed).`,
        });
        continue;
      }

      const statusResult = await CapabilityStatusRegistry.getStatus(workspaceId, canonicalId);

      if (statusResult.status === 'OPERATIONAL_READY') {
        operationalCapabilities.push(capDef);
        openAiTools.push({
          type: 'function',
          function: {
            name: capDef.id,
            description: `[${capDef.domain}] ${capDef.name} - ${capDef.description}`,
            parameters: capDef.parametersSchema,
          },
        });
      } else {
        // Record exclusion reason
        exclusionReasons.push({
          capabilityId: capDef.id,
          status: statusResult.status,
          reason:
            statusResult.reason ||
            `도구 [${capDef.id}]는 현재 ${statusResult.status} 상태로 실행이 불가합니다.`,
        });
      }
    }

    return {
      surface,
      goal,
      workspaceId,
      operationalCapabilities,
      openAiTools,
      exclusionReasons,
      totalEvaluated: evaluatedArray.length,
    };
  }
}

export const getRelevantOperationalCapabilities = (
  paramsOrGoal: DiscoveryInputParams | string,
  surfaceContextArg?: SurfaceContextType | CanonicalSurfaceContext | Record<string, unknown> | string,
  workspaceIdArg?: string,
  options?: { maxCandidates?: number }
) => DynamicCapabilityDiscovery.getRelevantOperationalCapabilities(paramsOrGoal, surfaceContextArg, workspaceIdArg, options);
