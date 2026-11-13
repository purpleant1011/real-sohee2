import { NextRequest, NextResponse } from 'next/server';
import { AgentSessionService } from '@/features/agent-session/agent-session-service';
import { CanonicalSurfaceContext } from '@/features/agent-session/types';
import { verifyWorkspaceActor, handleWorkspaceActorError, redactErrorPayload } from '@/lib/auth/workspace-actor-guard';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  try {
    await verifyWorkspaceActor(request, workspaceId);
  } catch (err: unknown) {
    const authRes = handleWorkspaceActorError(err);
    if (authRes) return authRes;
    return NextResponse.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    // Resolve/create a default session
    const res = await AgentSessionService.resolveOrCreateSession({ workspaceId });
    return NextResponse.json({
      success: true,
      session: res.session,
      isNewSession: res.isNewSession,
    });
  }

  const session = await AgentSessionService.getSession(workspaceId, sessionId);
  if (!session) {
    const res = await AgentSessionService.resolveOrCreateSession({
      workspaceId,
      sessionId,
    });
    return NextResponse.json({
      success: true,
      session: res.session,
      isNewSession: true,
    });
  }

  return NextResponse.json({
    success: true,
    session,
    isNewSession: false,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    await verifyWorkspaceActor(request, workspaceId, body);

    const {
      sessionId,
      threadId,
      surface,
      deviceChannel,
      expectedVersion,
      action = 'sync',
    } = body;

    if (action === 'update_surface' && sessionId && surface) {
      const result = await AgentSessionService.updateSurface({
        workspaceId,
        sessionId,
        surface: surface as CanonicalSurfaceContext,
        expectedVersion,
      });

      return NextResponse.json({
        success: true,
        session: result.session,
        mismatchDetected: result.mismatchDetected,
      });
    }

    // Default: resolve or create session
    const resolution = await AgentSessionService.resolveOrCreateSession({
      workspaceId,
      sessionId,
      threadId,
      surface: surface as CanonicalSurfaceContext,
      deviceChannel,
    });

    return NextResponse.json({
      success: true,
      session: resolution.session,
      isNewSession: resolution.isNewSession,
      reconnected: resolution.reconnected,
    });
  } catch (err: unknown) {
    const authRes = handleWorkspaceActorError(err);
    if (authRes) return authRes;

    const sanitizedError = redactErrorPayload(err);
    console.error('[AgentSessionRoute] Error:', sanitizedError);
    return NextResponse.json(
      {
        success: false,
        error: 'SESSION_RESOLUTION_FAILED',
        message: sanitizedError,
      },
      { status: 500 }
    );
  }
}
