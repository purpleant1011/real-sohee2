export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    const adminSupabase = createAdminSupabaseClient();

    const { data: members } = await adminSupabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1);

    const workspaceId = members?.[0]?.workspace_id;
    if (!workspaceId) {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 });
    }

    const body = await req.json();
    const { title, content, tags, instagramHandle, category } = body;

    const postTitle = title || '소희 맞춤 뷰티 케어 가이드';
    const postBody = content || `${postTitle}\n\n사장님 매장 맞춤 1:1 케어 안내입니다.`;
    const postTags = tags || ['소희AI', '매장홍보', '맞춤케어'];

    // 1. content_items에 시안 정식 저장 (Server-Owned Mutation)
    const { data: insertedItem, error: contentErr } = await (adminSupabase as any)
      .from('content_items')
      .insert({
        workspace_id: workspaceId,
        channel: 'instagram',
        title: postTitle,
        status: 'approved',
        created_by: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (contentErr || !insertedItem?.id) {
      console.error('[first-wow-approve] content_items insert failed:', contentErr);
      return NextResponse.json(
        { error: `콘텐츠 시안 원장 저장 실패: ${contentErr?.message || 'DB 에러'}` },
        { status: 500 }
      );
    }

    // 2. content_versions에 본문 및 메타데이터 정본 저장
    const fingerprint = createHash('sha256').update(`${insertedItem.id}:1:${postBody}`).digest('hex');

    const { data: insertedVersion, error: versionErr } = await (adminSupabase as any)
      .from('content_versions')
      .insert({
        workspace_id: workspaceId,
        content_id: insertedItem.id,
        version_number: 1,
        caption: postBody,
        hashtags: postTags,
        disclosure: '소희 AI 맞춤 마케팅',
        rights: { commercial_use: true, rights_holder: 'workspace' },
        generation_evidence: {
          model: 'gemini-2.5',
          category: category || 'general',
          approved_at: new Date().toISOString()
        },
        fingerprint,
        created_by: user.id,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (versionErr) {
      console.error('[first-wow-approve] content_versions insert failed:', versionErr);
      return NextResponse.json(
        { error: `콘텐츠 버전 저장 실패: ${versionErr.message}` },
        { status: 500 }
      );
    }

    if (insertedVersion?.id) {
      await (adminSupabase as any)
        .from('content_items')
        .update({ current_version_id: insertedVersion.id })
        .eq('id', insertedItem.id);
    }

    // 3. 채널 연동 상태 확인 (channel_connections)
    const { data: igConn } = await (adminSupabase as any)
      .from('channel_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .or('channel.eq.INSTAGRAM,channel.eq.instagram')
      .maybeSingle();

    // False VERIFIED 방지 (ANI-750): connection status만으로 VERIFIED 승격 절대 금지.
    // 온보딩 시안 승인은 실제 provider write 가 아니다. 외부 실행은 일어나지 않았으므로
    // 상태를 'prepared'로 두고, readback 성공 시에만 상위 상태로 올린다.
    const receiptStatus = 'QUEUED';
    const verificationMethod = 'ONBOARDING_DRAFT_QUEUED';
    const receiptKind = 'FIRST_WOW_APPROVAL';
    const actionReqId = crypto.randomUUID();

    // 4. canonical external_action_requests & receipts 생성 (Fail-Closed 영속화)
    //
    // ANI-1762 후속: 이 insert 는 레거시 컬럼(action_type/target_channel)만 채우고 정본 NOT NULL
    // 컬럼(channel/action_kind/target_external_id/target_label/exact_payload/idempotency_key)을
    // 비워 두어 실 DB 에서 항상 실패했다(#1922 는 컬럼만 추가했고 payload 는 그대로였다).
    // 정본 CHECK 제약에 맞는 값만 넣는다. 상태 'QUEUED' 는 정본 status 허용 목록에 없으므로
    // 외부 실행 전 단계를 뜻하는 'prepared' 를 쓴다.
    const connectedAccountId =
      (igConn as any)?.external_account_id ?? (igConn as any)?.account_id ?? null;
    const connectedLabel = (igConn as any)?.account_label ?? null;
    const requestedHandle = typeof instagramHandle === 'string' ? instagramHandle.trim().replace(/^@+/, '') : '';
    // 실제 외부 대상이 확인된 경우에만 요청 원장을 만든다. 없으면 지어내지 않는다.
    const targetExternalId = connectedAccountId
      || (requestedHandle ? `instagram:@${requestedHandle}` : null);
    const targetLabel = connectedLabel
      || (requestedHandle ? `@${requestedHandle}` : null);

    let externalActionState: 'prepared' | 'connection_required' = 'connection_required';

    if (targetExternalId && targetLabel) {
      const { error: actionReqErr } = await (adminSupabase as any).from('external_action_requests').insert({
        id: actionReqId,
        workspace_id: workspaceId,
        channel: 'instagram',
        action_kind: 'feed_publish',
        target_external_id: targetExternalId.slice(0, 255),
        target_label: targetLabel.slice(0, 255),
        exact_payload: {
          source: 'first_wow_approval',
          content_item_id: insertedItem.id,
          content_version_id: insertedVersion?.id ?? null,
          title: postTitle,
          tags: postTags,
        },
        content_version_id: insertedVersion?.id ?? null,
        idempotency_key: `first_wow:${insertedItem.id}`.slice(0, 200),
        status: 'prepared',
        created_by: user.id,
      });

      if (actionReqErr) {
        console.error('[first-wow-approve] external_action_requests insert failed:', actionReqErr);
        return NextResponse.json(
          { error: `발행 요청 원장 저장 실패: ${actionReqErr.message}` },
          { status: 500 }
        );
      }
      externalActionState = 'prepared';
    } else {
      // 채널도 핸들도 없으면 외부 실행 대상이 없다. 시안 승인(content_items/versions)만 영속화하고
      // 외부 요청 원장에는 아무것도 쓰지 않는다. 성공을 가장하지 않도록 상태를 함께 돌려준다.
      console.info('[first-wow-approve] no external target yet; draft approved without action request');
    }

    const { error: receiptErr } = externalActionState === 'prepared'
      ? await (adminSupabase as any).from('external_action_receipts').insert({
          workspace_id: workspaceId,
          action_request_id: actionReqId,
          receipt_kind: 'submission',
          provider_reference: insertedItem.id,
          result_url: null,
          observed_payload: {
            channel: 'instagram',
            title: postTitle,
            status: receiptStatus,
            verification_method: verificationMethod,
            tags: postTags,
            content_item_id: insertedItem.id,
            content_version_id: insertedVersion?.id
          },
          recorded_by: user.id,
          recorded_at: new Date().toISOString()
        })
      : { error: null };

    if (receiptErr) {
      console.error('[first-wow-approve] external_action_receipts insert failed:', receiptErr);
      return NextResponse.json(
        { error: `발행 영수증 원장 저장 실패: ${receiptErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      // 'prepared' = 외부 실행 전. 'connection_required' = 외부 대상이 아직 없어 요청 원장 미생성.
      executionState: externalActionState,
      externalAction: externalActionState,
      receipt: externalActionState === 'prepared'
        ? {
            actionRequestId: actionReqId,
            channel: 'instagram',
            status: 'prepared',
            receiptKind,
            verificationMethod,
            contentItemId: insertedItem.id
          }
        : null,
      message: externalActionState === 'prepared'
        ? '소희 첫 맞춤 시안 승인 완료 · 발행 요청을 준비했어요 (아직 게시되지 않았어요)'
        : '소희 첫 맞춤 시안 승인 완료 · 채널을 연결하면 발행을 준비할 수 있어요'
    });

  } catch (err: any) {
    console.error('[first-wow-approve] Server Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
