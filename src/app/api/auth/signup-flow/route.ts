export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  getOrCreateSignupApplication,
  updateSignupBusinessInfo,
  submitSignupAgreements,
  finalizeSignupAndActivateFreeTaste,
  ensureUserProfile
} from '@/features/auth/signup-state-machine'
import {
  queryNtsBusinessValidation,
  validateBusinessNumberChecksum,
  normalizeBusinessNumber
} from '@/lib/auth/business-verification'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 })
    }

    // Google OAuth 사용자 프로필 동기화 (ANI-1334 DB Invariant)
    await ensureUserProfile(supabase, user)

    const app = await getOrCreateSignupApplication(supabase, user.id)
    const hasNtsKey = Boolean(process.env.NTS_API_KEY || process.env.DATA_GO_KR_API_KEY)

    return NextResponse.json({
      success: true,
      application: app,
      isNtsLiveAvailable: hasNtsKey
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '가입 상태 조회 실패' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 })
    }

    // 사용자 프로필 동기화 보장
    await ensureUserProfile(supabase, user)

    const body = await req.json()
    const { action } = body

    if (action === 'update_business') {
      const { businessNumber, companyName, representativeName, startDate } = body
      if (!businessNumber || !companyName || !representativeName) {
        return NextResponse.json({ error: '사업자등록번호, 상호명, 대표자명은 필수입니다.' }, { status: 400 })
      }

      // [P1-1] 서버 단 강제 검증: 10자리 정규화 및 체크섬 알고리즘
      const cleanBNo = normalizeBusinessNumber(businessNumber)
      if (cleanBNo.length !== 10 || !validateBusinessNumberChecksum(cleanBNo)) {
        return NextResponse.json(
          { error: '유효한 10자리 사업자등록번호가 아닙니다. (체크섬 오류)' },
          { status: 400 }
        )
      }

      const cleanCName = String(companyName).trim()
      if (cleanCName.length < 2) {
        return NextResponse.json(
          { error: '상호명을 2자 이상 정확히 입력해 주세요.' },
          { status: 400 }
        )
      }

      const cleanRName = String(representativeName).trim()
      if (cleanRName.length < 2) {
        return NextResponse.json(
          { error: '대표자명을 2자 이상 정확히 입력해 주세요.' },
          { status: 400 }
        )
      }

      // 국세청 실시간 진위확인 (ANI-555, ANI-733, ANI-1334)
      const ntsResult = await queryNtsBusinessValidation({
        b_no: cleanBNo,
        p_nm: cleanRName,
        b_nm: cleanCName,
        start_dt: startDate
      })

      // [P1-1 & P1-2] 불일치나 폐업은 MANUAL_REVIEW로 절대 진입시키지 않고 에러 반환
      if (ntsResult.status === 'CLOSED_BUSINESS') {
        return NextResponse.json(
          { error: '국세청 조회 결과 폐업된 사업자등록번호는 등록할 수 없습니다.' },
          { status: 400 }
        )
      }

      if (ntsResult.status === 'MISMATCH') {
        return NextResponse.json(
          { error: '국세청 등록 정보와 상호명 또는 대표자명이 일치하지 않습니다. (MISMATCH)' },
          { status: 400 }
        )
      }

      const isVerified = ntsResult.status === 'VERIFIED'
      const updatedApp = await updateSignupBusinessInfo(supabase, user.id, {
        businessNumber: cleanBNo,
        companyName: cleanCName,
        representativeName: cleanRName,
        startDate,
        isVerified,
        validationStatus: ntsResult.status
      })

      return NextResponse.json({
        success: true,
        application: updatedApp,
        validation: ntsResult
      })
    }

    if (action === 'submit_agreements') {
      const { agreements } = body
      const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || undefined
      try {
        const updatedApp = await submitSignupAgreements(supabase, user.id, agreements, ip)
        return NextResponse.json({ success: true, application: updatedApp })
      } catch (err: any) {
        const status = err.statusCode || 400
        return NextResponse.json({ error: err.message || '약관 동의 처리에 실패했습니다.' }, { status })
      }
    }

    if (action === 'provision_education' || action === 'activate_taste' || action === 'activate_trial') {
      const provider = user.app_metadata?.provider || 'google'
      try {
        const result = await finalizeSignupAndActivateFreeTaste(supabase, user.id, String(provider))
        if (result.workspaceId) {
          try {
            const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
            const adminClient = createAdminSupabaseClient()
            await (adminClient as any).rpc('ensure_signup_starter_credits', {
              p_user_id: user.id,
              p_workspace_id: result.workspaceId,
            })
          } catch (starterErr) {
            console.warn('[signup-flow] ensure_signup_starter_credits failed:', starterErr)
          }
        }
        return NextResponse.json({ ...result })
      } catch (err: any) {
        const status = err.statusCode || 400
        return NextResponse.json({ error: err.message || '워크스페이스 활성화에 실패했습니다.' }, { status })
      }
    }

    return NextResponse.json({ error: '유효하지 않은 요청 액션입니다.' }, { status: 400 })
  } catch (err: any) {
    console.error('[signup-flow] Error:', err)
    return NextResponse.json({ error: err.message || '가입 진행 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
