export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { BookingRecoveryRepository } from '@/features/booking-recovery/repository';
import { BookingRecoveryService } from '@/features/booking-recovery/service';
import {
  isRecoveryEnabled,
  isRecoveryWriteEnabled,
  toSafeErrorResponse,
  createProductionBookingRecoveryService,
} from '@/features/booking-recovery/production';

const NO_STORE = { 'Cache-Control': 'no-store' };

const openCaseBodySchema = z
  .object({
    sourceInboundMessageId: z.string().uuid({
      message: 'sourceInboundMessageId must be a valid DB UUID.',
    }),
  })
  .strict();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' });
    if (isResponse(auth)) return auth;

    // Feature gate check: read operations allowed even during kill switch as long as enabled
    if (!isRecoveryEnabled(workspaceId)) {
      return NextResponse.json(
        { error: '예약 문의 회수 기능이 비활성화되어 있습니다.' },
        { status: 403, headers: NO_STORE }
      );
    }

    const admin = auth.admin;
    const service = createProductionBookingRecoveryService(admin);

    const views = await service.listCaseViews(workspaceId);
    return NextResponse.json({ workspaceId: auth.workspaceId, cases: views, openAllowed: isRecoveryWriteEnabled(auth.workspaceId) }, { headers: NO_STORE });
  } catch (error: any) {
    const safe = toSafeErrorResponse(error);
    return NextResponse.json(safe, { status: 500, headers: NO_STORE });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
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
    const parsed = openCaseBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '잘못된 요청 형식입니다.' },
        { status: 422, headers: NO_STORE }
      );
    }

    const admin = auth.admin;
    const service = createProductionBookingRecoveryService(admin);

    const actorRole: 'owner' | 'manager' = auth.role === 'owner' ? 'owner' : 'manager';
    const result = await service.openCase(
      {
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        role: actorRole,
      },
      parsed.data.sourceInboundMessageId
    );

    if (!result.ok) {
      const status = result.code === 'FORBIDDEN' ? 403 : result.code === 'NOT_FOUND' ? 404 : 500;
      return NextResponse.json(result, { status, headers: NO_STORE });
    }

    return NextResponse.json({ case: result.value }, { status: 201, headers: NO_STORE });
  } catch (error: any) {
    const safe = toSafeErrorResponse(error);
    return NextResponse.json(safe, { status: 500, headers: NO_STORE });
  }
}
