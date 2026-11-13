import type { AdmissionContext, SoheeReadinessSnapshot } from './types';
import { SoheeNotReadyError } from './types';

export { SoheeNotReadyError };

/**
 * HF-02: Server Admission Guard: requireSoheeReady
 * 
 * Protects:
 * - Mission creation
 * - Agent execution jobs
 * - Production content / image generation
 * - Content approval
 * - Instagram & Threads live publish
 * - Scheduled automation
 * - Customer direct external response
 * 
 * Throws SoheeNotReadyError (403 Forbidden, fail-closed) when SOHEE_READY is false.
 */
export async function requireSoheeReady(
  workspaceId: string,
  context?: AdmissionContext
): Promise<SoheeReadinessSnapshot> {
  if (!workspaceId) {
    throw new Error('워크스페이스 ID가 지정되지 않았습니다.');
  }

  const { getSoheeReadiness } = await import('./read-model');
  const readiness =
    context?.readinessSnapshot ??
    (await getSoheeReadiness(workspaceId, {
      supabaseClient: context?.supabaseClient,
    }));

  if (!readiness.ready) {
    console.warn(
      `[requireSoheeReady] Admission BLOCKED for workspace=${workspaceId} action=${context?.action ?? 'UNSPECIFIED'}:`,
      readiness.blockers.map((b) => b.code)
    );

    const hasBusinessBlocker = readiness.blockers.some(
      (b) => b.factKey === 'BUSINESS_VERIFIED' || b.code === 'BUSINESS_NOT_VERIFIED'
    );
    let membershipTier: string | undefined;
    let membershipNotice: string | undefined;

    if (hasBusinessBlocker) {
      try {
        const { getMembershipTier, FORMAL_MEMBERSHIP_NOTICE } = await import('@/features/membership/membership-tier');
        let client: any = undefined;
        try {
          const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
          client = createAdminSupabaseClient();
        } catch {
          client = context?.supabaseClient;
        }
        membershipTier = await getMembershipTier(client, workspaceId);
        membershipNotice = FORMAL_MEMBERSHIP_NOTICE;
      } catch {
        membershipTier = 'TRIAL';
        membershipNotice = '정식 회원 전용 기능이에요. 사업자 인증이 승인되면 바로 쓸 수 있어요.';
      }
    }

    throw new SoheeNotReadyError(readiness, context?.action, {
      membershipTier,
      membershipNotice,
    });
  }

  return readiness;
}
