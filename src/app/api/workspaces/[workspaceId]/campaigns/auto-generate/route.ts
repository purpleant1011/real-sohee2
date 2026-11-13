export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    // 워크스페이스 소속 검증
    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: '워크스페이스 접근 권한이 없습니다.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const goal = body.goal || '매장 신규 고객 유입 및 주말 슬롯 마감';
    const targetAudience = body.targetAudience || '지역 상권 2040 여성 고객';
    const focusTheme = body.focusTheme || '시그니처 맞춤 케어 및 첫 방문 혜택';

    // 매장 프로필 조회
    const { data: profile } = await (supabase as any)
      .from('business_profiles')
      .select('business_name, summary')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const brandName = profile?.business_name || '우리 매장';
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Goal-Driven Content Plan 생성 (정본 스키마: status는 'draft' | 'approved' | 'cancelled': ANI-600)
    const planIdempotencyKey = `plan:${workspaceId}:${startDate}:${Date.now()}`;
    const { data: plan, error: planErr } = await (supabase as any)
      .from('content_plans')
      .insert({
        workspace_id: workspaceId,
        period_start: startDate,
        period_end: endDate,
        timezone: 'Asia/Seoul',
        goal: goal.slice(0, 500),
        generation_depth: 'balanced',
        catalog_version: 1,
        estimated_credits: 2100, // 350 SC * 6개 슬롯
        status: 'draft',
        version: 1,
        idempotency_key: planIdempotencyKey
      })
      .select('id')
      .single();

    if (planErr || !plan?.id) {
      console.error('[campaigns/auto-generate] Plan creation failed:', planErr);
      return NextResponse.json({ error: `캠페인 기획서 생성 실패: ${planErr?.message}` }, { status: 500 });
    }

    // 2. Insert Content Plan Entries
    const entriesData = [
      {
        workspace_id: workspaceId,
        plan_id: plan.id,
        channel: 'instagram',
        post_count: 2,
        images_per_post: 1
      },
      {
        workspace_id: workspaceId,
        plan_id: plan.id,
        channel: 'threads',
        post_count: 2,
        images_per_post: 0
      },
      {
        workspace_id: workspaceId,
        plan_id: plan.id,
        channel: 'naver_blog',
        post_count: 2,
        images_per_post: 3
      }
    ];

    const { error: entriesErr } = await (supabase as any)
      .from('content_plan_entries')
      .insert(entriesData);

    if (entriesErr) {
      console.error('[campaigns/auto-generate] Entries insert failed:', entriesErr);
      return NextResponse.json({ error: `캠페인 항목 등록 실패: ${entriesErr.message}` }, { status: 500 });
    }

    // 3. Generate initial scheduled content_items & content_versions (status: PENDING_APPROVAL)
    const contentSchedules = [
      {
        channel: 'INSTAGRAM',
        dayOffset: 1,
        title: `[Day 1 인스타 피드] ${brandName}의 대표 시그니처 소개`,
        body: `안녕하세요! ${brandName}입니다. 오늘 소희가 첫 번째로 소개해 드릴 특별한 대표 메뉴/서비스를 만나보세요. 방문 전 예약 시 특별 혜택을 드립니다! ✨ #상권맛집 #지역추천 #${brandName.replace(/\s+/g, '')}`
      },
      {
        channel: 'THREADS',
        dayOffset: 2,
        title: `[Day 2 스레드 소통] ${brandName} 사장님이 직접 전하는 매장 이용 꿀팁`,
        body: `많은 분들이 궁금해하시는 매장 이용 및 관리법! 오늘 소희가 핵심만 정리해 드려요. 저장해두고 꼭 확인해 보세요 🧵`
      },
      {
        channel: 'NAVER_BLOG',
        dayOffset: 3,
        title: `[Day 3 네이버 블로그] ${brandName} 방문 가이드 및 상세 리뷰`,
        body: `위치부터 주차 안내, 대표 메뉴/서비스 상세 가격표와 실제 고객 후기까지 한눈에 확인하는 공식 방문 가이드입니다.`
      },
      {
        channel: 'INSTAGRAM',
        dayOffset: 5,
        title: `[Day 5 인스타 릴스/피드] 주말 한정 타겟 프로모션`,
        body: `이번 주말 잔여 슬롯 긴급 오픈! 지금 예약하시면 웰컴 서비스 증정 이벤트 진행 중입니다. 프로필 링크를 확인해주세요! 🎁`
      },
      {
        channel: 'NAVER_BLOG',
        dayOffset: 7,
        title: `[Day 7 네이버 블로그] 1주차 성과 감사 및 다음 주 예고`,
        body: `한 주 동안 많은 사랑 감사드립니다. 다음 주에는 더 새로운 이벤트와 유익한 정보로 찾아뵙겠습니다!`
      }
    ];

    for (const item of contentSchedules) {
      const { data: cItem, error: itemErr } = await (supabase as any)
        .from('content_items')
        .insert({
          workspace_id: workspaceId,
          channel: item.channel,
          title: item.title,
          status: 'PENDING_APPROVAL',
          created_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (itemErr || !cItem?.id) {
        console.error('[campaigns/auto-generate] Content item insert failed:', itemErr);
        return NextResponse.json({ error: `콘텐츠 스케줄 생성 실패: ${itemErr?.message}` }, { status: 500 });
      }

      const { data: cVer, error: verErr } = await (supabase as any)
        .from('content_versions')
        .insert({
          workspace_id: workspaceId,
          content_id: cItem.id,
          version_number: 1,
          caption: item.body,
          hashtags: ['소희AI', '매장홍보', brandName.replace(/\s+/g, '')],
          disclosure: '소희 AI 자율 마케팅 주간 캠페인',
          rights: { commercial_use: true, rights_holder: 'workspace' },
          generation_evidence: {
            model: 'gemini-2.5',
            goal,
            day_offset: item.dayOffset
          },
          fingerprint: `fp:${cItem.id}:v1`,
          created_by: user.id,
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (!verErr && cVer?.id) {
        await (supabase as any)
          .from('content_items')
          .update({ current_version_id: cVer.id })
          .eq('id', cItem.id);
      }
    }

    // 4. Record automation execution in automation_rules and automation_runs (ANI-600)
    let ruleId: string | null = null;
    const { data: existingRule } = await (supabase as any)
      .from('automation_rules')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'WEEKLY_GOAL_CAMPAIGN')
      .maybeSingle();

    if (existingRule?.id) {
      ruleId = existingRule.id;
    } else {
      const { data: newRule } = await (supabase as any)
        .from('automation_rules')
        .insert({
          workspace_id: workspaceId,
          kind: 'WEEKLY_GOAL_CAMPAIGN',
          active: true,
          approval_required: true,
          configuration: { goal, targetAudience, focusTheme },
          configuration_version: 1,
          timezone: 'Asia/Seoul',
          created_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      ruleId = newRule?.id || null;
    }

    if (ruleId) {
      await (supabase as any).from('automation_runs').insert({
        workspace_id: workspaceId,
        rule_id: ruleId,
        status: 'SUCCESS',
        input_summary: { goal, targetAudience, focusTheme, startDate, endDate },
        output_summary: { plan_id: plan.id, items_count: contentSchedules.length },
        created_at: new Date().toISOString(),
        finished_at: new Date().toISOString()
      }).catch((e: any) => console.warn('[campaigns/auto-generate] automation_runs record notice:', e));
    }

    return NextResponse.json({
      success: true,
      planId: plan.id,
      status: 'draft',
      entriesCreated: entriesData.length,
      itemsScheduled: contentSchedules.length,
      message: '7일 주간 자율 캠페인 기획안 및 시안 5건이 생성되었습니다. 사장님 승인 후 순차 발행됩니다.'
    });

  } catch (err: any) {
    console.error('[campaigns/auto-generate] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
