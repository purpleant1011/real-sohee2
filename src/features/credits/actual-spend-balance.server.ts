import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export interface AuthoritativeCreditBalance {
  workspaceId: string
  authoritativeAvailableCredits: number
  stateTotalCredits: number
  ledgerSpendableBalance: number
  hasSignupGrant: boolean
  updatedAt: string | null
}

interface SupabaseClientLike {
  rpc(name: string, args: Record<string, unknown>): any
}

/**
 * Server-only helper to read authoritative spend balance directly matching reserve_quick_post_credits.
 * Enforces server privilege boundary and workspace permission before invocation.
 * Strict validation: requires matching workspace_id, finite non-negative integers (no Number(null)=0).
 */
export async function getWorkspaceAuthoritativeCreditBalance(
  workspaceId: string,
  client?: SupabaseClientLike,
): Promise<AuthoritativeCreditBalance | null> {
  try {
    const admin = client ?? createAdminSupabaseClient()
    const { data, error } = await (admin as any).rpc('get_workspace_authoritative_credit_balance', {
      p_workspace_id: workspaceId,
    })

    if (error || !data || typeof data !== 'object') {
      return null
    }

    // Strict validation: must match workspaceId
    if (data.workspace_id !== workspaceId) {
      return null
    }

    // Strict validation: authoritative_available_credits must be a non-negative finite integer
    const rawAvailable = data.authoritative_available_credits
    if (
      typeof rawAvailable !== 'number' ||
      !Number.isInteger(rawAvailable) ||
      rawAvailable < 0
    ) {
      return null
    }

    const rawState = data.state_total_credits
    if (typeof rawState !== 'number' || !Number.isInteger(rawState)) {
      return null
    }

    const rawLedger = data.ledger_spendable_balance
    if (typeof rawLedger !== 'number' || !Number.isInteger(rawLedger)) {
      return null
    }

    return {
      workspaceId: data.workspace_id,
      authoritativeAvailableCredits: rawAvailable,
      stateTotalCredits: rawState,
      ledgerSpendableBalance: rawLedger,
      hasSignupGrant: Boolean(data.has_signup_grant),
      updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
    }
  } catch {
    return null
  }
}
