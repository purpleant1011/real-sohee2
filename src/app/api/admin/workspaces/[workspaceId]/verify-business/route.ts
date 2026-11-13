export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { requireOperator } from '@/features/operator-auth/require-operator';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    // ANI-563 / ANI-577: dedicated write scope operator permission
    await requireOperator('workspace.lifecycle.manage', workspaceId);

    const body = await req.json();
    const { status, reason, businessNumber, companyName, representativeName } = body;

    if (!status || !['VERIFIED', 'REJECTED', 'PENDING', 'DOCUMENT_REQUIRED', 'MISMATCH'].includes(status)) {
      return NextResponse.json({ error: '유효한 심사 상태가 필요합니다.' }, { status: 400 });
    }

    // businessNumber 정규화 및 10자리 검증 (선택 필드)
    let sanitizedBNum: string | undefined;
    if (businessNumber !== undefined && businessNumber !== null && String(businessNumber).trim() !== '') {
      sanitizedBNum = String(businessNumber).replace(/\D/g, '');
      if (sanitizedBNum.length !== 10) {
        return NextResponse.json(
          { error: '사업자등록번호는 10자리 숫자여야 합니다.' },
          { status: 400 }
        );
      }
    }

    const trimmedCName = companyName !== undefined && companyName !== null && String(companyName).trim() !== ''
      ? String(companyName).trim()
      : undefined;
    const trimmedRName = representativeName !== undefined && representativeName !== null && String(representativeName).trim() !== ''
      ? String(representativeName).trim()
      : undefined;

    const supabase = await createServerSupabaseClient();

    // 1. 기존 business_verifications row 확인 (ANI-577: NOT NULL contract 보장)
    const { data: existingBv } = await (supabase as any)
      .from('business_verifications')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    let bNum = sanitizedBNum || existingBv?.business_number;
    let cName = trimmedCName || existingBv?.company_name;
    let rName = trimmedRName || existingBv?.representative_name;

    // row가 없는 경우 fallback: business_profiles 또는 signup_applications 조회
    if (!existingBv) {
      const { data: bProfile } = await (supabase as any)
        .from('business_profiles')
        .select('business_name')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      const { data: ws } = await (supabase as any)
        .from('workspaces')
        .select('name, created_by')
        .eq('id', workspaceId)
        .maybeSingle();

      let signupApp = null;
      if (ws?.created_by) {
        const { data: sApp } = await (supabase as any)
          .from('signup_applications')
          .select('*')
          .eq('user_id', ws.created_by)
          .maybeSingle();
        signupApp = sApp;
      }

      bNum = bNum || signupApp?.business_number;
      cName = cName || signupApp?.company_name || bProfile?.business_name || ws?.name;
      rName = rName || signupApp?.representative_name;
    }

    // [ANI-603] 플레이스홀더(0000000000) 또는 누락 상태에서의 VERIFIED 승인 원천 차단
    if (status === 'VERIFIED') {
      if (!bNum || bNum === '0000000000' || bNum.length < 10) {
        return NextResponse.json(
          { error: '유효한 사업자등록번호가 없어 VERIFIED 승인이 불가합니다. (ANI-603)' },
          { status: 400 }
        );
      }
      if (!cName || cName === '심사 대상 매장') {
        return NextResponse.json(
          { error: '유효한 상호명이 확인되지 않아 VERIFIED 승인이 불가합니다. (ANI-603)' },
          { status: 400 }
        );
      }
    }

    // 기존 행이 없거나 플레이스홀더거나 새 정보가 입력된 경우 service-role 관리자 클라이언트로 upsert
    const needsUpsert = !existingBv ||
      !existingBv.business_number ||
      existingBv.business_number === '0000000000' ||
      !existingBv.company_name ||
      existingBv.company_name === '심사 대상 매장' ||
      Boolean(sanitizedBNum && sanitizedBNum !== existingBv.business_number) ||
      Boolean(trimmedCName && trimmedCName !== existingBv.company_name) ||
      Boolean(trimmedRName && trimmedRName !== existingBv.representative_name);

    if (needsUpsert && bNum && cName) {
      const adminClient = createAdminSupabaseClient();
      const now = new Date().toISOString();
      const { error: upsertErr } = await (adminClient as any)
        .from('business_verifications')
        .upsert(
          {
            workspace_id: workspaceId,
            business_number: bNum,
            company_name: cName,
            representative_name: rName || '대표자',
            status: existingBv?.status || 'PENDING',
            updated_at: now,
          },
          { onConflict: 'workspace_id' }
        );

      if (upsertErr) {
        console.error('[verify-business] Upsert business_verifications failed:', upsertErr);
        return NextResponse.json(
          { error: `사업자 정보 저장 실패: ${upsertErr.message}` },
          { status: 500 }
        );
      }
    }

    // [P0-3 & P0-4] 단일 원자적 Postgres RPC 호출 (Zero Partial State, Exactly Once DB Invariant)
    const { data: { user: operatorUser } } = await supabase.auth.getUser();
    if (!operatorUser) {
      return NextResponse.json({ error: '운영자 인증이 필요합니다.' }, { status: 401 });
    }
    const operatorId = operatorUser.id;

    // The SQL function is service_role-only; requireOperator above checks workspace scope.
    const { data: rpcRes, error: rpcErr } = await (createAdminSupabaseClient() as any).rpc(
      'admin_verify_business_and_grant_taste',
      {
        p_workspace_id: workspaceId,
        p_operator_id: operatorId,
        p_status: status,
        p_reason: reason || null
      }
    );

    if (rpcErr) {
      console.error('[verify-business] Admin verify RPC failed:', rpcErr);
      return NextResponse.json(
        { error: `사업자 심사 상태 DB 반영 실패: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    // 감사 기록: 변경 필드명, actor, 시각, source만 민감 원문 없이 기록
    let auditSaveError: unknown = null;
    try {
      const crypto = await import('node:crypto');
      const auditIdem = crypto.createHash('sha256').update(`verify-audit:${workspaceId}:${operatorId}:${Date.now()}`).digest('hex');
      const reqId = `verify-req-${auditIdem.slice(0, 24)}`;

      const adminClient = createAdminSupabaseClient();
      const { error: aErr } = await (adminClient as any).from('platform_audit_events').insert({
        actor_user_id: operatorId,
        workspace_id: workspaceId,
        action: 'agreement.verify.approved',
        target_type: 'business_verification',
        target_id: workspaceId,
        reason: reason || `사업자 심사 상태 변경 [${status}]`,
        request_id: reqId,
        result: status === 'REJECTED' ? 'denied' : 'succeeded',
        fact_kind: 'observed',
        before: { status: existingBv?.status || 'PENDING' },
        after: {
          status,
          changed_fields: ['status', ...(sanitizedBNum ? ['business_number'] : []), ...(trimmedCName ? ['company_name'] : [])],
          source: 'operator_manual_review',
        },
        idempotency_key: auditIdem,
      });

      if (aErr) {
        console.warn('[verify-business] Audit event recording error:', aErr);
        auditSaveError = aErr;
      }
    } catch (auditErr) {
      console.warn('[verify-business] Audit event recording notice:', auditErr);
      auditSaveError = auditErr;
    }

    return NextResponse.json({
      success: true,
      workspaceId,
      status,
      energyGranted: rpcRes?.energy_granted ?? 0,
      creditsGranted: rpcRes?.credits_granted ?? 0,
      alreadyGranted: rpcRes?.already_granted ?? false,
      message: `사업자 심사 상태가 [${status}]로 성공적으로 갱신되었습니다.`
    });

  } catch (err: any) {
    console.error('[verify-business] Error:', err);
    return NextResponse.json(
      { error: err?.message || '사업자 심사 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
