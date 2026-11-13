import { DomainToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createProductionBookingRecoveryService } from '@/features/booking-recovery/production';
import { RecoveryActor } from '@/features/booking-recovery/contracts';

export const recoveryDispatcher: DomainToolHandler = {
  toolId: 'recovery.domain',
  domain: 'CRM',

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const rawToolName = String(args._toolName || args.toolName || 'recovery.list');

    // Support injected client for test/isolated execution or fallback to server supabase client
    let supabase = args._supabaseClient as any;
    if (!supabase) {
      try {
        supabase = await createServerSupabaseClient();
      } catch (err: any) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'UNAVAILABLE',
          error: {
            code: 'DB_UNAVAILABLE',
            message: '데이터베이스 연결을 설정할 수 없습니다.',
          },
        };
      }
    }

    const service = (args._service as any) || createProductionBookingRecoveryService(supabase);

    const actor: RecoveryActor = {
      workspaceId: context.workspaceId,
      userId: context.actorId || '00000000-0000-4000-8000-000000000000',
      role: 'owner',
    };

    // 1. recovery.list
    if (rawToolName === 'recovery.list') {
      const limit = Number(args.limit) || 10;
      const cases = await service.listCaseViews(context.workspaceId, limit);
      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: { cases, count: cases.length },
        logs: [`예약 회수 케이스 ${cases.length}건 조회 완료`],
      };
    }

    // 2. recovery.get
    if (rawToolName === 'recovery.get') {
      const caseId = String(args.caseId || '');
      if (!caseId) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'MISSING_PARAM',
            message: 'caseId가 필요합니다.',
          },
        };
      }
      const view = await service.getCaseView(context.workspaceId, caseId);
      if (!view) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'NOT_FOUND',
            message: '케이스를 찾을 수 없습니다.',
          },
        };
      }
      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: { case: view },
        logs: [`케이스(${caseId}) 상세 조회 완료`],
      };
    }

    // 3. recovery.open
    if (rawToolName === 'recovery.open') {
      const sourceInboundMessageId = String(args.sourceInboundMessageId || '');
      if (!sourceInboundMessageId) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'MISSING_PARAM',
            message: 'sourceInboundMessageId가 필요합니다.',
          },
        };
      }
      const res = await service.openCase(actor, sourceInboundMessageId);
      if (!res.ok) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: res.code || 'OPEN_FAILED',
            message: res.message,
          },
        };
      }
      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: { case: res.value },
        logs: [`수신 메시지로부터 회수 케이스 오픈 완료: ${res.value.caseId}`],
      };
    }

    // 4. recovery.prepare
    if (rawToolName === 'recovery.prepare') {
      const caseId = String(args.caseId || '');
      const expectedVersion = Number(args.expectedVersion) || 1;
      const slotId = args.slotId ? String(args.slotId) : undefined;

      const res = await service.prepareReply(actor, {
        caseId,
        expectedVersion,
        slotId,
      });

      if (!res.ok) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: res.code || 'PREPARE_FAILED',
            message: res.message,
          },
        };
      }

      return {
        success: true,
        toolId: rawToolName,
        status: 'COMPLETED',
        data: { case: res.value },
        logs: [`답변 제안 초안 준비 완료: revision ${res.value.offer?.proposalRevision || 1}`],
      };
    }

    // 5. recovery.request_send_approval (Safe approval card proposal ONLY, NEVER auto-send)
    if (rawToolName === 'recovery.request_send_approval') {
      const caseId = String(args.caseId || '');
      const view = await service.getCaseView(context.workspaceId, caseId);
      if (!view) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'NOT_FOUND',
            message: '케이스를 찾을 수 없습니다.',
          },
        };
      }

      return {
        success: true,
        toolId: rawToolName,
        status: 'AWAITING_APPROVAL',
        proposal: {
          proposalId: `prop_rec_send_${caseId}_${view.version}`,
          proposalType: 'RECOVERY_SEND_APPROVAL',
          title: '답변 문안 발송 승인 요청',
          description: `답변 문안 발송 승인 요청 (${view.statusLabel})`,
          proposedValue: {
            caseId,
            version: view.version,
            replyText: view.reply?.text,
            offer: view.offer,
          },
        },
        data: { case: view },
        logs: ['답변 발송을 위한 사장님 승인 카드를 준비했습니다. 직접 발송하지 않습니다.'],
      };
    }

    // 6. recovery.request_booking_approval (Safe booking card proposal ONLY, NEVER auto-confirm)
    if (rawToolName === 'recovery.request_booking_approval') {
      const caseId = String(args.caseId || '');
      const view = await service.getCaseView(context.workspaceId, caseId);
      if (!view) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'NOT_FOUND',
            message: '케이스를 찾을 수 없습니다.',
          },
        };
      }

      return {
        success: true,
        toolId: rawToolName,
        status: 'AWAITING_APPROVAL',
        proposal: {
          proposalId: `prop_rec_book_${caseId}_${view.version}`,
          proposalType: 'RECOVERY_BOOKING_APPROVAL',
          title: '예약 확정 승인 요청',
          description: `예약 확정 승인 요청 (${view.statusLabel})`,
          proposedValue: {
            caseId,
            version: view.version,
            offer: view.offer,
            acceptance: view.acceptance,
          },
        },
        data: { case: view },
        logs: ['예약 확정을 위한 사장님 승인 카드를 준비했습니다. 직접 확정하지 않습니다.'],
      };
    }

    return {
      success: false,
      toolId: rawToolName,
      status: 'FAILED',
      error: {
        code: 'UNSUPPORTED_TOOL',
        message: `지원하지 않는 회수 도구입니다: ${rawToolName}`,
      },
    };
  },
};
