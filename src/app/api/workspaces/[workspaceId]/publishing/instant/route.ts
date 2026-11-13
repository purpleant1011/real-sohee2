export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth';
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor';
import { naverPublishNotReadyResult } from '@/features/naver-publish/unavailable';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  validatePublishInputContract,
  resolveApprovedBundlePublishContext,
  RawImagesContractViolationError,
  ApprovedBundleRequiredError,
} from '@/features/publishing/publish-contract-validator';
import { SupabaseCreativeBundleStore } from '@/features/creative/creative-bundle-store';
import { ApprovalIntegrityError } from '@/features/creative/approval-invalidation-engine';
import { PublishRenditionService, PublishRenditionError } from '@/features/publishing/publish-rendition-service';
import { ProviderDeliveryLeaseService, ProviderDeliveryLeaseError } from '@/features/publishing/provider-delivery-lease-service';
import { CanonicalPublishFacade } from '@/features/publishing/canonical-publish-facade';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  // Cross-tenant guard (E2E-F F-3): refuse a non-member before the readiness gate.
  // Otherwise SOHEE_NOT_READY would disclose another workspace's unfinished items.
  const auth = await authorizeQuickRequest(workspaceId);
  if (isResponse(auth)) return auth;

  // [P0-3] Production Execution Admission Guard
  const { requireSoheeReady, SoheeNotReadyError } = await import('@/features/sohee-ready/admission-guard');
  try {
    await requireSoheeReady(workspaceId, { action: 'INSTANT_PUBLISH' });
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
      }, { status: 403 });
    }
    throw guardErr;
  }

  try {
    const body = await request.json().catch(() => ({}));
    
    // 1. Strict Contract Gate: Purge raw images[] & arbitrary URL injections (ANI-1131)
    const validatedInput = validatePublishInputContract(body);

    const {
      channel = validatedInput.channel,
      caption = '',
      hashtags = [],
      approvalId,
      contentId,
      versionId,
      fingerprint,
      bundleId,
    } = body;

    const supabase = await createServerSupabaseClient();
    const db = supabase as any;
    const bundleStore = new SupabaseCreativeBundleStore(db);

    // Exact Version Approval Admission Gate (ANI-1043)
    if (contentId || versionId || approvalId) {
      if (!approvalId || !versionId || !fingerprint) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'APPROVAL_REQUIRED',
            message: '게시 전 유효한 원고 승인(Approval) 정보가 필수입니다.',
          },
        }, { status: 403 });
      }

      // Check approval record in DB
      const { data: approvalRecord, error: appError } = await db
        .from('approvals')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', approvalId)
        .eq('version_id', versionId)
        .eq('status', 'approved')
        .maybeSingle();

      if (appError || !approvalRecord) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'APPROVAL_NOT_FOUND',
            message: '승인 기록을 찾을 수 없거나 아직 승인되지 않은 버전입니다.',
          },
        }, { status: 403 });
      }

      if (approvalRecord.fingerprint !== fingerprint) {
        return NextResponse.json({
          success: false,
          error: {
            code: 'APPROVAL_FINGERPRINT_MISMATCH',
            message: '승인된 지문과 현재 원고 지문이 일치하지 않습니다. 최신본 재승인이 필요합니다.',
          },
        }, { status: 400 });
      }

      // Check if content has been revised since approval (current_version_id check)
      if (contentId) {
        const { data: contentItem } = await db
          .from('content_items')
          .select('current_version_id')
          .eq('workspace_id', workspaceId)
          .eq('id', contentId)
          .maybeSingle();

        if (contentItem && contentItem.current_version_id !== versionId) {
          return NextResponse.json({
            success: false,
            error: {
              code: 'STALE_APPROVAL_CONFLICT',
              message: '콘텐츠가 새로 수정되어 이전 승인이 무효화되었습니다. 최신 버전을 다시 승인해 주세요.',
            },
          }, { status: 409 });
        }
      }
    }

    // 2. Server Authority: Resolve authoritative caption, fingerprint, and storage media from Approved Bundle (ANI-1131)
    let authoritativeImageUrl = '';
    let authoritativeCaption = `${caption}\n\n${hashtags.join(' ')}`.trim();
    let authoritativeFingerprint = fingerprint;

    const targetBundleId = bundleId || (versionId ? (await bundleStore.getLatestBundleForVersion(workspaceId, versionId))?.bundleId : undefined);

    if (targetBundleId && fingerprint) {
      const resolved = await resolveApprovedBundlePublishContext({
        workspaceId,
        bundleId: targetBundleId,
        expectedFingerprint: fingerprint,
        bundleStore,
      });

      authoritativeCaption = resolved.resolvedCaption;
      authoritativeFingerprint = resolved.fingerprint;

      // 3. ANI-1132: Source MediaAsset -> PublishRendition -> ProviderDeliveryLease 3-tier pipeline
      const renditionService = new PublishRenditionService(db);
      const leaseService = new ProviderDeliveryLeaseService(db);

      const targetChannel = channel || resolved.channel;
      const rendition = await renditionService.getOrCreateRendition({
        workspaceId,
        sourceMediaAssetId: resolved.primaryMediaAssetId,
        channel: targetChannel,
      });

      const lease = await leaseService.issueDeliveryLease({
        workspaceId,
        rendition,
        provider: targetChannel.toLowerCase(),
        purpose: `${targetChannel.toLowerCase()}_publish`,
        ttlSeconds: 3600,
        skipProbe: true,
      });

      authoritativeImageUrl = lease.delivery_url;
    }

    const results: Record<string, unknown> = {};

    let canonicalOutcome: any = null;

    // 1. Meta Channels (Instagram / Threads): Canonical Facade Execution (ANI-1133)
    if (targetBundleId && fingerprint && (channel === 'INSTAGRAM' || channel === 'THREADS' || channel === 'BOTH')) {
      const missionId = typeof body.missionId === 'string' ? body.missionId : undefined;
      const workerObservedEpoch = typeof body.workerObservedEpoch === 'number' ? body.workerObservedEpoch : undefined;
      const actionRequestId = typeof body.actionRequestId === 'string' ? body.actionRequestId : undefined;

      const canonicalFacade = new CanonicalPublishFacade(db);
      const canonicalRes = await canonicalFacade.executePublish({
        workspaceId,
        channel,
        bundleId: targetBundleId,
        expectedFingerprint: authoritativeFingerprint,
        idempotencyKey: validatedInput.idempotencyKey,
        missionId,
        actionRequestId,
        workerObservedEpoch,
        actorUserId: auth.userId,
      });

      canonicalOutcome = canonicalRes;
      Object.assign(results, canonicalRes.results);
    } else {
      const missionId = typeof body.missionId === 'string' ? body.missionId : undefined;
      const workerObservedEpoch = typeof body.workerObservedEpoch === 'number' ? body.workerObservedEpoch : undefined;

      // Legacy Fallback Path (Guarded by PublishingExecutor Kill Switch)
      if (channel === 'INSTAGRAM' || channel === 'BOTH') {
        const igRes = await PublishingExecutor.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          caption: authoritativeCaption,
          imageUrl: authoritativeImageUrl,
          contentVersionId: versionId,
          expectedFingerprint: authoritativeFingerprint,
          idempotencyKey: validatedInput.idempotencyKey,
          missionId,
          workerObservedEpoch,
        });

        results.instagram = {
          success: igRes.success,
          verified: igRes.verified,
          stage: igRes.stage,
          postId: igRes.externalPostId,
          url: igRes.publishedUrl,
          receiptId: igRes.receiptId,
          providerRequestId: igRes.providerRequestId,
          readbackRequestId: igRes.readbackRequestId,
          message: igRes.statusMessage,
          errorCode: igRes.errorCode,
          channel: 'instagram'
        };
      }

      if (channel === 'THREADS' || channel === 'BOTH') {
        const threadsRes = await PublishingExecutor.executePublish({
          workspaceId,
          channel: 'THREADS',
          caption: authoritativeCaption,
          imageUrl: authoritativeImageUrl,
          contentVersionId: versionId,
          expectedFingerprint: authoritativeFingerprint,
          idempotencyKey: validatedInput.idempotencyKey,
          missionId,
          workerObservedEpoch,
        });

        results.threads = {
          success: threadsRes.success,
          verified: threadsRes.verified,
          stage: threadsRes.stage,
          postId: threadsRes.externalPostId,
          url: threadsRes.publishedUrl,
          receiptId: threadsRes.receiptId,
          providerRequestId: threadsRes.providerRequestId,
          readbackRequestId: threadsRes.readbackRequestId,
          message: threadsRes.statusMessage,
          errorCode: threadsRes.errorCode,
          channel: 'threads'
        };
      }
    }

    // 2. Naver Blog: 연결 확장 경로가 열리기 전까지 서버는 발행을 시도하지 않는다 (가짜 성공 금지)
    if (channel === 'NAVER' || channel === 'NAVER_BLOG') {
      results.naver = naverPublishNotReadyResult();
    }

    // 3. Daangn Channel (ANI-621 Fail-closed)
    if (channel === 'DAANGN') {
      results.daangn = {
        success: false,
        verified: false,
        channel: 'daangn',
        message: '당근마켓 비즈프로필 브라우저 런타임 세션 준비 중입니다.',
        errorCode: 'CAPABILITY_PREPARING'
      };
    }

    const resultList = Object.values(results);
    const anySuccess = resultList.some((r: any) => r.success);
    const allSuccess = resultList.length > 0 && resultList.every((r: any) => r.success);
    const overallSuccess = canonicalOutcome ? canonicalOutcome.success : allSuccess;

    return NextResponse.json({
      success: overallSuccess,
      overallStatus: canonicalOutcome?.overallStatus,
      parentSagaId: canonicalOutcome?.parentSagaId,
      workspaceId,
      channel,
      results,
      message: canonicalOutcome
        ? canonicalOutcome.message
        : allSuccess
          ? '선택하신 모든 채널에 게시 요청이 정상 전달되었습니다.'
          : anySuccess
            ? '일부 채널에만 게시 요청이 전달되었어요. 채널별 결과를 확인해 주세요.'
            : '채널 계정 연동 상태를 확인해 주세요.'
    });
  } catch (err: unknown) {
    console.error('Instant publish error:', err);
    if (err instanceof RawImagesContractViolationError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: 400 }
      );
    }
    if (err instanceof ApprovedBundleRequiredError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: 403 }
      );
    }
    if (err instanceof ApprovalIntegrityError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: 409 }
      );
    }
    if (err instanceof PublishRenditionError || err instanceof ProviderDeliveryLeaseError) {
      const status = err.code.includes('FORBIDDEN') ? 403 : err.code.includes('NOT_FOUND') ? 404 : 422;
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status }
      );
    }
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Publish failed' },
      { status: 500 }
    );
  }
}
