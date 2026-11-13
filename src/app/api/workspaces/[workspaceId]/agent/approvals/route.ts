export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { AgentApprovalService } from '@/features/agent-session/agent-approval-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Cross-tenant guard: refuse a non-member before listing agent approvals.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId') || undefined;
  const statusParam = searchParams.get('status') as any;

  try {
    const approvals = await AgentApprovalService.getApprovals(workspaceId, {
      sessionId,
      status: statusParam || undefined,
    });

    return NextResponse.json(
      { success: true, approvals },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    console.error('[Approvals API] GET Error:', err);
    return NextResponse.json(
      {
        success: false,
        status: 'FAILED',
        error: { code: 'FETCH_APPROVAlS_FAILED', message: '승인 목록을 조회하지 못했습니다.' },
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Approval can resume external execution, so workspace membership alone is insufficient.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;
  if (auth.role !== 'owner' && auth.role !== 'manager') {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: '실행 승인은 매장 대표 또는 관리자만 처리할 수 있어요.' } },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { proposalId, action, rejectionReason, expectedVersion } = body;

    if (!proposalId) {
      return NextResponse.json(
        {
          success: false,
          status: 'FAILED',
          error: { code: 'INVALID_ARGUMENTS', message: 'proposalId가 누락되었습니다.' },
        },
        { status: 400 }
      );
    }

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json(
        {
          success: false,
          status: 'FAILED',
          error: { code: 'INVALID_ACTION', message: 'action은 APPROVE 또는 REJECT 이어야 합니다.' },
        },
        { status: 400 }
      );
    }

    const result = await AgentApprovalService.resolveApproval({
      workspaceId,
      proposalId,
      action,
      actorId: auth.userId,
      rejectionReason,
      expectedVersion,
    });

    if (!result.success) {
      const statusCode =
        result.error?.code === 'NOT_FOUND'
          ? 404
          : result.error?.code === 'VERSION_CONFLICT'
          ? 409
          : result.error?.code === 'APPROVAL_EXPIRED'
          ? 410
          : 400;

      return NextResponse.json(
        {
          success: false,
          status: 'FAILED',
          error: result.error,
          approval: result.approval,
        },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      {
        success: true,
        status: result.status,
        approval: result.approval,
        executionResult: result.executionResult,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[Approvals API] POST Error:', err);
    return NextResponse.json(
      {
        success: false,
        status: 'FAILED',
        error: { code: 'RESOLVE_APPROVAL_FAILED', message: errMsg || '승인 처리에 실패했습니다.' },
      },
      { status: 500 }
    );
  }
}
