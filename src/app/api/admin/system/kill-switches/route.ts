export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';

export async function GET() {
  try {
    await requireOperatorAnyScope('admin.read');
    const supabase = await createServerSupabaseClient();

    const { data: switches, error } = await (supabase as any)
      .from('kill_switches')
      .select('*')
      .order('engaged_at', { ascending: false });

    if (error || !Array.isArray(switches)) {
      return NextResponse.json({ success: false, error: '킬스위치 상태를 확인할 수 없습니다.' }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      switches: switches || []
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '조회 실패' }, { status: 403 });
  }
}

// Legacy direct toggles cannot bypass the preview → confirm → audit workflow.
export async function POST() {
  try {
    await requireOperatorAnyScope('admin.read');
    return NextResponse.json({ error: '안전 개입 화면에서 영향 확인과 사유 입력을 먼저 진행해 주세요.' }, { status: 410 });
  } catch {
    return NextResponse.json({ error: '운영자 권한이 필요합니다.' }, { status: 403 });
  }
}
