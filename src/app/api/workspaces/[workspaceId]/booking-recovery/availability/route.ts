export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import {
  availabilitySlotInputSchema,
  createOwnerConfirmedSlot,
  SlotRequestError,
} from '@/features/booking-recovery/availability';
import { isRecoveryWriteEnabled } from '@/features/booking-recovery/production';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' });
    if (isResponse(auth)) return auth;

    const admin = auth.admin;
    const nowIso = new Date().toISOString();

    // 1. Fetch active catalog services
    const { data: services, error: srvErr } = await admin
      .from('workspace_products_services')
      .select('id, workspace_id, name, price, active, updated_at, duration_minutes')
      .eq('workspace_id', auth.workspaceId)
      .eq('active', true)
      .order('name', { ascending: true });

    if (srvErr) {
      return NextResponse.json(
        { error: `카탈로그 서비스 조회 실패: ${srvErr.message}` },
        { status: 500, headers: NO_STORE }
      );
    }

    // 2. Fetch currently available slots (validUntil > now and status = AVAILABLE)
    const { data: slots, error: slotErr } = await admin
      .from('booking_recovery_slots')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .eq('status', 'AVAILABLE')
      .gt('valid_until', nowIso)
      .gt('starts_at', nowIso)
      .order('starts_at', { ascending: true });

    if (slotErr) {
      return NextResponse.json(
        { error: `가용 슬롯 조회 실패: ${slotErr.message}` },
        { status: 500, headers: NO_STORE }
      );
    }

    return NextResponse.json(
      {
        services: (services || []).map((s: any) => ({
          id: s.id,
          workspaceId: s.workspace_id,
          name: s.name,
          price: s.price,
          active: s.active,
          updatedAt: s.updated_at,
          // Null means the owner has not set a duration yet; the form then refuses to submit (ANI-1609).
          durationMinutes: s.duration_minutes ?? null,
        })),
        slots: (slots || []).map((sl: any) => ({
          id: sl.id,
          workspaceId: sl.workspace_id,
          serviceId: sl.service_id,
          startsAt: sl.starts_at,
          endsAt: sl.ends_at,
          timezone: sl.timezone,
          confirmedBy: sl.confirmed_by,
          confirmedAt: sl.confirmed_at,
          validUntil: sl.valid_until,
          version: sl.version,
          status: sl.status,
        })),
      },
      { headers: NO_STORE }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || '가용성 정보 조회 중 오류가 발생했습니다.' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  try {
    if (!isRecoveryWriteEnabled(workspaceId)) {
      return NextResponse.json(
        { error: '예약 문의 회수 기능이 현재 비활성화되어 있습니다.' },
        { status: 503, headers: NO_STORE }
      );
    }

    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' });
    if (isResponse(auth)) return auth;

    const body = await request.json().catch(() => null);
    const parsed = availabilitySlotInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '올바른 예약 가능 시간 정보를 입력해 주세요.' },
        { status: 422, headers: NO_STORE }
      );
    }

    // Verify service belongs to this workspace and is active
    const admin = auth.admin;
    const { data: service, error: srvErr } = await admin
      .from('workspace_products_services')
      .select('id, active, price')
      .eq('workspace_id', auth.workspaceId)
      .eq('id', parsed.data.serviceId)
      .maybeSingle();

    if (srvErr || !service) {
      return NextResponse.json(
        { error: '존재하지 않거나 접근할 수 없는 등록된 서비스입니다.' },
        { status: 404, headers: NO_STORE }
      );
    }

    if (!service.active) {
      return NextResponse.json(
        { error: '비활성화된 서비스에는 예약 가능 시간을 등록할 수 없습니다.', code: 'SLOT_SERVICE_INACTIVE' },
        { status: 400, headers: NO_STORE }
      );
    }

    const actorRole: 'owner' | 'manager' = auth.role === 'owner' ? 'owner' : 'manager';

    const slot = await createOwnerConfirmedSlot(admin, {
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      role: actorRole,
    }, parsed.data);

    return NextResponse.json({ slot }, { status: 201, headers: NO_STORE });
  } catch (error: any) {
    // Anything the owner can fix keeps its own status and its own words. Everything else is a server
    // fault and must stay an opaque 500 — but "잠시 후 다시 시도" must not swallow a fixable mistake.
    if (error instanceof SlotRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE }
      );
    }
    console.error('[booking-recovery/availability] unexpected slot failure', error);
    return NextResponse.json(
      { error: '예약 가능 시간 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: NO_STORE }
    );
  }
}
