export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceTrialProgress, completeTrialMilestone } from '@/lib/trial/trial-journey';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const progress = await getWorkspaceTrialProgress(workspaceId);
    return NextResponse.json({ success: true, ...progress });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '조회 실패' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const { dayStage, evidenceData } = body;

    if (dayStage === undefined || dayStage === null) {
      return NextResponse.json({ error: 'dayStage가 필요합니다.' }, { status: 400 });
    }

    const ok = await completeTrialMilestone(workspaceId, Number(dayStage), evidenceData);
    if (!ok) {
      return NextResponse.json({ error: '마일스톤 갱신 실패' }, { status: 500 });
    }

    const progress = await getWorkspaceTrialProgress(workspaceId);
    return NextResponse.json({ success: true, ...progress });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '처리 실패' }, { status: 500 });
  }
}
