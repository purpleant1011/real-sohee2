export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  normalizeBusinessNumber,
  validateBusinessNumberChecksum,
  queryNtsBusinessValidation,
} from '@/lib/auth/business-verification';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      email,
      password,
      representativeName,
      phone,
      companyName,
      businessNumber,
      startDate,
      agreements,
    } = body;

    // 1. 기본 필드 유효성 검사
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return NextResponse.json({ error: '올바른 이메일 주소를 입력해 주세요.' }, { status: 400 });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const cleanRepresentativeName = typeof representativeName === 'string' ? representativeName.trim() : '';
    if (cleanRepresentativeName.length < 2) {
      return NextResponse.json({ error: '대표자 성명을 2자 이상 입력해 주세요.' }, { status: 400 });
    }

    const cleanCompanyName = typeof companyName === 'string' ? companyName.trim() : '';
    if (cleanCompanyName.length < 2) {
      return NextResponse.json({ error: '상호명을 2자 이상 입력해 주세요.' }, { status: 400 });
    }

    // 2. 사업자등록번호 체크섬 검증
    const cleanBrn = normalizeBusinessNumber(String(businessNumber || ''));
    if (cleanBrn.length !== 10 || !validateBusinessNumberChecksum(cleanBrn)) {
      return NextResponse.json(
        { error: '유효한 10자리 사업자등록번호가 아닙니다. 국세청 체크섬 검증에 실패했습니다.' },
        { status: 400 }
      );
    }

    // 3. 필수 약관 동의 검증
    if (
      !agreements ||
      !agreements.termsOfService ||
      !agreements.privacyPolicy ||
      !agreements.aiDataProcessing ||
      !agreements.channelDelegation
    ) {
      return NextResponse.json(
        { error: '소희 서비스 이용을 위해 모든 필수 약관에 동의해 주세요.' },
        { status: 400 }
      );
    }

    const adminClient = createAdminSupabaseClient() as any;

    // 4. 사업자등록번호 중복 검증 (이미 검증 완료된 워크스페이스가 있는지)
    const { data: existingBv } = await adminClient
      .from('business_verifications')
      .select('workspace_id, status')
      .eq('business_number', cleanBrn)
      .eq('status', 'VERIFIED')
      .maybeSingle();

    if (existingBv?.workspace_id) {
      return NextResponse.json(
        { error: '이미 등록된 사업자등록번호입니다. 기존 계정으로 로그인해 주세요.' },
        { status: 409 }
      );
    }

    // 5. 국세청 진위확인
    const cleanStartDate = startDate ? String(startDate).replace(/[^0-9]/g, '') : undefined;
    const ntsResult = await queryNtsBusinessValidation({
      b_no: cleanBrn,
      p_nm: cleanRepresentativeName,
      b_nm: cleanCompanyName,
      start_dt: cleanStartDate,
    });

    if (ntsResult.status === 'CLOSED_BUSINESS') {
      return NextResponse.json(
        { error: '국세청 조회 결과 폐업된 사업자등록번호는 등록할 수 없습니다.' },
        { status: 400 }
      );
    }

    if (ntsResult.status === 'MISMATCH') {
      return NextResponse.json(
        { error: '국세청 등록 정보와 상호명 또는 대표자명이 일치하지 않습니다. 사업자등록증의 정보를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }

    const isVerified = ntsResult.status === 'VERIFIED';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    // 6. Supabase Auth 사용자 생성 (또는 중단된 가입 재개 회복)
    let user: any = null;
    let resumedWorkspaceId: string | null = null;
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: cleanRepresentativeName,
        name: cleanRepresentativeName,
        phone: cleanPhone,
        company_name: cleanCompanyName,
        business_number: cleanBrn,
        start_date: cleanStartDate,
      },
    });

    if (createData?.user) {
      user = createData.user;
    } else {
      const errMsg = createError?.message || '';
      const isAlreadyExists =
        errMsg.toLowerCase().includes('already') ||
        (createError as any)?.code === '23505' ||
        createError?.status === 422;

      if (isAlreadyExists) {
        // [Security Isolation] 암호 확인은 adminClient를 변이시키지 않는 독립 익명 클라이언트로만 수행 (adminClient 권한 변조 방지)
        const isolatedAuthClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project-ref.supabase.co',
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
          { auth: { persistSession: false, autoRefreshToken: false } }
        );

        let authAttempt: any = null;
        try {
          const res = await isolatedAuthClient.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          authAttempt = res;
        } catch {
          authAttempt = null;
        }

        if (authAttempt?.data?.user && !authAttempt?.error) {
          const authUser = authAttempt.data.user;
          // 해당 사용자의 활성 멤버십 조회 (오류 시 fail-open 방지: 명시적 503)
          const { data: existingMembers, error: memErr } = await adminClient
            .from('workspace_members')
            .select('workspace_id')
            .eq('user_id', authUser.id)
            .eq('status', 'active');

          if (memErr) {
            console.error('[register-email] Membership check failed during resume:', memErr);
            return NextResponse.json(
              { error: '회원 가입 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
              { status: 503 }
            );
          }

          // 해당 사용자의 기존 가입 신청서 상태 확인
          const { data: existingApp, error: appCheckErr } = await adminClient
            .from('signup_applications')
            .select('id, workspace_id, state, agreements_completed')
            .eq('user_id', authUser.id)
            .maybeSingle();

          if (appCheckErr) {
            console.error('[register-email] Application check failed during resume:', appCheckErr);
            return NextResponse.json(
              { error: '회원 가입 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
              { status: 503 }
            );
          }

          // 완전 가입 여부 검증: 활성 멤버십 + 신청서 workspace_id 일치 + 약관 4종 실제 워크스페이스 결합 완료 여부
          let isAgreementsFullyBound = false;
          if (existingApp?.workspace_id) {
            const { data: agRows, error: agCheckErr } = await adminClient
              .from('user_agreements')
              .select('agreement_type, agreed')
              .eq('user_id', authUser.id)
              .eq('workspace_id', existingApp.workspace_id)
              .eq('agreed', true);

            if (!agCheckErr && agRows) {
              const agreedTypes = new Set(agRows.map((r: { agreement_type: string }) => r.agreement_type));
              isAgreementsFullyBound =
                agreedTypes.has('TERMS_OF_SERVICE') &&
                agreedTypes.has('PRIVACY_POLICY') &&
                agreedTypes.has('AI_DATA_PROCESSING') &&
                agreedTypes.has('CHANNEL_OPERATION_DELEGATION');
            }
          }

          const hasActiveWs = existingMembers && existingMembers.length > 0;
          const isFullyCompleted =
            hasActiveWs &&
            existingApp &&
            existingApp.workspace_id &&
            existingApp.agreements_completed === true &&
            isAgreementsFullyBound &&
            existingMembers.some((m: { workspace_id: string }) => m.workspace_id === existingApp.workspace_id);

          // 이미 온전히 약관 결합까지 완료된 정식 회원이면 409 안내
          if (isFullyCompleted) {
            return NextResponse.json(
              { error: '이미 가입된 이메일 주소입니다. 로그인 페이지에서 로그인해 주세요.' },
              { status: 409 }
            );
          }

          // 다중 워크스페이스 소유자 등 모호한 상태는 임의 승계 금지
          if (existingMembers && existingMembers.length > 1) {
            return NextResponse.json(
              { error: '다중 워크스페이스가 감지되었습니다. 로그인 페이지에서 로그인해 주세요.' },
              { status: 409 }
            );
          }

          // 활성 워크스페이스가 없거나 약관/신청서 연결이 미완료된 건은 안전하게 복구/재개 대상으로 승계
          user = authUser;
          resumedWorkspaceId = existingApp?.workspace_id || (existingMembers && existingMembers.length === 1 ? existingMembers[0].workspace_id : null);
        } else {
          return NextResponse.json(
            { error: '이미 가입된 이메일 주소입니다. 로그인 페이지에서 로그인해 주세요.' },
            { status: 409 }
          );
        }
      } else {
        return NextResponse.json(
          { error: errMsg || '회원 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 400 }
        );
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: '회원 계정을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || undefined;

    // 7. 가입 신청서 사전 등록 (RPC를 통해 기존 non-null 사업자 정보 및 workspace_id 보존)
    const { data: prepData, error: appErr } = await adminClient.rpc('prepare_signup_application_atomic', {
      p_user_id: user.id,
      p_business_number: cleanBrn,
      p_company_name: cleanCompanyName,
      p_representative_name: cleanRepresentativeName,
      p_is_verified: isVerified,
    });

    if (appErr || !prepData?.success) {
      console.error('[register-email] Failed to prepare signup application:', appErr);
      return NextResponse.json(
        { error: '가입 신청서 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    // 8. 교육용 워크스페이스 프로비저닝 (미완료 재개 시 기존 워크스페이스 재사용, 신규 시 생성)
    //    [P0 ANI-1354] provision_education_workspace 는 signup_applications.agreements_completed = true 를 요구한다.
    //    prepare_signup_application_atomic 는 이를 false 로만 기록하므로, 프로비저닝 전에 약관 동의를 먼저 확정한다.
    //    (p_workspace_id = null 이면 business_verifications·audit 기록은 건너뛰므로 9단계에서 반드시 한 번 더 호출한다.)
    const marketingAgreed = typeof agreements?.marketingConsent === 'boolean' ? agreements.marketingConsent : null;

    let workspaceId: string | null = resumedWorkspaceId;
    if (!workspaceId) {
      const { data: preFinalizeData, error: preFinalizeErr } = await adminClient.rpc('finalize_email_signup_atomic', {
        p_user_id: user.id,
        p_workspace_id: null,
        p_business_number: cleanBrn,
        p_company_name: cleanCompanyName,
        p_representative_name: cleanRepresentativeName,
        p_start_date: cleanStartDate || null,
        p_is_verified: isVerified,
        p_marketing_agreed: marketingAgreed,
        p_agreements_version: '2026.09-v1',
        p_ip_address: ip || null,
      });

      if (preFinalizeErr || !preFinalizeData?.success) {
        console.error('[register-email] finalize_email_signup_atomic (agreements) failed:', preFinalizeErr);
        return NextResponse.json(
          { error: '가입 정보 및 약관 동의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 500 }
        );
      }

      const { data: eduData, error: eduError } = await adminClient.rpc('provision_education_workspace', {
        p_user_id: user.id,
        p_workspace_name: cleanCompanyName,
        p_provider: 'email',
      });

      if (eduError || !(eduData as any)?.workspace_id) {
        console.error('[register-email] provision_education_workspace error:', eduError);
        return NextResponse.json(
          { error: '교육용 워크스페이스를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 500 }
        );
      }

      workspaceId = (eduData as any).workspace_id;
    }

    // 9. 단일 원자적 DB 트랜잭션 RPC 호출 (Zero Partial State)
    // 약관 동의 4종+선택1종(동일 동의 재시도 시 최초 agreed_at 시각 및 워크스페이스 보존) + 신청서와 워크스페이스 명시적 결합 + 개업일자 보존
    const { data: finalizeData, error: finalizeErr } = await adminClient.rpc('finalize_email_signup_atomic', {
      p_user_id: user.id,
      p_workspace_id: workspaceId,
      p_business_number: cleanBrn,
      p_company_name: cleanCompanyName,
      p_representative_name: cleanRepresentativeName,
      p_start_date: cleanStartDate || null,
      p_is_verified: isVerified,
      p_marketing_agreed: marketingAgreed,
      p_agreements_version: '2026.09-v1',
      p_ip_address: ip || null,
    });

    if (finalizeErr || !finalizeData?.success) {
      console.error('[register-email] finalize_email_signup_atomic failed:', finalizeErr);
      return NextResponse.json(
        { error: '가입 정보 및 약관 동의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    // 10. 가입 스타터 크레딧 보장
    if (workspaceId) {
      try {
        const { error: creditErr } = await adminClient.rpc('ensure_signup_starter_credits', {
          p_user_id: user.id,
          p_workspace_id: workspaceId,
        });
        if (creditErr) {
          console.warn('[register-email] ensure_signup_starter_credits notice:', creditErr);
        }
      } catch (creditErr) {
        console.warn('[register-email] ensure_signup_starter_credits failed:', creditErr);
      }
    }

    return NextResponse.json({
      success: true,
      workspaceId,
      isVerified,
      validation: ntsResult,
      integrity: finalizeData,
    });
  } catch (err: any) {
    console.error('[register-email] Internal error:', err);
    return NextResponse.json(
      { error: err?.message || '회원가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    );
  }
}
