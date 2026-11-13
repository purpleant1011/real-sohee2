import { LongTermMemoryService } from '@/lib/memory/long-term-memory-service';
import { loadConversationAutomationRules } from '@/features/automation/conversation-automation-reader';
import { conversationKnowledgeRequestSchema } from '@/features/sohee-studio/conversation-knowledge-contract';
import { listApprovedKnowledgeFacts } from '@/features/harness/repository';
import { isKnowledgeFactCurrent } from '@/features/chat/knowledge-validity';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import { DomainToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types';

export const soheeDispatcher: DomainToolHandler = {
  toolId: 'sohee.domain',
  domain: 'SOHEE',

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const rawToolName = String(args._toolName || args.toolName || 'knowledge.search');

    if (rawToolName === 'automation.list') {
      const unavailable = (): ToolExecutionResult => ({ success: false, toolId: rawToolName, status: 'UNAVAILABLE',
        error: { code: 'AUTOMATION_READ_UNAVAILABLE', message: '현재 가게의 자동화 설정을 확인하지 못했어요. 설정 없음으로 판단하지 말고 다시 조회해 주세요.' } });
      if (!context.readClient) return unavailable();
      try {
        context.signal?.throwIfAborted();
        const data = await loadConversationAutomationRules({ client: context.readClient, workspaceId: context.workspaceId });
        context.signal?.throwIfAborted();
        if (data.workspaceId !== context.workspaceId) return unavailable();
        return { success: true, toolId: rawToolName, status: 'COMPLETED', data };
      } catch {
        context.signal?.throwIfAborted();
        return unavailable();
      }
    }

    // 1. Knowledge Retrieval
    if (rawToolName === 'knowledge.search') {
      const query = String(args.query || args.keywords || '');
      let memories: Awaited<ReturnType<typeof LongTermMemoryService.retrieveRelevantMemories>>;
      let facts: { id: string; category: string; content: string; excerpted: boolean; validFrom?: string | null; validUntil?: string | null }[] = [];
      try {
        memories = await LongTermMemoryService.retrieveRelevantMemories(
          context.workspaceId, [query], 5, context.signal,
          context.readClient ? { client: context.readClient, strict: true } : undefined
        );
        if (context.readClient) {
          const approved = await listApprovedKnowledgeFacts({ client: context.readClient, workspaceId: context.workspaceId });
          if (approved.some(fact => fact.workspaceId !== context.workspaceId)) throw new Error('KNOWLEDGE_SCOPE_MISMATCH');
          const observedAt = new Date().toISOString();
          const terms = [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1))];
          facts = approved.filter(fact => fact.status === 'active' && isKnowledgeFactCurrent(fact, observedAt))
            .map(fact => ({ fact, score: terms.filter(term => `${fact.category} ${fact.content}`.toLocaleLowerCase().includes(term)).length }))
            .filter(value => value.score > 0).sort((left, right) => right.score - left.score).slice(0, 5)
            .map(({ fact }) => ({ id: fact.id, category: fact.category, content: fact.content.slice(0, 2000), excerpted: fact.content.length > 2000,
              validFrom: fact.validFrom ?? null, validUntil: fact.validUntil ?? null }));
        }
      } catch (error) {
        context.signal?.throwIfAborted();
        if (!context.readClient) throw error;
        return { success: false, toolId: rawToolName, status: 'FAILED',
          error: { code: 'KNOWLEDGE_READ_UNAVAILABLE', message: '가게 지식의 최신 내용을 확인하지 못했어요. 다시 조회해 주세요.' } };
      }

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: {
          totalFound: memories.length + facts.length,
          facts,
          searchMode: 'bounded_keyword_search',
          note: '승인 지식과 정본 메모리의 관련 검색 결과입니다. 일부 조회이며 전체 문서 열람이나 실시간 외부 수집을 뜻하지 않습니다.',
          memories: memories.map((m) => ({
            id: m.id,
            subject: m.subject,
            factContent: m.factContent,
            memoryClass: m.memoryClass,
          })),
        },
        logs: [`매장 지식베이스에서 ${memories.length + facts.length}건의 관련 항목 조회 완료`],
      };
    }

    // 2. Knowledge Propose (Learning & Rules)
    if (rawToolName === 'knowledge.propose') {
      const request = { ...args };
      delete request._toolName;
      delete request.toolName;
      const parsed = conversationKnowledgeRequestSchema.safeParse(request);
      if (!context.proposeKnowledge || !parsed.success) return { success: false, toolId: rawToolName, status: 'BLOCKED',
        error: { code: 'KNOWLEDGE_PROPOSAL_NOT_PREPARED', message: '현재 요청의 지식 후보 저장 권한과 원문을 확인하지 못했어요. 저장했다고 표시하지 않아요.' } };
      context.signal?.throwIfAborted();
      return context.proposeKnowledge(parsed.data);
    }

    // 3. Autonomy Update (Start / Pause)
    if (rawToolName === 'autonomy.update' || rawToolName === 'mcp_control_autonomy') {
      const isStart = args.action === 'start' || args.desiredMode === 'RUNNING';
      const mode = isStart ? 'RUNNING' : 'PAUSED';
      const reason = String(args.reason || (isStart ? '사장님 도크 명령으로 자율근무 가동' : '사장님 도크 명령으로 일시 정지'));

      const updated = await AgentControlPlaneService.setDesiredMode(
        context.workspaceId,
        mode,
        context.actorId || 'owner_dock',
        reason
      );

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: {
          workspaceId: context.workspaceId,
          desiredMode: updated.desired_mode,
          actualMode: updated.actual_mode,
          statusReason: reason,
        },
        logs: [updated.actualMode === 'RUNNING' ? '서버에서 자율근무 가동을 확인했습니다.' : updated.actualMode === 'PAUSED' ? '서버에서 자율근무 중지를 확인했습니다.' : '요청을 저장했지만 실제 실행 상태는 추가 확인이 필요합니다.'],
      };
    }

    // 4. Emergency Kill Switch
    if (rawToolName === 'emergency_killswitch' || rawToolName === 'mcp_emergency_killswitch') {
      const isKill = args.action === 'kill' || args.killSwitchActive === true;
      const reason = String(args.reason || (isKill ? '긴급 킬스위치 가동' : '킬스위치 해제'));

      const updated = await AgentControlPlaneService.toggleKillSwitch(
        context.workspaceId,
        isKill,
        context.actorId || 'owner_dock',
        reason
      );

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: {
          workspaceId: context.workspaceId,
          killSwitchActive: isKill,
          actualMode: updated.actual_mode,
        },
        logs: [isKill ? '🚨 긴급 킬스위치가 가동되어 모든 외부 쓰기가 즉시 차단되었습니다.' : '킬스위치가 안전하게 해제되었습니다.'],
      };
    }

    return {
      success: false,
      toolId: rawToolName,
      status: 'NOT_IMPLEMENTED',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: `나의 소희 도구 [${rawToolName}]는 아직 실제 서비스와 연결되지 않았습니다.`,
      },
    };
  },
};
