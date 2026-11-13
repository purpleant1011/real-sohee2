import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { verifyBusinessRegistration, queryNtsBusinessValidation, BusinessVerificationStatus } from '@/lib/auth/business-verification';
import { BUSINESS_DOCUMENT_BUCKET, isOwnBusinessDocumentPath } from '@/features/business-verification/document';
import { parseVerificationInput, REJECTION_REASONS } from '@/features/business-verification/input';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 서버 전용 admin 클라이언트로만 쓴다(사용자 세션의 직접 쓰기는 DB 정책으로 막혀 있다). 매장 대표·관리자만 가능.
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id'), { requireRole: 'manager' });
  if (isResponse(auth)) return auth;
  const { admin, workspaceId: wsId } = auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '요청 내용을 확인해 주세요.' }, { status: 400 });
    }
    const check = parseVerificationInput(body as Record<string, unknown>);
    if (!check.ok) {
      return NextResponse.json({ error: check.message }, { status: 400 });
    }
    const { businessNumber, companyName, representativeName, startDate } = check.value;
    const documentPath = (body as Record<string, unknown>).documentPath;

    // 사업자등록증은 필수: 이 매장 폴더에 서버가 실제로 저장한 파일만 인정한다.
    if (!isOwnBusinessDocumentPath(documentPath, wsId)) {
      return NextResponse.json({ error: '사업자등록증을 올려주세요.' }, { status: 400 });
    }
    const { data: found, error: existsError } = await admin.storage.from(BUSINESS_DOCUMENT_BUCKET).exists(documentPath);
    if (existsError || !found) {
      return NextResponse.json({ error: '업로드한 사업자등록증을 찾을 수 없어요. 다시 올려주세요.' }, { status: 400 });
    }

    // 이미 인증이 끝난 매장은 일반 접수로 덮어쓰거나 강등할 수 없다.
    const { data: current, error: readError } = await admin
      .from('business_verifications')
      .select('status')
      .eq('workspace_id', wsId)
      .maybeSingle();
    if (readError) {
      console.error('[business-verification] read failed');
      return NextResponse.json({ error: '인증 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
    }
    if (current?.status === 'VERIFIED') {
      return NextResponse.json(
        { error: '이미 사업자 인증이 완료되었어요. 정보를 바꾸려면 고객센터로 문의해 주세요.' },
        { status: 409 }
      );
    }

    const verificationResult = verifyBusinessRegistration({
      businessNumber,
      companyName,
      representativeName,
      documentUrl: documentPath
    });
    if (verificationResult.status === 'REJECTED' || verificationResult.status === 'DOCUMENT_REQUIRED') {
      return NextResponse.json({ success: false, verification: verificationResult }, { status: 400 });
    }

    let finalStatus: BusinessVerificationStatus = 'PENDING';
    let ntsMessage = verificationResult.message;
    let ntsBStt = '';

    const ntsRes = await queryNtsBusinessValidation({
      b_no: verificationResult.normalizedBusinessNumber,
      start_dt: startDate,
      p_nm: representativeName,
      b_nm: companyName
    });

    if (ntsRes.success) {
      if (ntsRes.status === 'VERIFIED') {
        // 정식 승인은 오직 관리자 RPC를 통해서만 이루어지므로 PENDING으로 설정해 관리자 큐로 전달 (ANI-1580)
        finalStatus = 'PENDING';
        ntsMessage = '국세청 정보 확인이 완료되어 운영팀 최종 심사 대기 중입니다.';
        ntsBStt = ntsRes.b_stt || '계속사업자';
      } else if (ntsRes.status === 'MISMATCH') {
        finalStatus = 'REJECTED';
        ntsMessage = REJECTION_REASONS.MISMATCH;
      } else if (ntsRes.status === 'CLOSED_BUSINESS') {
        finalStatus = 'REJECTED';
        ntsMessage = REJECTION_REASONS.CLOSED_BUSINESS;
        ntsBStt = '폐업자';
      } else {
        finalStatus = 'PENDING';
        ntsMessage = ntsRes.valid_msg || '사업자등록번호 검증이 접수되어 운영팀 심사 대기 중입니다.';
      }
    } else {
      finalStatus = 'PENDING';
      ntsMessage = '국세청 시스템 점검 또는 지연으로 인해 증빙 서류 기반 운영팀 수동 심사로 접수되었습니다.';
    }

    const now = new Date().toISOString();
    const record = {
      workspace_id: wsId,
      business_number: verificationResult.normalizedBusinessNumber,
      company_name: companyName,
      representative_name: representativeName,
      start_date: startDate,
      status: finalStatus,
      document_url: documentPath,
      rejection_reason: finalStatus === 'REJECTED' ? ntsMessage : null,
      verified_at: null,
      updated_at: now
    };

    const CONFLICT = { error: '이미 사업자 인증이 완료되었어요. 정보를 바꾸려면 고객센터로 문의해 주세요.' };
    if (current) {
      const { data: updated, error: updateError } = await admin
        .from('business_verifications').update(record)
        .eq('workspace_id', wsId).neq('status', 'VERIFIED').select('workspace_id');
      if (updateError) { console.error('[business-verification] save failed'); return NextResponse.json({ error: '인증 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 }); }
      if (!updated || updated.length === 0) return NextResponse.json(CONFLICT, { status: 409 });
    } else {
      const { error: insertError } = await admin.from('business_verifications').insert(record);
      if (insertError) {
        if ((insertError as { code?: string }).code === '23505') return NextResponse.json(CONFLICT, { status: 409 });
        console.error('[business-verification] save failed');
        return NextResponse.json({ error: '인증 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
      }
    }

    let profileSyncError: unknown = null;
    const { error: profileError } = await admin
      .from('business_profiles')
      .update({ business_name: companyName, updated_at: now })
      .eq('workspace_id', wsId);
    if (profileError) {
      console.error('[business-verification] profile name sync failed:', profileError);
      profileSyncError = profileError;
    }

    // Sync signup_applications if it exists for this workspace to maintain application-canonical integrity
    let appSyncError: unknown = null;
    const { error: appError } = await admin
      .from('signup_applications')
      .update({
        company_name: companyName,
        representative_name: representativeName,
        business_number: verificationResult.normalizedBusinessNumber,
        updated_at: now,
      })
      .eq('workspace_id', wsId);
    if (appError) {
      console.warn('[business-verification] signup_applications sync notice:', appError);
      appSyncError = appError;
    }

    // 감사 기록: 변경 필드명, actor, source, 시각만 기록 (사업자번호/대표자명 등 민감 원문 복제 금지)
    let auditSaveError: unknown = null;
    try {
      const crypto = await import('node:crypto');
      const auditIdem = crypto.createHash('sha256').update(`bv-submit:${wsId}:${auth.userId}:${now}`).digest('hex');
      const reqId = `bv-req-${auditIdem.slice(0, 24)}`;

      const { error: aErr } = await admin.from('platform_audit_events').insert({
        actor_user_id: auth.userId,
        workspace_id: wsId,
        action: 'agreement.verify.requested',
        target_type: 'business_verification',
        target_id: wsId,
        reason: '사업자등록 정보 제출 및 심사 요청',
        request_id: reqId,
        result: finalStatus === 'REJECTED' ? 'failed' : 'succeeded',
        fact_kind: 'user_claim',
        before: { status: current?.status || 'NONE' },
        after: {
          status: finalStatus,
          changed_fields: ['business_number', 'company_name', 'representative_name', 'start_date', 'document_url'],
          source: 'business_verifications',
        },
        idempotency_key: auditIdem,
      });

      if (aErr) {
        console.warn('[business-verification] Audit logging error:', aErr);
        auditSaveError = aErr;
      }
    } catch (auditErr) {
      console.warn('[business-verification] Audit logging notice:', auditErr);
      auditSaveError = auditErr;
    }

    return NextResponse.json({
      success: finalStatus !== 'REJECTED',
      verification: {
        ...verificationResult,
        status: finalStatus,
        message: ntsMessage,
        ntsBStt: ntsBStt || ntsRes.b_stt
      },
      secondarySync: {
        profileSynced: !profileSyncError,
        applicationSynced: !appSyncError,
        auditRecorded: !auditSaveError,
      }
    });
  } catch (err) {
    console.error('[business-verification] POST failed:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: '인증 요청 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 });
    }

    // Resolve workspace
    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);

    const wsId = members?.[0]?.workspace_id;

    if (!wsId) {
      return NextResponse.json({
        success: true,
        verification: {
          status: 'NOT_STARTED',
          isVerified: false,
          companyName: '',
          businessNumber: '',
          representativeName: '',
          verifiedAt: null,
          rejectionReason: null,
        },
      });
    }

    const { data: bRecord } = await (supabase as any)
      .from('business_verifications')
      .select('id, workspace_id, business_number, company_name, representative_name, start_date, status, verified_at, rejection_reason, document_url, updated_at')
      .eq('workspace_id', wsId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!bRecord) {
      // Try carry-forward from signup_applications if available
      const { data: signupApp } = await (supabase as any)
        .from('signup_applications')
        .select('company_name, business_number, representative_name, state')
        .eq('user_id', user.id)
        .maybeSingle();

      const hasValidAppBrn = Boolean(
        signupApp?.business_number &&
        String(signupApp.business_number).replace(/\D/g, '').length === 10
      );

      return NextResponse.json({
        success: true,
        verification: {
          status: hasValidAppBrn || signupApp?.state === 'VERIFICATION_PENDING' ? 'PENDING' : 'NOT_STARTED',
          isVerified: false,
          companyName: signupApp?.company_name || '',
          businessNumber: signupApp?.business_number || '',
          representativeName: signupApp?.representative_name || '',
          startDate: '',
          verifiedAt: null,
          rejectionReason: null,
        },
      });
    }

    const RECONCILE_MIN_INTERVAL_MS = 5 * 60 * 1000;
    const lastTouched = bRecord?.updated_at ? new Date(bRecord.updated_at).getTime() : 0;
    if (bRecord && bRecord.status === 'PENDING' && Date.now() - lastTouched >= RECONCILE_MIN_INTERVAL_MS) {
      try {
        const ntsRes = await queryNtsBusinessValidation({
          b_no: bRecord.business_number,
          start_dt: bRecord.start_date || undefined,
          p_nm: bRecord.representative_name || '',
          b_nm: bRecord.company_name || ''
        });
        if (ntsRes.success) {
          let nextStatus = bRecord.status;
          let rejectionReason: string | null = null;
          if (ntsRes.status === 'VERIFIED') {
            // 정식 승인은 오직 관리자 RPC를 통해서만 수행되므로 VERIFIED로 자동 승격하지 않고 PENDING 유지 (ANI-1580)
            nextStatus = 'PENDING';
          } else if (ntsRes.status === 'CLOSED_BUSINESS') {
            nextStatus = 'REJECTED';
            rejectionReason = REJECTION_REASONS.CLOSED_BUSINESS;
          } else if (ntsRes.status === 'MISMATCH') {
            nextStatus = 'REJECTED';
            rejectionReason = REJECTION_REASONS.MISMATCH;
          }
          if (nextStatus !== bRecord.status) {
            const now = new Date().toISOString();
            const { error: reconcileWriteError } = await (createAdminSupabaseClient() as any)
              .from('business_verifications')
              .update({
                status: nextStatus,
                verified_at: null,
                rejection_reason: nextStatus === 'REJECTED' ? rejectionReason : null,
                updated_at: now
              })
              .eq('id', bRecord.id);
            if (!reconcileWriteError) {
              bRecord.status = nextStatus;
              bRecord.verified_at = null;
              if (nextStatus === 'REJECTED') {
                bRecord.rejection_reason = rejectionReason;
              }
            } else {
              console.warn('[business-verification] reconcile write failed');
            }
          } else {
            const now = new Date().toISOString();
            const { error: touchError } = await (createAdminSupabaseClient() as any)
              .from('business_verifications')
              .update({ updated_at: now })
              .eq('id', bRecord.id);
            if (touchError) {
              console.warn('[business-verification] reconcile touch failed');
            } else {
              bRecord.updated_at = now;
            }
          }
        }
      } catch (reconcileErr) {
        console.warn('[business-verification GET reconciliation notice]:', reconcileErr instanceof Error ? reconcileErr.name : 'unknown');
      }
    }

    const isVerified = bRecord.status === 'VERIFIED';

    return NextResponse.json({
      success: true,
      verification: {
        id: bRecord.id,
        status: bRecord.status,
        isVerified,
        companyName: bRecord.company_name || '',
        businessNumber: bRecord.business_number || '',
        representativeName: bRecord.representative_name || '',
        startDate: bRecord.start_date || '',
        verifiedAt: bRecord.verified_at || null,
        rejectionReason: bRecord.rejection_reason || null,
        hasDocument: Boolean(bRecord.document_url),
      },
    });
  } catch (err: any) {
    console.error('[business-verification] GET failed:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json(
      { error: '인증 상태를 불러오지 못했어요.' },
      { status: 500 }
    );
  }
}
