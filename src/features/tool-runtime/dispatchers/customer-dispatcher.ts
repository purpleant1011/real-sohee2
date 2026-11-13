import { InteractionExecutor, InteractionIntentMode } from '@/lib/agent-os/executors/interaction-executor';
import { ReservationCanonicalService, ReservationError } from '@/features/reservations/reservation-canonical-service';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { DomainToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types';
import { loadAgentInbox } from '@/features/engagement/agent-inbox';

export const customerDispatcher: DomainToolHandler = {
  toolId: 'customer.domain',
  domain: 'CRM',

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const rawToolName = String(args._toolName || args.toolName || 'customer.search');
    const intentMode: InteractionIntentMode = context.intentMode || 'DRAFT';

    if (rawToolName === 'comment.reply_draft' || rawToolName === 'dm.reply_draft') {
      if (!context.prepareInteractionDraft) return { success: false, toolId: rawToolName, status: 'BLOCKED',
        error: { code: 'DRAFT_PREPARER_UNAVAILABLE', message: '현재 대화에서는 답안 저장을 시작할 수 없어요.' } };
      if (typeof args.targetId !== 'string' || typeof args.draftText !== 'string' || typeof args.sourceRef !== 'string') {
        return { success: false, toolId: rawToolName, status: 'FAILED',
          error: { code: 'MALFORMED_ARGUMENTS', message: '답안의 대상과 원문 기준을 확인해 주세요.' } };
      }
      return context.prepareInteractionDraft({ targetKind: rawToolName === 'dm.reply_draft' ? 'dm' : 'comment',
        targetId: args.targetId, draftText: args.draftText, sourceRef: args.sourceRef });
    }

    // 1. Customer Search / Query CRM & Bookings
    if (rawToolName === 'customer.search' || rawToolName === 'mcp_query_customers') {
      const crmRes = await InteractionExecutor.queryCustomerInteractions(context.workspaceId, context.signal, context.readClient);
      return {
        success: crmRes.success,
        toolId: rawToolName,
        status: crmRes.success ? 'COMPLETED' : 'FAILED',
        data: {
          // 예약 확정 건수·수납 금액은 상담 표에 근거가 없으므로 null(미관측)로 내려간다.
          totalConfirmedBookings: crmRes.totalConfirmedBookings,
          bookingState: crmRes.bookingState,
          totalDepositCollected: crmRes.totalDepositCollected,
          depositState: crmRes.depositState,
          channelsSummary: crmRes.channelsSummary,
          customerList: crmRes.customerList,
          totalInteractions: crmRes.customerList.length,
        },
        logs: ['고객 상담 내역 실시간 조회 완료'],
      };
    }

    // 2. Comment Reply
    if (rawToolName === 'comment.reply') {
      const targetId = String(args.commentId || args.targetId || 'target-comment');
      const replyText = String(args.replyText || args.message || '');

      // Resolve channel dynamically from args or social_comments DB
      let channel: 'INSTAGRAM' | 'THREADS' = 'INSTAGRAM';
      const rawChan = String(args.channel || '').toUpperCase();
      if (rawChan === 'THREADS') {
        channel = 'THREADS';
      } else {
        try {
          const supabase = context.readClient ?? await createServerSupabaseClient();
          const { data: c } = await (supabase as any)
            .from('social_comments')
            .select('channel')
            .eq('workspace_id', context.workspaceId)
            .eq('id', targetId)
            .maybeSingle();
          if (c?.channel === 'threads') channel = 'THREADS';
        } catch {}
      }

      const replyRes = await InteractionExecutor.replyToComment({
        signal: context.signal,
        workspaceId: context.workspaceId,
        channel,
        targetId,
        replyText,
        intentMode,
      });

      if (replyRes.intentMode === 'DRAFT') {
        return {
          success: true,
          toolId: rawToolName,
          status: 'AWAITING_APPROVAL',
          proposal: {
            proposalId: `prop_reply_${Date.now()}`,
            proposalType: 'COMMENT_REPLY_APPROVAL',
            title: `${channel === 'THREADS' ? '스레드' : '인스타그램'} 댓글 답변 전송 승인 요청`,
            description: `답변 내용: "${replyText.slice(0, 50)}..."`,
            proposedValue: { targetId, replyText, channel },
          },
          logs: ['답변 초안 작성 완료 (승인 대기 중)'],
        };
      }

      if (replyRes.success) {
        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            channel,
            providerReference: replyRes.providerReference,
            statusMessage: replyRes.statusMessage,
          },
          evidence: {
            channel,
            providerReference: replyRes.providerReference,
            verifiedAt: new Date().toISOString(),
          },
          logs: [`댓글 답변 전송 완료 (Ref: ${replyRes.providerReference})`],
        };
      }

      return {
        success: false,
        toolId: rawToolName,
        status: replyRes.errorCode === 'RESULT_UNKNOWN' ? 'RESULT_UNKNOWN' : 'FAILED',
        error: {
          code: replyRes.errorCode || 'REPLY_FAILED',
          message: replyRes.statusMessage || '댓글 전송 실패',
        },
      };
    }

    // 3. Direct Message (DM) Send
    if (rawToolName === 'dm.send') {
      const targetId = String(args.recipientId || args.targetId || 'target-customer');
      const replyText = String(args.messageText || args.message || args.replyText || '');

      const dmRes = await InteractionExecutor.sendDirectMessage({
        signal: context.signal,
        workspaceId: context.workspaceId,
        channel: 'INSTAGRAM',
        targetId,
        replyText,
        intentMode,
      });

      if (dmRes.intentMode === 'DRAFT') {
        return {
          success: true,
          toolId: rawToolName,
          status: 'AWAITING_APPROVAL',
          proposal: {
            proposalId: `prop_dm_${Date.now()}`,
            proposalType: 'DM_SEND_APPROVAL',
            title: '고객 1:1 DM 전송 승인 요청',
            description: `메시지: "${replyText.slice(0, 50)}..."`,
            proposedValue: { targetId, replyText, channel: 'INSTAGRAM' },
          },
          logs: ['1:1 DM 초안 작성 완료 (승인 대기 중)'],
        };
      }

      if (dmRes.success) {
        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            channel: 'INSTAGRAM',
            providerReference: dmRes.providerReference,
            statusMessage: dmRes.statusMessage,
          },
          evidence: {
            channel: 'INSTAGRAM',
            providerReference: dmRes.providerReference,
            verifiedAt: new Date().toISOString(),
          },
          logs: [`1:1 DM 전송 완료 (Ref: ${dmRes.providerReference})`],
        };
      }

      return {
        success: false,
        toolId: rawToolName,
        status: dmRes.errorCode === 'RESULT_UNKNOWN' ? 'RESULT_UNKNOWN' : 'FAILED',
        error: {
          code: dmRes.errorCode || 'DM_FAILED',
          message: dmRes.statusMessage || 'DM 전송 실패',
        },
      };
    }

    // 4. Reservation Creation (ANI-981)
    if (rawToolName === 'reservation.create') {
      const slotId = String(args.slotId || args.requestedDateTime || '');
      const customerId = args.customerId ? String(args.customerId) : '';
      const customerName = args.customerName ? String(args.customerName) : '고객님';
      const customerPhone = args.customerPhone ? String(args.customerPhone) : undefined;
      const serviceId = args.serviceId ? String(args.serviceId) : undefined;
      const serviceName = args.serviceName ? String(args.serviceName) : undefined;
      const depositKrw = typeof args.depositKrw === 'number' ? args.depositKrw : (typeof args.depositAmount === 'number' ? args.depositAmount : undefined);
      const totalAmountKrw = typeof args.totalAmountKrw === 'number' ? args.totalAmountKrw : undefined;
      const channelSource = args.channelSource ? String(args.channelSource) : 'INSTAGRAM_DM';

      // Validate required slot, customer, service, and financial specification (Fail-Closed)
      if (!slotId || !customerId) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'INVALID_RESERVATION_PARAMS',
            message: '예약 생성에는 슬롯(slotId)과 고객(customerId) 명시가 필수입니다.',
          },
        };
      }

      if (
        !serviceId ||
        !serviceName ||
        !Number.isSafeInteger(totalAmountKrw) ||
        totalAmountKrw! < 0 ||
        !Number.isSafeInteger(depositKrw) ||
        depositKrw! < 0 ||
        depositKrw! > totalAmountKrw!
      ) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'SERVICE_SPECIFICATION_REQUIRED',
            message: '예약 생성에는 서비스(serviceId, serviceName)와 유효한 금액(totalAmountKrw, depositKrw) 명시가 필수입니다.',
          },
        };
      }

      if (intentMode === 'DRAFT') {
        return {
          success: true,
          toolId: rawToolName,
          status: 'AWAITING_APPROVAL',
          proposal: {
            proposalId: `prop_res_${Date.now()}`,
            proposalType: 'RESERVATION_CONFIRMATION',
            title: '신규 예약 확정 승인 요청',
            description: `고객: ${customerName}, 슬롯: ${slotId}, 예약금: ₩${depositKrw!.toLocaleString()}`,
            proposedValue: {
              slotId,
              customerId,
              customerName,
              customerPhone,
              serviceId,
              serviceName,
              depositKrw,
              totalAmountKrw,
              channelSource,
            },
          },
          logs: ['예약 확정 초안 생성 완료 (사장님 승인 대기 중)'],
        };
      }

      try {
        const res = await ReservationCanonicalService.createReservation({
          workspaceId: context.workspaceId,
          slotId,
          customerId,
          customerName,
          customerPhone,
          serviceId,
          serviceName,
          depositKrw,
          totalAmountKrw,
          channelSource,
        });

        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            bookingId: res.bookingId,
            slotId: res.slotId,
            customerName: res.customerName,
            status: res.status,
            depositKrw: res.depositKrw,
            confirmedAt: res.confirmedAt,
          },
          evidence: {
            bookingId: res.bookingId,
            proofId: res.proofId,
            evidenceId: res.evidenceId,
            slotId: res.slotId,
            verifiedAt: res.confirmedAt,
          },
          logs: [`예약 확정 완료 (BookingId: ${res.bookingId}, ProofId: ${res.proofId})`],
        };
      } catch (err: unknown) {
        const resErr = err instanceof ReservationError ? err : new ReservationError(String(err));
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: resErr.code,
            message: resErr.message,
          },
        };
      }
    }

    // 5. Reservation List (ANI-981 / Task B)
    if (rawToolName === 'reservation.list') {
      try {
        const statusArg = args.status ? String(args.status) as any : undefined;
        const startDate = args.startDate ? String(args.startDate) : (args.since ? String(args.since) : undefined);
        const endDate = args.endDate ? String(args.endDate) : (args.until ? String(args.until) : undefined);
        const limit = typeof args.limit === 'number' ? args.limit : undefined;

        const listRes = await ReservationCanonicalService.listReservations({
          workspaceId: context.workspaceId,
          status: statusArg,
          startDate,
          endDate,
          limit,
        }, context.readClient);

        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            reservations: listRes.reservations,
            count: listRes.count,
            empty: listRes.empty,
            message: listRes.empty ? '해당 기간에 등록된 예약 내역이 없습니다.' : undefined,
          },
          logs: [`예약 장부 실시간 조회 완료 (총 ${listRes.count}건)`],
        };
      } catch (err: unknown) {
        const resErr = err instanceof ReservationError ? err : new ReservationError(String(err));
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: resErr.code,
            message: resErr.message,
          },
        };
      }
    }

    if (rawToolName === 'interaction.list' && context.readClient) {
      const kind = args.kind ?? 'all';
      if (kind !== 'all' && kind !== 'comments' && kind !== 'dm') {
        return { success: false, toolId: rawToolName, status: 'FAILED', error: { code: 'MALFORMED_ARGUMENTS', message: '조회할 수신 기록의 종류를 확인해 주세요.' } };
      }
      try {
        const inbox = await loadAgentInbox({ client: context.readClient, workspaceId: context.workspaceId, kind,
          channel: typeof args.channel === 'string' ? args.channel : undefined,
          unreadOnly: args.unreadOnly === true || args.unreadOnly === 'true',
          limit: typeof args.limit === 'number' ? args.limit : undefined });
        return { success: true, toolId: rawToolName, status: 'COMPLETED', data: inbox,
          logs: [`저장된 댓글 ${inbox.reviews.length}건·DM ${inbox.dmThreads.length}건을 확인했어요.`] };
      } catch (error) {
        context.signal?.throwIfAborted();
        const unsupported = error instanceof Error && error.message === 'INBOX_CHANNEL_UNSUPPORTED';
        return { success: false, toolId: rawToolName, status: unsupported ? 'UNAVAILABLE' : 'FAILED',
          error: { code: unsupported ? 'INBOX_CHANNEL_UNSUPPORTED' : 'INBOX_READ_UNAVAILABLE',
            message: unsupported ? '이 채널의 수신 대화는 현재 연결되지 않았어요.' : '수신 기록의 최신 내용을 확인하지 못했어요. 다시 조회해 주세요.' } };
      }
    }

    // 5. Review & Comment List (from social_comments)
    if (rawToolName === 'review.list' || rawToolName === 'interaction.list') {
      try {
        const supabase = context.readClient ?? await createServerSupabaseClient();
        const limit = typeof args.limit === 'number' ? Math.min(Math.max(args.limit, 1), 50) : 10;
        const { data: rows, error } = await (supabase as any)
          .from('social_comments')
          .select('*')
          .eq('workspace_id', context.workspaceId)
          .order('comment_created_at', { ascending: false })
          .limit(limit);

        if (error) {
          return {
            success: false,
            toolId: rawToolName,
            status: 'FAILED',
            error: {
              code: 'QUERY_FAILED',
              message: `댓글 및 리뷰 목록 조회 실패: ${error.message}`,
            },
          };
        }

        if (!Array.isArray(rows)) {
          return {
            success: false,
            toolId: rawToolName,
            status: 'FAILED',
            error: {
              code: 'SOCIAL_COMMENTS_READ_FAILED',
              message: '댓글 및 리뷰 목록을 확인하지 못했어요.',
            },
          };
        }
        const reviews = rows.map((r: any) => ({
          id: r.id,
          channel: r.channel || 'instagram',
          authorName: r.author_handle || r.author_name || '방문 고객님',
          commentText: r.comment_text || '',
          status: r.status,
          createdAt: r.comment_created_at || r.created_at,
          permalink: r.permalink,
        }));

        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            reviews,
            count: reviews.length,
            empty: reviews.length === 0,
            message: reviews.length === 0 ? '등록된 고객 댓글 및 리뷰가 없습니다.' : undefined,
          },
          logs: [`소통함 댓글 및 리뷰 ${reviews.length}건 조회 완료`],
        };
      } catch (err: unknown) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'QUERY_EXCEPTION',
            message: err instanceof Error ? err.message : '댓글 목록 조회 중 오류 발생',
          },
        };
      }
    }

    // 6. Review Respond (review.respond)
    if (rawToolName === 'review.respond') {
      const reviewId = String(args.reviewId || args.targetId || '').trim();
      const responseText = String(args.responseText || args.replyText || args.message || '').trim();

      if (!reviewId || !responseText) {
        return {
          success: false,
          toolId: rawToolName,
          status: 'FAILED',
          error: {
            code: 'INVALID_ARGUMENTS',
            message: '답글 작성을 위한 reviewId와 responseText가 필요합니다.',
          },
        };
      }

      // Read comment info from DB if possible
      let channel: 'INSTAGRAM' | 'THREADS' = 'INSTAGRAM';
      let commentSnippet = '';
      try {
        const supabase = context.readClient ?? await createServerSupabaseClient();
        const { data: c } = await (supabase as any)
          .from('social_comments')
          .select('channel, comment_text')
          .eq('workspace_id', context.workspaceId)
          .eq('id', reviewId)
          .maybeSingle();
        if (c?.channel === 'threads') channel = 'THREADS';
        if (c?.comment_text) commentSnippet = c.comment_text.slice(0, 30);
      } catch {}

      if (intentMode === 'DRAFT') {
        return {
          success: true,
          toolId: rawToolName,
          status: 'AWAITING_APPROVAL',
          proposal: {
            proposalId: `prop_review_${Date.now()}`,
            proposalType: 'COMMENT_REPLY_APPROVAL',
            title: `${channel === 'THREADS' ? '스레드' : '인스타그램'} 댓글/리뷰 공식 답글 전송 승인 요청`,
            description: `원문: "${commentSnippet}..." ➔ 답글: "${responseText.slice(0, 50)}..."`,
            proposedValue: { targetId: reviewId, replyText: responseText, channel },
          },
          logs: ['고객 리뷰 답글 초안 작성 완료 (사장님 승인 대기 중)'],
        };
      }

      const replyRes = await InteractionExecutor.replyToComment({
        signal: context.signal,
        workspaceId: context.workspaceId,
        channel,
        targetId: reviewId,
        replyText: responseText,
        intentMode: 'EXECUTE',
      });

      if (replyRes.success) {
        return {
          success: true,
          toolId: rawToolName,
          status: 'COMPLETED',
          data: {
            channel,
            reviewId,
            providerReference: replyRes.providerReference,
            statusMessage: replyRes.statusMessage,
          },
          logs: [`리뷰 공식 답글 전송 완료 (Ref: ${replyRes.providerReference})`],
        };
      }

      return {
        success: false,
        toolId: rawToolName,
        status: replyRes.errorCode === 'RESULT_UNKNOWN' ? 'RESULT_UNKNOWN' : 'FAILED',
        error: {
          code: replyRes.errorCode || 'RESPOND_FAILED',
          message: replyRes.statusMessage || '리뷰 답글 전송 실패',
        },
      };
    }

    return {
      success: false,
      toolId: rawToolName,
      status: 'NOT_IMPLEMENTED',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: `고객 도메인 도구 [${rawToolName}]는 아직 실제 서비스와 연결되지 않았습니다.`,
      },
    };
  },
};
