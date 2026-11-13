import { NextResponse } from 'next/server';
import { AutonomousOutcomeRehearsalEngine } from '@/lib/outcome-os/release/autonomous-outcome-rehearsal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = body.workspaceId || 'ws-canonical-01';

    const rehearsal = new AutonomousOutcomeRehearsalEngine();
    const result = await rehearsal.executeRehearsal({
      workspaceId,
      ownerSessionActive: false,
      goalId: 'goal_autumn_campaign',
      envelopeId: 'env_bounded_a3_01',
      mockMcpOutcome: {
        externalPostId: `meta_live_${Date.now()}`,
        permalink: `https://instagram.com/p/meta_live_${Date.now()}`,
        publishedText: '매장 대표 가을 시그니처 특별 프로모션',
      },
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Rehearsal Failed' },
      { status: 500 }
    );
  }
}
