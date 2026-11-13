import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { DomainToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types';

const ROUTE_WHITELIST: Record<string, string> = {
  home: '/app',
  content: '/app/content',
  customers: '/app/customers',
  results: '/app/results',
  sohee: '/app/sohee',
  ads: '/app/ads',
  system: '/app/system',
  channels: '/app/settings/channels',
};

export const systemDispatcher: DomainToolHandler = {
  toolId: 'system.domain',
  domain: 'SYSTEM',

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const rawToolName = String(args._toolName || args.toolName || 'app.navigate');

    // 1. Navigation Dispatch
    if (rawToolName === 'app.navigate' || rawToolName === 'mcp_navigate_console') {
      const target = String(args.target || 'home').toLowerCase();
      const mappedUrl = ROUTE_WHITELIST[target] || '/app';

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: {
          target,
          navigatedUrl: mappedUrl,
          entityId: args.entityId ? String(args.entityId) : undefined,
          action: 'NAVIGATE_MENU',
        },
        logs: [`[콘솔 내비게이션] ${mappedUrl} 화면으로 전환합니다.`],
      };
    }

    // 2. Credit Status
    if (rawToolName === 'credit.status') {
      let balance: number;

      if (typeof context.creditBalance === 'number' && Number.isFinite(context.creditBalance)) {
        balance = Math.max(0, context.creditBalance);
      } else {
        try {
          context.signal?.throwIfAborted();
          const admin = createAdminSupabaseClient();
          const query = (admin as any)
            .from('workspace_credit_states')
            .select('total_available_credits')
            .eq('workspace_id', context.workspaceId);
          const { data: creditState, error: creditError } = await (context.signal
            ? query.abortSignal(context.signal)
            : query).maybeSingle();
          context.signal?.throwIfAborted();

          if (creditError || !creditState) {
            return {
              success: false,
              toolId: rawToolName,
              status: 'FAILED',
              error: {
                code: 'CREDIT_STATE_UNAVAILABLE',
                message: '크레딧 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.',
              },
              logs: ['크레딧 정보를 확인할 수 없어 조회를 중단합니다.'],
            };
          }

          const rawTotalAvailable = Number(creditState.total_available_credits);
          if (!Number.isFinite(rawTotalAvailable)) {
            return {
              success: false,
              toolId: rawToolName,
              status: 'FAILED',
              error: {
                code: 'CREDIT_STATE_UNAVAILABLE',
                message: '크레딧 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.',
              },
              logs: ['크레딧 수치 정보가 올바르지 않아 조회를 중단합니다.'],
            };
          }

          balance = Math.max(0, rawTotalAvailable);
        } catch {
          context.signal?.throwIfAborted();
          return {
            success: false,
            toolId: rawToolName,
            status: 'FAILED',
            error: {
              code: 'CREDIT_STATE_UNAVAILABLE',
              message: '크레딧 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.',
            },
            logs: ['크레딧 조회 중 오류가 발생했습니다.'],
          };
        }
      }

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: {
          workspaceId: context.workspaceId,
          balance,
          isTestAccount: !!context.isTestAccount,
        },
        logs: [`현재 사용 가능한 크레딧: ${balance.toLocaleString()} 크레딧`],
      };
    }

    return {
      success: false,
      toolId: rawToolName,
      status: 'NOT_IMPLEMENTED',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: `시스템 도구 [${rawToolName}]는 아직 실제 서비스와 연결되지 않았습니다.`,
      },
    };
  },
};
