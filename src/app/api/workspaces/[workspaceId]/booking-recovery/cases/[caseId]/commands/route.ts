export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { BookingRecoveryRepository } from '@/features/booking-recovery/repository';
import { BookingRecoveryService } from '@/features/booking-recovery/service';
import {
  isRecoveryWriteEnabled,
  toSafeErrorResponse,
  createProductionBookingRecoveryService,
} from '@/features/booking-recovery/production';
import {
  recoveryCommandSchema,
  RecoveryActor,
  RecoveryResult,
  RecoveryView,
} from '@/features/booking-recovery/contracts';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; caseId: string }> }
) {
  const { workspaceId, caseId } = await params;
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' });
    if (isResponse(auth)) return auth;

    if (!isRecoveryWriteEnabled(workspaceId)) {
      return NextResponse.json(
        { error: '예약 문의 회수 쓰기 기능이 현재 비활성화되어 있습니다.' },
        { status: 403, headers: NO_STORE }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = recoveryCommandSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '잘못된 명령 요청 형식입니다.' },
        { status: 422, headers: NO_STORE }
      );
    }

    const cmd = parsed.data;
    const admin = auth.admin;
    const repository = new BookingRecoveryRepository(admin);
    const service = createProductionBookingRecoveryService(admin);

    const actorRole: 'owner' | 'manager' = auth.role === 'owner' ? 'owner' : 'manager';
    const actor: RecoveryActor = {
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      role: actorRole,
    };

    let result: RecoveryResult<RecoveryView>;

    switch (cmd.kind) {
      case 'prepare_reply':
        result = await service.prepareReply(actor, {
          caseId,
          expectedVersion: cmd.expectedVersion,
          slotId: cmd.slotId,
        });
        break;

      case 'approve_send':
        result = await service.approveSend(actor, {
          caseId,
          expectedVersion: cmd.expectedVersion,
          fingerprint: cmd.fingerprint,
        });
        break;

      case 'confirm_acceptance':
        result = await service.confirmAcceptance(actor, {
          caseId,
          expectedVersion: cmd.expectedVersion,
          inboundMessageId: cmd.inboundMessageId,
          slotId: cmd.slotId,
        });
        break;

      case 'approve_booking':
        result = await service.approveBooking(actor, {
          caseId,
          expectedVersion: cmd.expectedVersion,
          fingerprint: cmd.fingerprint,
        });
        break;

      case 'reattest_schedule':
        result = await service.reattestSchedule(actor, {
          caseId,
          expectedVersion: cmd.expectedVersion,
          slotId: cmd.slotId,
        });
        break;

      case 'reject':
        const rejectedCase = await repository.transitionCase(actor, {
          caseId,
          expectedVersion: cmd.expectedVersion,
          nextStage: 'DECLINED',
          stepKind: 'REJECT',
          fingerprint: '0'.repeat(64),
          idempotencyKey: `reject:${caseId}:${cmd.expectedVersion}`,
        });
        const proposal = await repository.getLatestProposal(workspaceId, caseId);
        const { createRecoveryView } = await import('@/features/booking-recovery/read-model');
        result = {
          ok: true,
          value: createRecoveryView({ caseItem: rejectedCase, proposal }),
        };
        break;

      default:
        return NextResponse.json(
          { error: '지원하지 않는 명령입니다.' },
          { status: 400, headers: NO_STORE }
        );
    }

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        VERSION_CONFLICT: 409,
        CONTEXT_REQUIRED: 422,
        SLOT_CONFLICT: 409,
        POLICY_BLOCKED: 403,
      };
      const status = statusMap[result.code] || 500;
      return NextResponse.json(result, { status, headers: NO_STORE });
    }

    return NextResponse.json({ view: result.value }, { headers: NO_STORE });
  } catch (error: any) {
    const safe = toSafeErrorResponse(error);
    return NextResponse.json(safe, { status: 500, headers: NO_STORE });
  }
}
