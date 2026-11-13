import 'server-only';

import { z } from 'zod';
import { getAgentBuild, validateStructuredPlanSchema } from './gemini-planner-registry';
import { getGeminiApiBaseUrl } from '@/lib/ai/model-profiles';

export const MarketingPlanOutputSchema = z.object({
  goalId: z.string(),
  strategyName: z.string(),
  targetAudience: z.string(),
  keyMessage: z.string(),
  recommendedChannels: z.array(z.string()),
  estimatedEnergyCost: z.number(),
  missions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      channel: z.string(),
      actions: z.array(
        z.object({
          tool: z.string(),
          params: z.record(z.string(), z.unknown()),
          risk_tier: z.enum(['R0_LOW', 'R1_MODERATE', 'R2_CRITICAL']).default('R0_LOW'),
          expectedEnergyCost: z.number().default(5),
        })
      ),
    })
  ),
});

export type MarketingPlanOutput = z.infer<typeof MarketingPlanOutputSchema>;

export interface PlannerInvocationResult {
  success: boolean;
  plan?: MarketingPlanOutput;
  error?: string;
  trace: {
    traceId: string;
    model: string;
    buildTag: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    planVersion: string;
    executedAt: string;
  };
}

class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 3;
  private readonly cooldownMs = 30000; // 30s
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure() {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}

const plannerCircuitBreaker = new CircuitBreaker();

/**
 * Gemini Planner Service (ANI-702)
 * Pure planning adapter: Generates structured marketing plans via Gemini 3.8 Flash.
 * Invariant: Never executes external mutations; only returns verifiable plans.
 */
export async function generateMarketingPlanWithGemini(params: {
  workspaceId: string;
  businessName: string;
  businessCategory: string;
  targetCustomer?: string;
  coreBenefit?: string;
  tone?: string;
  connectedChannels: string[];
  isFreeTaste?: boolean;
}): Promise<PlannerInvocationResult> {
  const startTime = Date.now();
  const traceId = `trace_plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const build = getAgentBuild('v0.9.0-gemini-flash-prod');
  const planVersion = `pv_${Date.now()}_v09`;

  if (plannerCircuitBreaker.isOpen()) {
    return {
      success: false,
      error: 'CIRCUIT_BREAKER_OPEN: Gemini 플래너 서비스가 일시적으로 보호 모드에 진입했습니다. 30초 후 다시 시도해 주세요.',
      trace: {
        traceId,
        model: build.primaryPlannerModel,
        buildTag: build.buildTag,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startTime,
        planVersion,
        executedAt: new Date().toISOString(),
      },
    };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  // Free taste constraint: Generate exactly 1 high-value, low-cost mission for the connected channel
  const primaryChannel = params.connectedChannels[0] || 'instagram';

  const systemInstruction = `당신은 대한민국 1인 매장 및 소상공인을 위한 AI 마케팅 파트너 '소희'의 최고 기획자(Planner)입니다.
현재 매장의 업종과 특성에 맞춰 가장 전환율이 높고 불필요한 비용이 발생하지 않는 원자적 마케팅 계획을 1개 수립하십시오.
반드시 제공된 스키마에 맞는 JSON 형식으로만 응답해야 합니다.
직접 실행하거나 외부 API를 호출하지 마십시오. 오직 계획만 생성하십시오.`;

  const userPrompt = `매장 정보:
- 상호명: ${params.businessName}
- 업종: ${params.businessCategory}
- 타깃 고객: ${params.targetCustomer || '인근 거주 직장인 및 주민'}
- 핵심 강점: ${params.coreBenefit || '정성스러운 서비스와 최상의 품질'}
- 연동된 채널: ${primaryChannel}
- 모드: ${params.isFreeTaste ? '실제 사업자 무료 맛보기 (1회 실행 증명 모드)' : '정규 운영'}

반드시 아래 JSON 형식으로 반환하십시오:
{
  "goalId": "goal_${Date.now()}",
  "strategyName": "신규 고객 시선 사로잡기 1회 증명 콘텐츠",
  "targetAudience": "${params.targetCustomer || '인근 잠재 고객'}",
  "keyMessage": "매장의 매력을 확실하게 보여주는 첫 공식 스토리",
  "recommendedChannels": ["${primaryChannel}"],
  "estimatedEnergyCost": 5,
  "missions": [
    {
      "id": "mission_wow_1",
      "title": "${params.businessName} 첫 자율 마케팅 실행",
      "channel": "${primaryChannel}",
      "actions": [
        {
          "tool": "mcp_generate_content",
          "params": { "topic": "대표 메뉴 소개", "tone": "친근하고 정중함" },
          "risk_tier": "R0_LOW",
          "expectedEnergyCost": 2
        },
        {
          "tool": "mcp_publish_live",
          "params": { "channel": "${primaryChannel}" },
          "risk_tier": "R0_LOW",
          "expectedEnergyCost": 3
        }
      ]
    }
  ]
}`;

  try {
    let rawText = '';
    let promptTokens = 120;
    let completionTokens = 250;

    if (apiKey) {
      // Call actual Gemini API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        const baseUrl = getGeminiApiBaseUrl();
        const res = await fetch(
          `${baseUrl}/v1beta/models/${build.primaryPlannerModel}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2,
              },
            }),
          }
        );

        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`Gemini API HTTP Error: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        promptTokens = data.usageMetadata?.promptTokenCount || 120;
        completionTokens = data.usageMetadata?.candidatesTokenCount || 250;
      } catch (callErr) {
        clearTimeout(timeoutId);
        throw callErr;
      }
    } else {
      // Deterministic Server Fallback when API key is not configured in local environment
      rawText = JSON.stringify({
        goalId: `goal_${Date.now()}`,
        strategyName: `${params.businessName} 첫 시선 사로잡기 WOW 콘텐츠`,
        targetAudience: params.targetCustomer || '인근 2040 고객',
        keyMessage: `${params.businessName}만의 독보적인 혜택과 전문성 전달`,
        recommendedChannels: [primaryChannel],
        estimatedEnergyCost: 5,
        missions: [
          {
            id: `mission_${Date.now()}`,
            title: `${primaryChannel.toUpperCase()} 첫 공식 게시 및 역조회 증명`,
            channel: primaryChannel,
            actions: [
              {
                tool: 'mcp_generate_content',
                params: { topic: `${params.businessCategory} 추천`, tone: '공감형' },
                risk_tier: 'R0_LOW',
                expectedEnergyCost: 2,
              },
              {
                tool: 'mcp_publish_live',
                params: { channel: primaryChannel },
                risk_tier: 'R0_LOW',
                expectedEnergyCost: 3,
              },
            ],
          },
        ],
      });
    }

    const parsedJson = JSON.parse(rawText);
    const parsedPlan = MarketingPlanOutputSchema.parse(parsedJson);

    // Validate tools against allowlist
    const schemaValidation = validateStructuredPlanSchema(parsedPlan);
    if (!schemaValidation.valid) {
      throw new Error(`Plan Schema Validation Failed: ${schemaValidation.error}`);
    }

    plannerCircuitBreaker.recordSuccess();

    return {
      success: true,
      plan: parsedPlan,
      trace: {
        traceId,
        model: build.primaryPlannerModel,
        buildTag: build.buildTag,
        promptTokens,
        completionTokens,
        latencyMs: Date.now() - startTime,
        planVersion,
        executedAt: new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    plannerCircuitBreaker.recordFailure();
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMsg,
      trace: {
        traceId,
        model: build.primaryPlannerModel,
        buildTag: build.buildTag,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startTime,
        planVersion,
        executedAt: new Date().toISOString(),
      },
    };
  }
}
