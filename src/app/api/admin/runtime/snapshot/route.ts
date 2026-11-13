export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { SameTruthSnapshotService } from '@/lib/runtime-truth/same-truth-snapshot-service';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');

  if (!workspaceId) {
    return NextResponse.json(
      { error: 'WORKSPACE_ID_REQUIRED', message: 'workspaceId query parameter is required' },
      { status: 400 }
    );
  }

  // 1. Operator Permission Guard
  try {
    await requireOperatorAnyScope('agent.read');
  } catch (err: any) {
    return NextResponse.json(
      { error: err.code || 'PERMISSION_DENIED', message: err.message || 'Operator permission required' },
      { status: 403 }
    );
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
        error: 'ADMIN_SNAPSHOT_FETCH_FAILED',
        message: err.message || 'Failed to fetch canonical admin snapshot',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // 1. Operator Permission Guard
  try {
    await requireOperatorAnyScope('agent.read');
  } catch (err: any) {
    return NextResponse.json(
      { error: err.code || 'PERMISSION_DENIED', message: err.message || 'Operator permission required' },
      { status: 403 }
    );
  }

  // 2. Automated Same Truth Diff Comparison
  try {
    const body = await request.json();
    const { serviceSnapshot, adminSnapshot, workspaceId } = body;

    if (serviceSnapshot && adminSnapshot) {
      const comparison = SameTruthSnapshotService.compareSnapshots(serviceSnapshot, adminSnapshot);
      return NextResponse.json(comparison, { status: 200 });
    }

    if (workspaceId && serviceSnapshot) {
      const canonicalAdmin = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);
      const comparison = SameTruthSnapshotService.compareSnapshots(serviceSnapshot, canonicalAdmin);
      return NextResponse.json(comparison, { status: 200 });
    }

    return NextResponse.json(
      {
        error: 'INVALID_PAYLOAD',
        message: 'Expected serviceSnapshot and adminSnapshot or workspaceId in body',
      },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'DIFF_COMPARISON_FAILED',
        message: err.message || 'Failed to compare snapshots',
      },
      { status: 500 }
    );
  }
}
