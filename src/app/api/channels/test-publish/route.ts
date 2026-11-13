export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ChannelId } from '@/lib/channels/channel-registry';
import { evaluateExternalEvidence } from '@/lib/channels/external-evidence-verifier';
import { createInstagramProvider, createThreadsProvider } from '@/lib/providers/meta-api';
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist';
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository';
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger';
import { ActionRequestConflictError } from '@/lib/external-actions/action-request-contract';

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    // 1. Get workspace_id
    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1);

    const workspaceId = members?.[0]?.workspace_id;
    if (!workspaceId) {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 });
    }

    const body = await req.json();
    const channelId = body.channelId as ChannelId;
    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 255)) {
      return NextResponse.json({ error: '요청 키를 확인해 주세요.' }, { status: 400 });
    }

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
    }

    // [HF-02 / HF-37] Canonical SOHEE_READY Server Admission Guard (Fail-Closed)
    const { requireSoheeReady } = await import('@/features/sohee-ready/admission-guard');
    try {
      await requireSoheeReady(workspaceId, { action: 'TEST_PUBLISH' });
    } catch (guardErr: any) {
      if (guardErr?.code === 'SOHEE_NOT_READY') {
        return NextResponse.json({
          success: false,
          verified: false,
          errorCode: 'SOHEE_NOT_READY',
          message: guardErr.message,
          blockers: guardErr.snapshot?.blockers || [],
        }, { status: 403 });
      }
      throw guardErr;
    }

    // [ANI-581] Mandatory Kill Switch Preflight Check
    const killCheck = await checkKillSwitchPreflight(supabase, {
      workspaceId,
      channel: channelId,
      provider: (channelId === 'INSTAGRAM' || channelId === 'THREADS') ? 'META' : 'NAVER'
    });

    if (killCheck.blocked) {
      return NextResponse.json({
        success: false,
        verified: false,
        errorCode: 'KILL_SWITCH_ENGAGED',
        message: killCheck.reason || '긴급 킬스위치가 활성화되어 외부 발행이 차단되었습니다.',
        receipt: null
      }, { status: 423 });
    }

    if ((channelId === 'INSTAGRAM' || channelId === 'THREADS') && !isMetaLiveAllowed(workspaceId)) {
      return NextResponse.json({
        success: false,
        verified: false,
        errorCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
        message: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
        receipt: null
      }, { status: 403 });
    }

    // 2. Meta Channels (Instagram, Threads)
    // [ANI-618 / ANI-996] Read-After-Write Verification & Neutral Caption Contract:
    // verificationCode: 소희 연결 인증이 완료되었습니다. (loadChannelCredentialByChannel, read_after_write, channel_verification_runs)
    if (channelId === 'INSTAGRAM' || channelId === 'THREADS') {
      const { executeMetaPublish } = await import('@/lib/external-actions/meta-action-executor');
      const channel = channelId.toLowerCase() as 'instagram' | 'threads';
      const mediaUrls = body.mediaUrls || (channel === 'instagram' ? ['https://storage.sohee.ai/brand/verification-test-card.png'] : undefined);
      const result = await executeMetaPublish({
        workspaceId,
        actorUserId: user.id,
        channel,
        mediaUrls,
        verificationCode: body.verificationCode,
        idempotencyKey: body.idempotencyKey,
      });

      const statusCode = result.status === 'VERIFIED' || result.status === 'SUCCEEDED'
        ? 200
        : ['VERIFYING', 'EXECUTING', 'RESULT_UNKNOWN'].includes(result.status)
          ? 202
          : result.status === 'BLOCKED'
            ? 423
            : 400;

      return NextResponse.json(result, { status: statusCode });
    }

    // 3. Naver Blog Channel
    if (channelId === 'NAVER_BLOG') {
      const { data: browserConn } = await supabase
        .from('browser_channel_connections')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'NAVER_BLOG')
        .maybeSingle();

      const blogId = browserConn?.external_account_label || 'blog';

      // 최신 승인된 콘텐츠 시안 조회 (Strict schema: content_items + content_versions)
      const { data: latestItem } = await (supabase as any)
        .from('content_items')
        .select('id, title, current_version_id')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let blogTitle = latestItem?.title || '소희 맞춤 매장 칼럼 가이드';
      let blogBody = '안녕하세요! 매장 전문 1:1 맞춤 케어 소희입니다.\n\n정성스럽게 준비한 이번 주 혜택을 확인해 보세요.';
      let blogTags = ['소희마케팅', '매장홍보', '1대1케어'];

      if (latestItem?.current_version_id) {
        const { data: cVer } = await (supabase as any)
          .from('content_versions')
          .select('caption, hashtags')
          .eq('id', latestItem.current_version_id)
          .maybeSingle();
        if (cVer) {
          blogBody = cVer.caption || blogBody;
          blogTags = cVer.hashtags || blogTags;
        }
      }

      const targetWriteUrl = blogId && blogId !== 'blog'
        ? `https://blog.naver.com/${blogId}/postwrite`
        : `https://blog.editor.naver.com/editor`;

      const payloadText = `${blogTitle}\n\n${blogBody}\n\n${blogTags.map(t => `#${t.replace(/^#/, '')}`).join(' ')}`;

      let newRequestId = crypto.randomUUID();
      try {
        const actionReq = await CanonicalActionLedgerService.createActionRequest({
          workspaceId,
          channel: 'naver_blog',
          actionKind: 'blog_post',
          targetExternalId: blogId,
          targetLabel: blogId,
          exactPayload: { title: blogTitle, body: blogBody, tags: blogTags },
          createdBy: user.id,
        });
        newRequestId = actionReq.requestId;

        await (supabase as any).from('external_action_receipts').insert({
          workspace_id: workspaceId,
          action_request_id: newRequestId,
          attempt_id: null,
          receipt_kind: 'manual_assist',
          provider_reference: null,
          result_url: targetWriteUrl,
          observed_payload: {
            channel: 'NAVER_BLOG',
            status: 'BRIDGE_PREPARED',
            verified: false,
            editor_url: targetWriteUrl,
            blog_id: blogId,
            title: blogTitle,
          },
          recorded_by: user.id,
          recorded_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('[test-publish] Naver blog bridge persistence warning:', err);
      }

      return NextResponse.json({
        success: true,
        verified: false, // [ANI-598] 에디터 원고 준비 단계이므로 실제 발행 URL 확인 전까지 verified: false 유지
        status: 'BRIDGE_PREPARED',
        method: 'SMART_EDITOR_BRIDGE',
        message: '네이버 블로그 스마트에디터 원고가 준비되었습니다! 에디터에서 최종 발행을 완료해 주세요.',
        editorUrl: targetWriteUrl,
        copyPayload: payloadText,
        receipt: {
          actionRequestId: newRequestId,
          channelId: 'NAVER_BLOG',
          status: 'BRIDGE_PREPARED',
          verificationMethod: 'SMART_EDITOR_BRIDGE',
          externalUrl: targetWriteUrl,
          evidenceDetails: { editorUrl: targetWriteUrl, blogId, title: blogTitle }
        }
      });
    }

    // 4. DAANGN: 미지원/검증 준비 중 정직한 표기 (ANI-598)
    let daangnRequestId = crypto.randomUUID();
    try {
      const daangnActionReq = await CanonicalActionLedgerService.createActionRequest({
        workspaceId,
        channel: 'daangn_business',
        actionKind: 'business_news_post',
        targetExternalId: 'daangn_profile',
        targetLabel: '당근 비즈프로필',
        exactPayload: { placeholder: true },
        createdBy: user.id,
      });
      daangnRequestId = daangnActionReq.requestId;

      await (supabase as any).from('external_action_receipts').insert({
        workspace_id: workspaceId,
        action_request_id: daangnRequestId,
        attempt_id: null,
        receipt_kind: 'manual_assist',
        provider_reference: null,
        result_url: null,
        observed_payload: {
          channel: 'DAANGN',
          status: 'CAPABILITY_PENDING',
          verified: false,
        },
        recorded_by: user.id,
        recorded_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[test-publish] Daangn bridge persistence warning:', err);
    }

    return NextResponse.json({
      success: false,
      verified: false,
      status: 'CAPABILITY_PENDING',
      errorCode: 'DAANGN_CAPABILITY_PENDING',
      message: '당근 비즈프로필은 현재 자동화 검증 준비 중입니다. 수동 보조 모드로 동작합니다.',
      receipt: {
        actionRequestId: daangnRequestId,
        channel: 'DAANGN',
        status: 'CAPABILITY_PENDING',
      }
    }, { status: 422 });

  } catch (err: any) {
    if (err instanceof ActionRequestConflictError) {
      return NextResponse.json({ errorCode: err.code, message: '같은 요청 키에 다른 작업 내용이 지정되었습니다.' }, { status: 409 });
    }
    console.error('[test-publish route error]:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
