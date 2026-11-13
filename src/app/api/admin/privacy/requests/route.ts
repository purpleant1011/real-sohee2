export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';
import { revokeExternalProviderToken, terminateRemoteBrowserSessions } from '@/features/operator-privacy/provider-revoker';

export async function GET() {
  try {
    await requireOperatorAnyScope('privacy.read');
    const supabase = await createServerSupabaseClient();

    const { data: requests, error } = await (supabase as any)
      .from('data_deletion_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('[privacy-requests] Read error:', error);
    }

    return NextResponse.json({
      success: true,
      requests: requests || []
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '조회 실패' }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const operator = await requireOperatorAnyScope('data.delete.request');
    const body = await req.json();
    const { requestId, nextStatus } = body;

    if (!requestId || !['in_progress', 'completed', 'rejected'].includes(nextStatus)) {
      return NextResponse.json({ error: '유효한 requestId와 상태가 필요합니다.' }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    // 1. Fetch request details
    const { data: delReq } = await (supabase as any)
      .from('data_deletion_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (!delReq) {
      return NextResponse.json({ error: '삭제 요청을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 2. [ANI-589] If completed, execute real provider token revoking and data anonymization
    let actionsPerformed: string[] = [];
    if (nextStatus === 'completed') {
      const targetUserId = delReq.user_id;

      // A. Revoke and nullify all SNS channel tokens for workspaces owned by this user
      const { data: members } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', targetUserId);

      if (members && members.length > 0) {
        for (const m of members) {
          // 1. Channel connection disconnect
          const { error: chErr } = await (supabase as any)
            .from('channel_connections')
            .update({
              status: 'disconnected',
              account_label: '[DELETED_ACCOUNT]',
              updated_at: new Date().toISOString()
            })
            .eq('workspace_id', m.workspace_id);
          if (chErr) throw new Error(`채널 연결 해제 실패: ${chErr.message}`);

          // 2. Meta channel credentials query & external revoke before deletion (ANI-642)
          const { data: creds } = await (supabase as any)
            .from('meta_channel_credentials')
            .select('*')
            .eq('workspace_id', m.workspace_id);

          if (creds && creds.length > 0) {
            for (const cred of creds) {
              await revokeExternalProviderToken({
                provider: 'meta',
                accessToken: cred.access_token,
                targetUserId
              });
            }
          }

          const { error: credErr } = await (supabase as any)
            .from('meta_channel_credentials')
            .delete()
            .eq('workspace_id', m.workspace_id);
          if (credErr) console.warn('[privacy] credentials purge warning:', credErr.message);

          // 3. Browser sessions termination & lifecycle revocation (ANI-642)
          const { data: activeSessions } = await (supabase as any)
            .from('browser_sessions')
            .select('id')
            .eq('workspace_id', m.workspace_id)
            .eq('status', 'active');

          if (activeSessions && activeSessions.length > 0) {
            await terminateRemoteBrowserSessions({
              workspaceId: m.workspace_id,
              activeSessionIds: activeSessions.map((s: any) => s.id)
            });
          }

          const { error: sessErr } = await (supabase as any)
            .from('browser_sessions')
            .update({ status: 'revoked', updated_at: new Date().toISOString() })
            .eq('workspace_id', m.workspace_id);
          if (sessErr) console.warn('[privacy] browser session revoke warning:', sessErr.message);

          // 4. Channel consents withdrawal
          const { error: cnsErr } = await (supabase as any)
            .from('channel_consents')
            .update({ status: 'REVOKED' })
            .eq('workspace_id', m.workspace_id);
          if (cnsErr) console.warn('[privacy] channel consent revoke warning:', cnsErr.message);

          // 5. Business profile anonymization
          const { error: bpErr } = await (supabase as any)
            .from('business_profiles')
            .update({
              business_name: '삭제된 매장',
              summary: '개인정보 삭제 완료 처리됨',
              updated_at: new Date().toISOString()
            })
            .eq('workspace_id', m.workspace_id);
          if (bpErr) throw new Error(`사업자 프로필 익명화 실패: ${bpErr.message}`);
        }
        actionsPerformed.push(`PURGED_CREDENTIALS_AND_TOKENS_FOR_${members.length}_WORKSPACES`);
      }

      // B. Anonymize user agreements
      const { error: agrErr } = await (supabase as any)
        .from('user_agreements')
        .update({ ip_address: null })
        .eq('user_id', targetUserId);
      if (agrErr) throw new Error(`동의 IP 익명화 실패: ${agrErr.message}`);
      actionsPerformed.push('ANONYMIZED_IP_ADDRESSES');
    }

    // 3. Update data_deletion_requests record
    const { error: updateErr } = await (supabase as any)
      .from('data_deletion_requests')
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
        completed_at: nextStatus === 'completed' ? new Date().toISOString() : null
      })
      .eq('id', requestId);

    if (updateErr) {
      return NextResponse.json({ error: `삭제 요청 갱신 실패: ${updateErr.message}` }, { status: 500 });
    }

    // 4. Audit log with execution provenance (ANI-609: Strict UUID schema contract)
    await (supabase as any).from('audit_events').insert({
      workspace_id: '00000000-0000-0000-0000-000000000000',
      actor_id: operator.userId || null,
      entity_type: 'data_deletion_request',
      entity_id: requestId,
      event_type: 'privacy_request_status_update',
      created_at: new Date().toISOString(),
      metadata: {
        requestId,
        nextStatus,
        operatorId: operator.userId,
        actionsPerformed
      }
    });

    return NextResponse.json({
      success: true,
      requestId,
      status: nextStatus,
      actionsPerformed,
      message: nextStatus === 'completed'
        ? '개인정보 삭제 및 채널 토큰 파기가 실제 DB에서 안전하게 집행되었습니다.'
        : '상태가 성공적으로 변경되었습니다.'
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || '삭제 처리 실패' }, { status: 500 });
  }
}
