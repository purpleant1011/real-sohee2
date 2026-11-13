export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { naverAutomationBlocked } from '@/features/naver-publish/automation-policy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Cross-tenant guard: channel credentials belong to one workspace and must not be
  // readable by anyone who merely knows the workspaceId.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;

  // V1.2: 소희는 네이버 계정 정보를 보관하지 않는다. 수동 게시 전용 상태만 응답한다.
  return NextResponse.json(
    { workspaceId, autoPostEnabled: false, status: 'MANUAL_ONLY' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Cross-tenant guard: refuse a non-member before overwriting channel credentials.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;

  // V1.2 G0-02: POST/PUT/DELETE 중 자격증명 저장 금지 -> 'login'
  return naverAutomationBlocked('login');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;
  return naverAutomationBlocked('login');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;
  return naverAutomationBlocked('login');
}
