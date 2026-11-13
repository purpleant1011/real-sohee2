export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { SameTruthSnapshotService } from '@/lib/runtime-truth/same-truth-snapshot-service';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> | { workspaceId: string } }
) {
  const resolvedParams = await params;
  const workspaceId = resolvedParams?.workspaceId;

  if (!workspaceId) {
    return NextResponse.json(
      { error: 'WORKSPACE_ID_REQUIRED', message: 'workspaceId path parameter is required' },
      { status: 400 }
    );
  }

  // 1. Authorization Guard
  try {
    const auth = await requireWorkspaceMembership(workspaceId);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error || 'AUTH_REQUIRED', message: auth.message || '인증이 필요합니다.' },
        { status: auth.status || 401 }
      );
    }
  } catch (err: any) {
    if (err.status || err.name === 'AppError') {
      return NextResponse.json(
        { error: err.message || 'AUTH_FAILED' },
        { status: err.status || 401 }
      );
    }
  }

  // 2. Canonical Same Truth Snapshot Resolution
  try {
    const snapshot = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);

    return NextResponse.json(snapshot, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
        'X-Same-Truth-Version': String(snapshot.snapshotVersion),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'RUNTIME_STATE_FETCH_FAILED',
        message: err.message || 'Failed to fetch canonical runtime snapshot',
      },
      { status: 500 }
    );
  }
}
