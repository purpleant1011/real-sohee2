/**
 * SOHEE V0.91 · Operating Policy Server Operations (ANI-1403 / HF-53)
 * Server-only database queries and mutations for Operating Policy.
 * Guarantees cross-tenant boundary defense and audit-trailed immutable versioning.
 */

import {
  type OperatingPolicyRules,
  type OperatingPolicyVersion,
  DEFAULT_OPERATING_POLICY_RULES,
  validateOperatingPolicyRules,
} from './operating-policy-manager';

/**
 * Fetch the currently active confirmed operating policy for a workspace.
 * Fails closed with null if no active policy exists.
 */
export async function getActiveOperatingPolicy(
  workspaceId: string,
  supabaseClient?: any
): Promise<OperatingPolicyVersion | null> {
  try {
    let client = supabaseClient;
    if (!client) {
      const { createServerSupabaseClient } = await import('@/lib/supabase/server');
      client = await createServerSupabaseClient();
    }

    const { data: rule, error } = await client
      .from('harness_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('rule_type', 'approval_policy')
      .eq('status', 'active')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return null;
    }

    if (!rule || !rule.approved_at) {
      return null;
    }

  const structured = (rule.structured_rule || {}) as Partial<OperatingPolicyRules>;
  const mergedRules: OperatingPolicyRules = {
    ...DEFAULT_OPERATING_POLICY_RULES,
    ...structured,
    requireApprovalBeforePublish: structured.requireApprovalBeforePublish ?? true,
    allowedChannels: Array.isArray(rule.applies_to_channels) && rule.applies_to_channels.length > 0
      ? rule.applies_to_channels
      : (structured.allowedChannels || ['instagram', 'threads']),
  };

    return {
      id: rule.id,
      workspaceId: rule.workspace_id,
      ruleKey: rule.rule_key,
      versionNumber: rule.version || 1,
      status: rule.status as any,
      rules: Object.freeze(mergedRules),
      confirmedByUserId: rule.approved_by_user_id || null,
      confirmedAt: rule.approved_at || null,
      createdAt: rule.created_at,
      updatedAt: rule.updated_at || rule.created_at,
    };
  } catch (err: any) {
    return null;
  }
}

/**
 * Persists and activates a newly confirmed operating policy version.
 * - Enforces workspace membership (cross-tenant denial).
 * - Retires existing active rule in an audit-preserved manner (no in-place overwrite).
 * - Inserts a new immutable active version.
 */
export async function persistOperatingPolicy(params: {
  workspaceId: string;
  userId: string;
  rules: Partial<OperatingPolicyRules>;
  supabaseClient?: any;
  adminClient?: any;
}): Promise<OperatingPolicyVersion> {
  const { workspaceId, userId, rules } = params;

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('AUTHZ_CONFIRM_USER_REQUIRED: 운영 정책 확정은 사용자 세션 인증이 필수입니다.');
  }

  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
  const admin = params.adminClient || (params.supabaseClient ? params.supabaseClient : createAdminSupabaseClient());

  // Cross-tenant guard: verify that userId belongs to workspaceId
  const { data: member, error: memberErr } = await admin
    .from('workspace_members')
    .select('role, user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (memberErr || !member) {
    const err = new Error('CROSS_TENANT_ACCESS_DENIED: 해당 워크스페이스의 운영 정책을 변경할 권한이 없습니다.');
    (err as any).statusCode = 403;
    throw err;
  }

  // Determine next version number
  const { data: latestRule } = await admin
    .from('harness_rules')
    .select('version')
    .eq('workspace_id', workspaceId)
    .eq('rule_type', 'approval_policy')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = ((latestRule?.version as number) || 0) + 1;

  const mergedRules: OperatingPolicyRules = {
    ...DEFAULT_OPERATING_POLICY_RULES,
    ...rules,
  };

  if (rules.publishApprovalLevel) {
    mergedRules.requireApprovalBeforePublish = rules.publishApprovalLevel !== 'full_auto';
  } else if (rules.requireApprovalBeforePublish !== undefined) {
    mergedRules.publishApprovalLevel = rules.requireApprovalBeforePublish ? 'always_require' : 'conditional_auto';
  }

  const validation = validateOperatingPolicyRules(mergedRules);
  if (!validation.valid) {
    throw new Error(`운영 정책 유효성 검증 실패: ${validation.errors.join(', ')}`);
  }

  const now = new Date().toISOString();

  // 1. Retire existing active approval_policy rules (preserve history, no in-place overwrite)
  await admin
    .from('harness_rules')
    .update({ status: 'retired', updated_at: now })
    .eq('workspace_id', workspaceId)
    .eq('rule_type', 'approval_policy')
    .eq('status', 'active');

  // 2. Insert new active operating policy version
  const { data: inserted, error: insertErr } = await admin
    .from('harness_rules')
    .insert({
      workspace_id: workspaceId,
      rule_key: `approval-policy-v${nextVersion}`,
      rule_type: 'approval_policy',
      title: `운영 정책 v${nextVersion}: 사전 승인 및 일일 발행 한도`,
      description: mergedRules.requireApprovalBeforePublish
        ? '모든 콘텐츠는 원장님/사장님 최종 승인 후 발행'
        : '조건부 자율 발행 허용',
      structured_rule: mergedRules as any,
      applies_to_channels: mergedRules.allowedChannels,
      status: 'active',
      version: nextVersion,
      created_by_user_id: userId,
      approved_by_user_id: userId,
      approved_at: now,
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    console.error('[persistOperatingPolicy] Failed to insert new policy:', insertErr);
    throw new Error(`운영 정책 영속화 실패: ${insertErr?.message || '알 수 없는 DB 오류'}`);
  }

  return {
    id: inserted.id,
    workspaceId: inserted.workspace_id,
    ruleKey: inserted.rule_key,
    versionNumber: inserted.version,
    status: inserted.status as any,
    rules: Object.freeze(mergedRules),
    confirmedByUserId: inserted.approved_by_user_id,
    confirmedAt: inserted.approved_at,
    createdAt: inserted.created_at,
    updatedAt: inserted.updated_at || inserted.created_at,
  };
}
