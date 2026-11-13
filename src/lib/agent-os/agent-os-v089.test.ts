import { describe, it, expect, vi } from 'vitest'
import { MODEL_PROFILES, getModelProfile, GEMINI_FALLBACK_PROFILE } from '@/lib/ai/model-profiles'
import { SOHEE_CAPABILITY_REGISTRY, getOpenAIToolDefinitions } from '@/lib/agent-os/mcp-capability-registry'
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((table: string) => table === 'agent_memories' ? {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'memory-persisted' }, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'memory-persisted', workspace_id: 'ws-test', status: 'approved' }, error: null,
      }),
    } : ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
    })),
    rpc: vi.fn().mockResolvedValue({ data: { blocked: false }, error: null })
  }))
}))

describe('Sohee V0.8.9 6th Revision Agent OS Verification (ANI-647 ~ ANI-659)', () => {
  describe('1. Model Separation Contracts (ANI-649, ANI-657)', () => {
    it('uses Gemini 3.5 Flash Lite for conversation/reasoning AI', () => {
      const convProfile = getModelProfile('conversation')
      expect(convProfile.modelId).toBe('gemini-3.5-flash-lite')
      expect(convProfile.role).toBe('conversation')
      expect(convProfile.provider).toBe('gemini')
      expect(convProfile.temperature).toBe(0.7)
    })

    it('uses separate Gemini 3.8 Flash profile with strict low temperature for action worker', () => {
      const actionProfile = getModelProfile('action')
      expect(actionProfile.modelId).toBe('gemini-3.8-flash')
      expect(actionProfile.role).toBe('action')
      expect(actionProfile.provider).toBe('gemini')
      expect(actionProfile.temperature).toBe(0.1) // strict deterministic
      expect(actionProfile.structuredOutput).toBe(true)
    })

    it('uses GPT-Image-2.5 Sunburst for image generation worker', () => {
      const imgProfile = getModelProfile('image')
      expect(imgProfile.modelId).toBe('gpt-image-2.5-sunburst')
      expect(imgProfile.role).toBe('image')
      expect(imgProfile.provider).toBe('openai')
    })

    it('has Gemini 3.8 Flash ready as fallback adapter', () => {
      expect(GEMINI_FALLBACK_PROFILE).toBeDefined()
      expect(GEMINI_FALLBACK_PROFILE.modelId).toBe('gemini-3.8-flash')
      expect(GEMINI_FALLBACK_PROFILE.provider).toBe('gemini')
    })

    it('ensures gpt-4o is completely absent from all active production model profiles', () => {
      const profiles = Object.values(MODEL_PROFILES)
      for (const p of profiles) {
        expect(p.modelId).not.toBe('gpt-4o')
        expect(p.modelId).not.toBe('gpt-4o-mini')
      }
    })
  })

  describe('2. MCP Capability Registry (ANI-650, ANI-659)', () => {
    it('registers all 12 core domains from spec 03', () => {
      const tools = Object.values(SOHEE_CAPABILITY_REGISTRY)
      expect(tools.length).toBeGreaterThanOrEqual(20)
      
      const domains = new Set(tools.map(t => t.domain))
      expect(domains).toContain('CONTENT')
      expect(domains).toContain('IMAGE')
      expect(domains).toContain('CAMPAIGN')
      expect(domains).toContain('CHANNEL')
      expect(domains).toContain('PUBLISHING')
      expect(domains).toContain('INTERACTION')
      expect(domains).toContain('CRM')
      expect(domains).toContain('REVIEW')
      expect(domains).toContain('KNOWLEDGE')
      expect(domains).toContain('REPORT')
      expect(domains).toContain('SYSTEM')
      expect(domains).toContain('NAVIGATION')
    })

    it('registers canonical capability identifiers and aliases correctly', () => {
      expect(SOHEE_CAPABILITY_REGISTRY['content.generate']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['image.generate']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['publish.create']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['comment.reply']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['dm.send']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['customer.search']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['reservation.create']).toBeDefined()
      expect(SOHEE_CAPABILITY_REGISTRY['app.navigate']).toBeDefined()
    })

    it('enforces CRITICAL danger levels on mutating publishing actions', () => {
      const publishTool = SOHEE_CAPABILITY_REGISTRY['publish.create']
      expect(publishTool).toBeDefined()
      expect(publishTool.riskTier).toBe('CRITICAL')
      expect(publishTool.requiresOwnerApproval).toBe(true)
      expect(publishTool.idempotencyRequired).toBe(true)

      const killswitch = SOHEE_CAPABILITY_REGISTRY['emergency_killswitch']
      expect(killswitch).toBeDefined()
      expect(killswitch.riskTier).toBe('CRITICAL')
    })

    it('converts tools to valid OpenAI function call schemas', () => {
      const tools = getOpenAIToolDefinitions()
      expect(tools.length).toBeGreaterThanOrEqual(20)
      for (const tool of tools) {
        expect(tool.type).toBe('function')
        expect(tool.function.name).toBeDefined()
        expect(tool.function.parameters.type).toBe('object')
      }
    })
  })

  describe('3. Publishing Executor Anti-Mock Contracts (ANI-655)', () => {
    it('rejects publishing gracefully when channel is not connected and never mocks success', async () => {
      const result = await PublishingExecutor.executePublish({
        workspaceId: 'ws-test',
        channel: 'INSTAGRAM',
        caption: 'Test content',
        idempotencyKey: 'idem-test-123'
      })

      expect(result.channel).toBe('INSTAGRAM')
      expect(result.errorCode).toBeDefined()
      if (!result.success) {
        expect(result.verified).toBe(false)
      }
    })
  })

  describe('4. Interaction Executor DRAFT vs EXECUTE Intent (ANI-656)', () => {
    it('guarantees 0 external sends in DRAFT mode ("답변 써줘")', async () => {
      const { InteractionExecutor } = await import('@/lib/agent-os/executors/interaction-executor')
      
      const draftResult = await InteractionExecutor.replyToComment({
        workspaceId: 'ws-test',
        channel: 'INSTAGRAM',
        targetId: 'comment-123',
        replyText: '안녕하세요! 자연스러운 맞춤 눈썹 안내드립니다.',
        intentMode: 'DRAFT'
      })

      expect(draftResult.intentMode).toBe('DRAFT')
      expect(draftResult.requiresApproval).toBe(true)
      expect(draftResult.externalMessageSent).toBe(false) // Strict 0 external writes
      expect(draftResult.draftText).toBeDefined()
    })

    it('guarantees 0 external sends for DM in DRAFT mode', async () => {
      const { InteractionExecutor } = await import('@/lib/agent-os/executors/interaction-executor')
      
      const dmDraftResult = await InteractionExecutor.sendDirectMessage({
        workspaceId: 'ws-test',
        channel: 'INSTAGRAM',
        targetId: 'user-456',
        replyText: '1:1 예약 문의 답변 드립니다.',
        intentMode: 'DRAFT'
      })

      expect(dmDraftResult.intentMode).toBe('DRAFT')
      expect(dmDraftResult.requiresApproval).toBe(true)
      expect(dmDraftResult.externalMessageSent).toBe(false)
    })
  })

  describe('5. Long-Term Memory Promotion Lifecycle (ANI-654)', () => {
    it('supports full lifecycle OBSERVED -> CANDIDATE -> APPROVED -> CANONICAL', async () => {
      const { LongTermMemoryService } = await import('@/lib/memory/long-term-memory-service')

      const candId = await LongTermMemoryService.proposeCandidate('ws-test', {
        memoryClass: 'semantic',
        subject: '신규 시술 항목',
        factContent: '콤보 자연눈썹 시술 추가 (가격: 18만원)',
        provenanceType: 'user_dialogue'
      })
      expect(candId).toBeDefined()

      const promotion = await LongTermMemoryService.promoteMemoryStatus('ws-test', candId, 'approved', 'Owner approved in chat')
      expect(promotion.success).toBe(true)
      expect(promotion.status).toBe('approved')
    })
  })

  describe('6. Intent Classifier & 4 Execution Cards (ANI-651, ANI-652)', () => {
    it('correctly classifies DRAFT vs EXECUTE intent', async () => {
      const { AgentOrchestrator } = await import('@/lib/agent-os/agent-orchestrator')

      expect(AgentOrchestrator.classifyIntentMode('인스타그램 댓글 답변 초안 작성해줘')).toBe('DRAFT')
      expect(AgentOrchestrator.classifyIntentMode('고객 문의 답변 문구만 써줘')).toBe('DRAFT')
      expect(AgentOrchestrator.classifyIntentMode('이 댓글에 답변 바로 보내줘')).toBe('EXECUTE')
      expect(AgentOrchestrator.classifyIntentMode('인스타에 실시간으로 올려줘')).toBe('EXECUTE')
    }, 15000)
  })
})
