export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ProofChainService } from '@/lib/evidence/proof-chain-service';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    // 1. Session Auth (401)
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    // 2. Tenant Membership Authorization (403)
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' }, { status: 403 });
    }

    // 3. Return evidence only after authorization passes
    let items = ProofChainService.listEvidenceByWorkspace(workspaceId);
    if (items.length === 0) {
      items = await ProofChainService.listEvidenceByWorkspaceFromDB(workspaceId);
    }

    return NextResponse.json({
      workspaceId,
      items,
      count: items.length,
      asOf: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to list evidence' }, { status: 500 });
  }
}
