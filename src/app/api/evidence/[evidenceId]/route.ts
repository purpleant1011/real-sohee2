export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ProofChainService } from '@/lib/evidence/proof-chain-service';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ evidenceId: string }> }
) {
  try {
    const { evidenceId } = await params;
    if (!evidenceId) {
      return NextResponse.json({ error: 'evidenceId is required' }, { status: 400 });
    }

    // 1. Session Auth (401)
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    // 2. Resolve evidence from memory or DB
    let evidence = ProofChainService.getEvidence(evidenceId);
    if (!evidence) {
      evidence = (await ProofChainService.restoreFromDB(evidenceId)) || undefined;
    }
    if (!evidence) {
      return NextResponse.json(
        {
          error: `Evidence not found for id: ${evidenceId}`,
          evidenceId,
          status: 'NOT_FOUND',
        },
        { status: 404 }
      );
    }

    // 3. Tenant Membership Authorization (403)
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', evidence.workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: '해당 증거 레코드에 대한 접근 권한이 없습니다.' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      evidence,
      asOf: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to retrieve evidence' }, { status: 500 });
  }
}
