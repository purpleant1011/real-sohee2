export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'
import {
  ExactApprovalService,
  StaleApprovalConcurrencyError,
  FingerprintMismatchError,
  BundleApprovalResultUnknownError,
} from '@/features/creative/exact-approval-service'
import { SupabaseCreativeBundleStore } from '@/features/creative/creative-bundle-store'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard (E2E-F F-2/F-3): refuse a non-member before the readiness gate,
  // otherwise SOHEE_NOT_READY would leak another workspace's unfinished items.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  // [P0-3] Production Execution Admission Guard
  const { requireSoheeReady, SoheeNotReadyError } = await import('@/features/sohee-ready/admission-guard')
  try {
    await requireSoheeReady(workspaceId, { action: 'CONTENT_APPROVE' })
  } catch (guardErr: any) {
    if (guardErr instanceof SoheeNotReadyError || guardErr?.code === 'SOHEE_NOT_READY') {
      return NextResponse.json({
        success: false,
        error: {
          code: 'SOHEE_NOT_READY',
          message: guardErr.message,
          blockers: guardErr.snapshot?.blockers || [],
          membershipTier: guardErr.membershipTier,
          membershipNotice: guardErr.membershipNotice,
          notice: guardErr.notice,
        },
      }, { status: 403 })
    }
    throw guardErr
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { contentId, versionId, fingerprint, bundleId, bundleFingerprint, reason } = body
    const decidedBy = auth.userId

    if (!contentId || !versionId) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_PARAMETERS', message: 'contentId와 versionId가 필수입니다.' },
      }, { status: 400 })
    }

    if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_FINGERPRINT',
          message: 'fingerprint는 64자리 소문자 16진수 SHA-256 해시값이어야 합니다.',
        },
      }, { status: 400 })
    }

    const hasBundleConsent = bundleId !== undefined || bundleFingerprint !== undefined
    if (hasBundleConsent && (typeof bundleId !== 'string' || !bundleId.trim()
      || typeof bundleFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(bundleFingerprint))) {
      return NextResponse.json({ success: false, error: {
        code: 'INVALID_BUNDLE_APPROVAL',
        message: '사진 묶음과 검토한 버전을 함께 확인해 주세요.',
      } }, { status: 400 })
    }

    const supabase = hasBundleConsent ? createAdminSupabaseClient() : null
    if (hasBundleConsent) {
      const bundleStore = new SupabaseCreativeBundleStore(supabase as any)
      const reviewedBundle = await bundleStore.getBundleById(workspaceId, bundleId)
      if (!reviewedBundle || reviewedBundle.workspaceId !== workspaceId
        || reviewedBundle.bundleId !== bundleId || reviewedBundle.contentId !== contentId
        || reviewedBundle.versionId !== versionId || reviewedBundle.bundleFingerprint !== bundleFingerprint) {
        return NextResponse.json({ success: false, error: {
          code: 'BUNDLE_REVIEW_REQUIRED',
          message: '사진 묶음이 변경되었거나 원고와 일치하지 않습니다. 최신 내용을 다시 검토해 주세요.',
        } }, { status: 409 })
      }
    }

    // 1. Content Version Approval (CanonicalContentLifecycleService)
    const approval = await CanonicalContentLifecycleService.approveContentVersion({
      workspaceId,
      contentId,
      versionId,
      fingerprint,
      decidedBy,
      reason,
    })

    // 2. Exact Bundle Approval via Optimistic Concurrency Predicate (ANI-1130)
    let bundleApproval: any = null
    if (hasBundleConsent) {
      const exactApprovalService = new ExactApprovalService(supabase)
      try {
        bundleApproval = await exactApprovalService.approveBundleExact({
          workspaceId,
          bundleId,
          expectedFingerprint: bundleFingerprint,
          decidedBy,
        })
      } catch (error) {
        // Every bundle failure happens after confirmed content approval. Preserve that
        // fact without claiming rollback, full approval, or permission to resend.
        const knownConflict = error instanceof FingerprintMismatchError || error instanceof StaleApprovalConcurrencyError
        const failure = knownConflict || error instanceof BundleApprovalResultUnknownError
          ? error : new BundleApprovalResultUnknownError()
        return NextResponse.json({
          success: false, approval, bundleApproval: null,
          error: { code: failure.code, message: failure.message },
        }, { status: 409 })
      }
    }

    return NextResponse.json({
      success: true,
      approval,
      bundleApproval,
    }, { status: 200 })
  } catch (err: unknown) {
    console.error('[Content Approvals API] POST error:', err)
    if (err instanceof FingerprintMismatchError || err instanceof StaleApprovalConcurrencyError) {
      return NextResponse.json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      }, { status: 409 })
    }

    if (err instanceof Error && err.name === 'PersistenceError') {
      const code = (err as any).code
      const statusCode = code === 'NOT_LATEST_VERSION' ? 409 : 400
      return NextResponse.json({
        success: false,
        error: {
          code: code || 'APPROVE_CONTENT_FAILED',
          message: err.message,
        },
      }, { status: statusCode })
    }
    return NextResponse.json({
      success: false,
      error: {
        code: 'APPROVE_CONTENT_FAILED',
        message: (err as Error).message || '원고 승인에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
