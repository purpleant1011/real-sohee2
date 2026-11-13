export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { BookingRecoveryRepository } from '@/features/booking-recovery/repository';
import { BookingRecoveryService } from '@/features/booking-recovery/service';
import {
  isRecoveryEnabled,
  toSafeErrorResponse,
} from '@/features/booking-recovery/production';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; caseId: string }> }
) {
  const { workspaceId, caseId } = await params;
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' });
    if (isResponse(auth)) return auth;

    // Feature gate check: read operations allowed even during kill switch
    if (!isRecoveryEnabled(workspaceId)) {
      return NextResponse.json(
        { error: '예약 문의 회수 기능이 비활성화되어 있습니다.' },
        { status: 403, headers: NO_STORE }
      );
    }

    const admin = auth.admin;
    const repository = new BookingRecoveryRepository(admin);
    const service = new BookingRecoveryService(repository, admin);

    const view = await service.getCaseView(workspaceId, caseId);
    if (!view) {
      return NextResponse.json(
        { error: '요청하신 회수 케이스를 찾을 수 없습니다.' },
        { status: 404, headers: NO_STORE }
      );
    }

    return NextResponse.json({ case: view }, { headers: NO_STORE });
  } catch (error: any) {
    const safe = toSafeErrorResponse(error);
    return NextResponse.json(safe, { status: 500, headers: NO_STORE });
  }
}
